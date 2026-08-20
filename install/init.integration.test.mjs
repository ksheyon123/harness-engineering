import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **발행되는 물건을 실제로 설치해서** 하네스가 서는지 본다.
 *
 * `init.test.mjs` 는 판정만 본다 — 무엇을 쓰기로 했는가. 여기서 묻는 것은 그다음이다:
 * 그렇게 쓴 파일들이 **남의 저장소에서 실제로 도는가.** 훅의 계약이 stdin JSON →
 * stdout JSON 이라 Claude Code 없이도 부를 수 있고, git 훅은 진짜 `git commit` 으로
 * 검증된다.
 *
 * ## 왜 소스가 아니라 tarball 인가
 *
 * 소스 디렉터리를 심링크하면 **`files` 누락을 못 잡는다.** 새 훅을 만들고 목록에 안
 * 넣으면 여기선 멀쩡하고 설치한 쪽에서만 없다. tarball 을 풀어 넣으면 그 구멍이 여기서
 * 터진다.
 *
 * ## 왜 `npm install` 이 아니라 `tar` 인가
 *
 * `npm i` 는 로컬 tarball 이어도 레지스트리를 볼 수 있다. 게이트에 네트워크 의존을
 * 들이면 **네트워크가 흔들릴 때 게이트가 red 가 되고**, 그러면 게이트를 안 믿게 된다.
 * 풀어서 `node_modules/<이름>/` 에 두면 node 의 해석 규칙에는 아무 차이가 없다.
 *
 * 대신 이것이 검증하지 못하는 것: `npm` 이 만드는 `.bin` shim 과 실행권한. 전자는 npm 의
 * 몫이고 후자는 **이 기계에서 잴 수 없다**(Windows 에 실행권한이 없다).
 */

const REPO = fileURLToPath(new URL("..", import.meta.url));
const PKG_NAME = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name;

/** 설치가 끝난 A. 만드는 데 몇 초 걸리므로 한 번만 만들고 모두가 공유한다. */
let A;

/**
 * `GIT_` 와 `HARNESS_` 를 둘 다 씻은 env.
 *
 * - 상속된 `GIT_DIR` 은 임시 저장소를 겨냥한 명령을 이 저장소로 돌린다.
 * - 상속된 `HARNESS_ROLE` 은 **자리 판정을 통째로 뒤집는다.** 층 1 은 `agent_type` 이
 *   없을 때 그 변수를 보므로(미설정 = 실행자), 씻지 않으면 아래 '실행자' 케이스가
 *   **게이트를 누가 돌렸는지에 따라** 답이 달라진다 — 작업 세션이나 그 서브에이전트
 *   안에서 돌리면 `work-session` 을 물려받아 `deny` 여야 할 자리가 `ask` 가 된다.
 *   `path-ownership.test.mjs` 의 `baseEnv` 와 같은 규율이다.
 */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || key.startsWith("HARNESS_")) delete env[key];
  }
  return env;
}

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** 훅을 그 계약대로 부른다 — stdin 에 JSON, stdout 에 JSON. */
function askHook(cwd, hookPath, input) {
  const out = execFileSync(process.execPath, [hookPath], {
    cwd,
    env: cleanEnv(),
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  return JSON.parse(out);
}

/** 커밋을 시도한다. 훅이 막으면 status 가 0 이 아니다. */
function commit(cwd, message) {
  const result = execFileSync("git", ["commit", "-m", message], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: true, out: result };
}

function tryCommit(cwd, message) {
  try {
    commit(cwd, message);
    return { blocked: false, stderr: "" };
  } catch (error) {
    return { blocked: true, stderr: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

beforeAll(() => {
  const stage = mkdtempSync(join(tmpdir(), "harness-install-"));
  const dir = join(stage, "a-project");
  mkdirSync(join(dir, "src"), { recursive: true });

  // 1) 발행될 물건을 만든다.
  //
  // **파일명을 조립하지 않는다.** 스코프가 붙으면 `@a/b` 가 `a-b-<버전>.tgz` 로 눌리는데,
  // 그 규칙을 여기 옮겨 적으면 이름을 바꿀 때 이 파일만 낡는다 — npm 에게 묻는다.
  const packed = execSync(`npm pack --json --pack-destination "${stage}"`, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const tgz = join(stage, JSON.parse(packed)[0].filename);

  // 2) A 를 만든다.
  // `scripts.test` 를 준다. **게이트가 없는 A 는 smoke 가 red 를 내는 것이 맞고**, 그
  // 판정은 `smoke.test.mjs` 가 따로 덮는다. 여기서 묻는 것은 배선이므로, 게이트는 갖춰진
  // 정상적인 프로젝트를 세운다.
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "a-project", version: "1.0.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "src", "a.js"), "export const x = 1;\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "a@example.invalid"]);
  git(dir, ["config", "user.name", "a"]);

  // 3) tarball 을 풀어 넣는다. 루트가 `package/` 라 한 겹 벗긴다.
  //
  // **상대 경로로 부른다.** GNU tar 는 `C:\...` 의 콜론을 원격 호스트 구분자로 읽어
  // `Cannot connect to C:` 로 죽는다(`--force-local` 은 Windows 기본 bsdtar 에 없다).
  // 콜론이 없는 경로면 두 구현 다 통한다.
  const into = join(dir, "node_modules", PKG_NAME);
  mkdirSync(into, { recursive: true });
  execSync(`tar -xzf "${relative(into, tgz).replace(/\\/g, "/")}" --strip-components=1`, {
    cwd: into,
    stdio: ["ignore", "ignore", "pipe"],
  });

  // 4) 설치한다.
  execFileSync(process.execPath, [join(into, "install", "init.mjs")], {
    cwd: dir,
    env: cleanEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  A = dir;
}, 180_000);

describe("설치된 하네스 (tarball → init)", () => {
  it("층 1 이 선다 — 실행자는 저장소 코드를 못 고친다", () => {
    // shim 한 줄이 패키지의 훅 본체를 찾아 판정까지 돌아온다는 뜻이다.
    const verdict = askHook(A, join(A, ".claude/hooks/path-ownership.mjs"), {
      hook_event_name: "PreToolUse",
      cwd: A,
      tool_input: { file_path: join(A, "src/a.js") },
    });

    expect(verdict.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("층 1 이 자리를 가른다 — developer 는 같은 파일을 고칠 수 있다", () => {
    const verdict = askHook(A, join(A, ".claude/hooks/path-ownership.mjs"), {
      hook_event_name: "PreToolUse",
      cwd: A,
      agent_type: "developer",
      tool_input: { file_path: join(A, "src/a.js") },
    });

    expect(verdict.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("층 2 가 선다 — `main` 직접 커밋이 막힌다", () => {
    git(A, ["add", "-A"]);
    const { blocked, stderr } = tryCommit(A, "설치");

    expect(blocked).toBe(true);
    expect(stderr).toContain("main");
  });

  it("브랜치를 자르면 커밋된다", () => {
    git(A, ["checkout", "-q", "-b", "chore/install"]);
    git(A, ["add", "-A"]);

    expect(tryCommit(A, "설치").blocked).toBe(false);
  });

  it("**worktree 안에서도** shim 이 본체를 찾는다", () => {
    // 사본에는 `node_modules` 가 없다. node 의 상향 해석이 부모의 것을 찾아야만 선다 —
    // 이 하네스가 worktree 를 저장소 안에 두는 이유가 정확히 이것이다.
    const wt = join(A, ".claude/worktrees/t");
    git(A, ["worktree", "add", "-q", wt, "-b", "t"]);

    expect(existsSync(join(wt, "node_modules"))).toBe(false);

    const verdict = askHook(wt, join(wt, ".claude/hooks/path-ownership.mjs"), {
      hook_event_name: "PreToolUse",
      cwd: wt,
      tool_input: { file_path: join(wt, "src/a.js") },
    });

    expect(verdict.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("`harness doctor` 가 설치본에서 돈다", () => {
    const out = execFileSync(
      process.execPath,
      [join(A, "node_modules", PKG_NAME, "scripts", "harness.mjs"), "doctor"],
      { cwd: A, env: cleanEnv(), encoding: "utf8" },
    );

    // 설정 파일이 없으니 기본값으로 돈다고 알려야 한다.
    expect(out).toContain("기본값");
  });

  it("설치가 남긴 파일이 전부 추적된다", () => {
    // 추적되지 않으면 worktree 사본에 복사되지 않고, 거기서 하네스가 통째로 사라진다.
    const tracked = git(A, ["ls-files"]).split(/\r?\n/);

    for (const path of [
      ".claude/hooks/path-ownership.mjs",
      ".claude/hooks/verify-green.mjs",
      ".claude/agents/developer.md",
      ".claude/harness.md",
      ".claude/settings.json",
      ".githooks/pre-commit",
      ".githooks/pre-commit.mjs",
    ]) {
      expect(tracked, path).toContain(path);
    }
  });

  it("설치 기록을 남긴다 — `sync` 가 낡음을 판정하는 근거다", () => {
    const manifest = JSON.parse(readFileSync(join(A, ".claude/harness-manifest.json"), "utf8"));

    expect(manifest.version).toBe(JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version);
    expect(Object.keys(manifest.files)).toContain(".claude/harness.md");
  });

  it("`harness sync` 가 설치본에서 돌고, 갓 설치한 것에는 손대지 않는다", () => {
    const out = execFileSync(
      process.execPath,
      [join(A, "node_modules", PKG_NAME, "scripts", "harness.mjs"), "sync"],
      { cwd: A, env: cleanEnv(), encoding: "utf8" },
    );

    expect(out).toContain("다시 쓸 것이 없다");
  });

  it("`harness smoke` 가 설치본에서 끊긴 배선을 하나도 못 찾는다", () => {
    // 위의 개별 테스트들이 훅을 하나씩 찔러본다면, 이건 **하네스가 아는 배선 전부**를
    // 한 번에 묻는다 — 새 훅을 만들고 `settings.json` 에 안 걸면 여기서 터진다.
    //
    // 신뢰만은 저장소 밖(`~/.claude.json`)에 있어, 그대로 두면 이 판정이 **검사를 돌리는
    // 기계의 개인 설정**에 달린다. `CLAUDE_CONFIG_DIR` 로 A 를 신뢰하는 설정을 따로 세워
    // 넣는다 — 덤으로 설치본에서 그 검사가 초록을 내는 경로까지 함께 밟힌다.
    const configDir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    writeFileSync(
      join(configDir, ".claude.json"),
      JSON.stringify({ projects: { [A.replace(/\\/g, "/")]: { hasTrustDialogAccepted: true } } }),
    );

    const out = execFileSync(
      process.execPath,
      [join(A, "node_modules", PKG_NAME, "scripts", "harness.mjs"), "smoke"],
      { cwd: A, env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: configDir }, encoding: "utf8" },
    );

    expect(out).toContain("배선은 전부 살아 있다");
    // 증명되지 않은 것도 같이 찍혀야 한다 — 초록만 보고 끝났다고 믿게 두지 않는다.
    expect(out).toContain("세션에서 사람이 본다");
  });

  it("다시 돌려도 바꿀 것이 없다", () => {
    const out = execFileSync(
      process.execPath,
      [join(A, "node_modules", PKG_NAME, "install", "init.mjs"), "--dry-run"],
      { cwd: A, env: cleanEnv(), encoding: "utf8" },
    );

    expect(out).toContain("바꿀 것이 없다");
  });
});

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./verify-spec.mjs", import.meta.url));
const COUNTER = "harness-verify-spec-attempts";

const VALID_SPEC = `---
branch: feat/thing
---

# 태스크

## 목적
한 줄.

## 기능 목록

### 기능: 무엇
- **인수기준**: 참이면 완성이다.
`;

/**
 * `GIT_` 접두어를 지운 env. 이 파일은 픽스처에 `git init` 을 하므로, 부모에게서
 * `GIT_DIR` 을 물려받으면 임시 디렉터리가 아니라 이 저장소를 초기화한다.
 */
function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return { ...env, ...extra };
}

const fixtures = [];

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
}

/** planner 가 돌 worktree 를 흉내낸 빈 저장소. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "verify-spec-"));
  fixtures.push(dir);
  git(dir, ["init", "-q"]);
  return dir;
}

function writeSpec(dir, relPath, body = VALID_SPEC) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function commitAll(dir) {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
}

function gitDirOf(cwd) {
  return git(cwd, ["rev-parse", "--absolute-git-dir"]).trim();
}

function runHook(cwd, { input = {} } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: cleanEnv(),
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    stdout,
    verdict: stdout.trim() ? JSON.parse(stdout) : null,
  };
}

describe("verify-spec — planner 의 SubagentStop 훅", () => {
  it("spec 을 남겼으면 판정을 내지 않아 종료가 허용된다", () => {
    const dir = makeRepo();
    writeSpec(dir, "harness/thing/spec.md");

    const { status, stdout } = runHook(dir);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("아무것도 쓰지 않았으면 block 하고, 그래도 종료 코드는 0 이다", () => {
    const { status, verdict } = runHook(makeRepo());

    expect(status).toBe(0);
    expect(verdict.decision).toBe("block");
    expect(verdict.reason).toContain("spec.md` 가 없다");
  });

  it("새로 생긴 디렉터리 안의 spec 도 찾아낸다", () => {
    // `git status` 기본값은 추적되지 않는 디렉터리를 접어서 `?? harness/` 한 줄로만
    // 보여준다. -uall 이 빠지면 제대로 쓴 planner 를 '안 썼다' 로 판정한다.
    const dir = makeRepo();
    writeFileSync(join(dir, "README.md"), "seed\n");
    commitAll(dir); // harness/ 는 여전히 추적 밖 — 통째로 새 디렉터리다
    writeSpec(dir, "harness/brand-new/spec.md");

    expect(runHook(dir).verdict).toBeNull();
  });

  it("이미 커밋된 spec 을 고친 경우(리비전)도 산출물로 본다", () => {
    const dir = makeRepo();
    writeSpec(dir, "harness/thing/spec.md");
    commitAll(dir);
    writeSpec(dir, "harness/thing/spec.md", VALID_SPEC.replace("feat/thing", "feat/thing-v2"));

    expect(runHook(dir).verdict).toBeNull();
  });

  it("frontmatter 가 없으면 block 한다", () => {
    const dir = makeRepo();
    writeSpec(dir, "harness/thing/spec.md", "# 태스크\n\n## 기능 목록\n\n- 무엇\n");

    expect(runHook(dir).verdict.reason).toContain("frontmatter 가 없다");
  });

  it("frontmatter 에 branch 가 없으면 block 한다", () => {
    const dir = makeRepo();
    writeSpec(dir, "harness/thing/spec.md", VALID_SPEC.replace("branch: feat/thing", "task: thing"));

    expect(runHook(dir).verdict.reason).toContain("branch: <task 브랜치>` 가 없다");
  });

  it("기능 목록 절이 없으면 block 한다", () => {
    const dir = makeRepo();
    writeSpec(dir, "harness/thing/spec.md", VALID_SPEC.replace("## 기능 목록", "## 할 일"));

    expect(runHook(dir).verdict.reason).toContain("기능 목록` 절이 없다");
  });

  it("상한을 넘으면 차단을 푼다 — 정당하게 못 쓰는 경우가 있다", () => {
    // 스폰 프롬프트에 <task> 가 없으면 추측한 이름으로 쓰는 것보다 안 쓰는 것이 맞다.
    // 그 planner 가 여기서 갇히면 안 된다.
    const dir = makeRepo();

    expect(runHook(dir).verdict.decision).toBe("block");

    const released = runHook(dir).verdict;
    expect(released.decision).toBeUndefined();
    expect(released.systemMessage).toContain("spec 없이 종료를 허용했다");
  });

  it("통과하면 카운터를 지운다", () => {
    const dir = makeRepo();
    runHook(dir);
    const counter = join(gitDirOf(dir), COUNTER);
    expect(existsSync(counter)).toBe(true);

    writeSpec(dir, "harness/thing/spec.md");
    runHook(dir);

    expect(existsSync(counter)).toBe(false);
  });

  it("git 을 쓸 수 없으면 판정하지 않는다", () => {
    // 확인하지 않은 것을 '없다' 로 적으면 사람이 틀린 신호를 보고 판단한다.
    const dir = mkdtempSync(join(tmpdir(), "verify-spec-nogit-"));
    fixtures.push(dir);

    expect(runHook(dir).verdict).toBeNull();
  });
});

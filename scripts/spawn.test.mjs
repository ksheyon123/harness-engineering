/**
 * `spawn` 이 답해야 하는 것은 둘이다 — **어느 저장소를 겨냥하나**(정책)와 **새 터미널이
 * 무엇을 실행하나**(명령 본문). 둘 다 이제 Node 에 있어서 **어느 기계에서도 검사된다.**
 *
 * 한때 이 파일 전체가 `skipIf(!HAS_CLAUDE)` 였다 — 정책이 `.ps1` 안에 있어 PowerShell 과
 * PATH 의 `claude` 를 둘 다 요구했기 때문이다. 그래서 Windows 밖에서는 다섯 개가 통째로
 * 건너뛰어졌고, **정책이 깨져도 아무도 몰랐다.**
 *
 * 남은 skip 은 하나뿐이다: 프로세스로 진짜 띄워 보는 통합 검사. 그것만 `claude` 가 있어야
 * 한다(정책이 `claude` 해석에서 먼저 죽어 `--dry-run` 에 닿지 못한다).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { command, findClaude, plan, repoRoot } from "./spawn.mjs";

const SPAWN = fileURLToPath(new URL("./spawn.mjs", import.meta.url));
const PKG = fileURLToPath(new URL("..", import.meta.url));

/**
 * `GIT_` 접두어를 통째로 지운다. `GIT_DIR` 이 남아 있으면 git 은 cwd 에서 위로 올라가며
 * 저장소를 찾는 탐색을 건너뛰고 그 값을 쓴다 — 임시 저장소를 겨냥한 것처럼 보이는 명령이
 * 진짜 저장소를 건드린다. **이 파일은 그 탐색 자체를 검사하므로** 특히 치명적이다.
 */
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return env;
}

const fixtures = [];

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

function makeDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  fixtures.push(dir);
  return dir;
}

function makeRepo() {
  const dir = makeDir("spawn-repo-");
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "hook@example.invalid"]);
  git(["config", "user.name", "hook"]);
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  return dir;
}

/** 대소문자와 구분자를 지운다. git 은 슬래시로 답하고 Windows 는 대소문자를 안 가린다. */
const key = (path) => path.replace(/\\/g, "/").toLowerCase();

/** `claude` 해석을 고정한다 — 이 기계에 깔려 있는지와 정책은 아무 상관이 없다. */
const fixed = (path) => () => path;

describe("spawn — 작업 세션은 부른 사람이 서 있던 저장소에서 열린다", () => {
  it("cwd 가 하위 디렉터리여도 루트를 겨냥한다", () => {
    const repo = makeRepo();
    const nested = join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });

    expect(key(repoRoot(nested))).toBe(key(repo));
  });

  it("저장소가 아니면 멈춘다", () => {
    // 조용히 아무 데나 여는 것보다 낫다 — 잘못 열린 탭은 spec 을 엉뚱한 곳에 쓰고,
    // 그 사실은 push 할 때까지 드러나지 않는다.
    const bare = makeDir("spawn-nonrepo-");

    expect(() => repoRoot(bare)).toThrow(/git 저장소가 아니다/);
  });

  it("claude 를 못 찾으면 띄우기 전에 멈춘다", () => {
    // 새 창에서 실패하면 그 창은 에러만 띄운 채 남고, 사람은 왜 죽었는지 보려고 그
    // 창을 뒤져야 한다.
    const repo = makeRepo();

    expect(() =>
      plan({ cwd: repo, seed: "x", platform: "darwin", resolveClaude: () => null }),
    ).toThrow(/claude 를 PATH 에서 찾지 못했다/);
  });

  it("터미널을 여는 법을 모르는 플랫폼에서는 없다고 말한다", () => {
    // 조용히 아무것도 안 하면 작업 세션이 안 떴다는 사실을 아무도 모른다.
    const repo = makeRepo();

    expect(() =>
      plan({ cwd: repo, seed: "x", platform: "linux", resolveClaude: fixed("/usr/bin/claude") }),
    ).toThrow(/linux 에서 터미널을 여는 법을 모른다/);
  });
});

describe("spawn — 새 터미널이 실행할 명령", () => {
  const target = { repo: "/home/a/repo", claude: "/usr/local/bin/claude", seed: "로그인 만들어줘" };

  it("Windows — 역할·저장소·원문이 전부 들어간다", () => {
    const text = command({ ...target, platform: "win32", repo: "C:\\repo" });

    expect(text).toContain(`$env:HARNESS_ROLE = 'work-session'`);
    expect(text).toContain(`Set-Location -LiteralPath 'C:\\repo'`);
    expect(text).toContain(`& '/usr/local/bin/claude' '로그인 만들어줘'`);
  });

  it("macOS — 역할·저장소·원문이 전부 들어간다", () => {
    const text = command({ ...target, platform: "darwin" });

    expect(text).toContain("export HARNESS_ROLE=work-session");
    expect(text).toContain(`cd '/home/a/repo'`);
    expect(text).toContain(`'/usr/local/bin/claude' '로그인 만들어줘'`);
  });

  it("macOS — claude 가 끝나도 창이 남는다", () => {
    // Windows 의 `-NoExit` 과 같은 자리다. 창이 즉시 닫히면 실패를 아무도 못 본다.
    expect(command({ ...target, platform: "darwin" })).toContain('exec "${SHELL:-/bin/sh}" -l');
  });

  it("macOS — 일회용 런처는 스스로를 지운다", () => {
    // 원문(사람이 친 요청)이 공용 임시 디렉터리에 영구히 남지 않는다.
    const text = command({ ...target, platform: "darwin" });

    expect(text).toContain(`rm -f "$0"`);
  });

  it("원문의 따옴표가 명령을 깨뜨리지 않는다", () => {
    // 사람은 `'` 를 친다. 여기서 안 막으면 새 터미널이 엉뚱한 명령을 실행한다.
    const seed = `it's 'quoted'`;

    expect(command({ ...target, platform: "win32", seed })).toContain(`'it''s ''quoted'''`);
    expect(command({ ...target, platform: "darwin", seed })).toContain(`'it'\\''s '\\''quoted'\\'''`);
  });

  it("원문이 비면 claude 를 인자 없이 연다", () => {
    expect(command({ ...target, platform: "win32", seed: "" })).toMatch(/& '[^']+'$/m);
    expect(command({ ...target, platform: "darwin", seed: "" })).toMatch(/^'[^']+'$/m);
  });
});

/**
 * `spawn.mjs` 는 탭을 띄우기 전에 `claude` 를 PATH 에서 해석하고, 못 찾으면 `--dry-run`
 * 에 닿기 전에 죽는다. 없는 기계에서는 이 아래가 검사하려는 것에 도달할 수 없으므로,
 * 통과시키지 않고 **건너뛴다.**
 */
const HAS_CLAUDE = findClaude(process.platform) !== null;

/** `--dry-run` 은 창을 띄우지 않고 실행될 명령만 찍는다 — 겨냥한 자리가 거기 들어 있다. */
function dryRun(script, cwd) {
  return spawnSync(process.execPath, [script, "--dry-run", "seed request"], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
  });
}

describe.skipIf(!HAS_CLAUDE)("spawn — 프로세스로 불렀을 때", () => {
  it("npm 의존성으로 설치돼도 패키지 폴더가 아니라 저장소 루트를 겨냥한다", () => {
    // 실제 설치 모양 그대로 둔다. 판정이 "내 파일의 부모" 였을 때 정확히 이 배치에서
    // `node_modules/@scope/harness-engineering` 이 저장소 루트로 잡혔다.
    //
    // **이 검사만 진짜 프로세스여야 한다.** 노리는 회귀가 "cwd 대신 `import.meta.url`
    // 을 봤다" 라서, cwd 를 인자로 넘기는 단위 검사로는 못 잡는다.
    const repo = makeRepo();
    const pkg = join(repo, "node_modules", "@ksheyon123", "harness-engineering");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    const installed = join(pkg, "scripts", "spawn.mjs");
    copyFileSync(SPAWN, installed);
    // `spawn.mjs` 는 `../.claude/hooks/hook-kit.mjs` 를 끌어온다. 설치본에는 그것도
    // 같이 실리므로(package `files`), 사본에도 둔다.
    mkdirSync(join(pkg, ".claude", "hooks"), { recursive: true });
    copyFileSync(
      fileURLToPath(new URL("../.claude/hooks/hook-kit.mjs", import.meta.url)),
      join(pkg, ".claude", "hooks", "hook-kit.mjs"),
    );

    const result = dryRun(installed, repo);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(key(repo));
    expect(key(result.stdout)).not.toContain("node_modules");
  });

  it("이 저장소에서 부르면 이 저장소를 겨냥한다", () => {
    const result = dryRun(SPAWN, PKG);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(`repo    : ${key(realpathSync.native(PKG))}`);
  });

  it("저장소가 아니면 창을 띄우지 않고 종료 코드 1 이다", () => {
    const bare = makeDir("spawn-nonrepo-");

    const result = dryRun(SPAWN, bare);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("command :");
  });
});

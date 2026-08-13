import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SPAWN = fileURLToPath(new URL("./spawn.ps1", import.meta.url));
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

const WINDOWS = process.platform === "win32";

/**
 * `spawn.ps1` 은 탭을 띄우기 전에 `claude` 를 PATH 에서 해석하고, 못 찾으면 `-DryRun`
 * 에 닿기 전에 죽는다. 없는 기계에서는 이 파일이 검사하려는 것(어느 저장소를 겨냥하나)에
 * 도달할 수 없으므로, 통과시키지 않고 **건너뛴다.**
 */
const HAS_CLAUDE =
  WINDOWS &&
  spawnSync("powershell", ["-NoProfile", "-Command", "if (Get-Command claude -ErrorAction SilentlyContinue) { exit 0 } exit 1"], {
    encoding: "utf8",
  }).status === 0;

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

/** `-DryRun` 은 탭을 띄우지 않고 실행될 명령만 찍는다 — 겨냥한 자리가 거기 들어 있다. */
function dryRun(script, cwd) {
  return spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-DryRun", "seed request"],
    { cwd, env: cleanEnv(), encoding: "utf8" },
  );
}

/** 대소문자와 구분자를 지운다. git 은 슬래시로 답하고 Windows 는 대소문자를 안 가린다. */
const key = (path) => path.replace(/\\/g, "/").toLowerCase();

describe.skipIf(!HAS_CLAUDE)("spawn — 작업 세션은 부른 사람이 서 있던 저장소에서 열린다", () => {
  it("스크립트가 트리 밖에 있어도 그 저장소를 겨냥한다", () => {
    const repo = makeRepo();

    const result = dryRun(SPAWN, repo);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(`set-location -literalpath '${key(repo)}'`);
  });

  it("npm 의존성으로 설치돼도 패키지 폴더가 아니라 저장소 루트를 겨냥한다", () => {
    // 실제 설치 모양 그대로 둔다. 판정이 "내 파일의 부모" 였을 때 정확히 이 배치에서
    // `node_modules/@scope/harness-engineering` 이 저장소 루트로 잡혔다.
    const repo = makeRepo();
    const pkg = join(repo, "node_modules", "@ksheyon123", "harness-engineering");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    const installed = join(pkg, "scripts", "spawn.ps1");
    copyFileSync(SPAWN, installed);

    const result = dryRun(installed, repo);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(`set-location -literalpath '${key(repo)}'`);
    expect(key(result.stdout)).not.toContain("node_modules");
  });

  it("하위 디렉터리에서 불러도 루트를 연다", () => {
    const repo = makeRepo();
    const nested = join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });

    const result = dryRun(SPAWN, nested);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(`set-location -literalpath '${key(repo)}'`);
  });

  it("저장소가 아니면 탭을 띄우지 않고 멈춘다", () => {
    // 조용히 아무 데나 여는 것보다 낫다 — 잘못 열린 탭은 spec 을 엉뚱한 곳에 쓰고,
    // 그 사실은 push 할 때까지 드러나지 않는다.
    const bare = makeDir("spawn-nonrepo-");

    const result = dryRun(SPAWN, bare);

    expect(result.status).not.toBe(0);
    expect(key(result.stdout)).not.toContain("set-location");
  });

  it("이 저장소에서 부르면 이 저장소를 겨냥한다", () => {
    // 개발 저장소에서는 옛 판정과 새 판정의 답이 같다. 그래서 여기서만 확인하면
    // 회귀를 못 잡지만, 반대로 **고치면서 이 자리를 깨뜨리지 않았는지**는 여기서 본다.
    const result = dryRun(SPAWN, PKG);

    expect(result.status).toBe(0);
    expect(key(result.stdout)).toContain(`set-location -literalpath '${key(realpathSync.native(PKG))}'`);
  });
});

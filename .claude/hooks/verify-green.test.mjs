import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./verify-green.mjs", import.meta.url));
const COUNTER = "harness-verify-green-attempts";

/** 훅 한 번이 node → npm → node 를 띄운다. 기본 5초로는 모자란다. */
const SLOW = 30_000;

/**
 * `GIT_` 접두어를 지운 env. 이 파일은 픽스처에 `git init` 을 하므로, 부모에게서
 * `GIT_DIR` 을 물려받으면 임시 디렉터리가 아니라 이 저장소를 초기화한다 —
 * 훅이 막으려는 바로 그 사고를 테스트가 저지르게 된다.
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

/**
 * 게이트 대상이 될 가짜 프로젝트. `npm test` 가 `probe.mjs` 를 부르고, 그 종료 코드가
 * 곧 green/red 다. 셸 인용이 OS 마다 다르므로 명령을 package.json 에 직접 쓰지 않고
 * 파일로 뺀다.
 */
function makeFixture({ exitCode = 0, stderr = "", echoGitDir = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-green-"));
  fixtures.push(dir);

  const probe = [];
  if (echoGitDir) {
    probe.push(`console.log("SAW_GIT_DIR=" + (process.env.GIT_DIR ?? "unset"));`);
  }
  if (stderr) probe.push(`console.error(${JSON.stringify(stderr)});`);
  probe.push(`process.exit(${exitCode});`);
  writeFileSync(join(dir, "probe.mjs"), `${probe.join("\n")}\n`);

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "verify-green-fixture",
        private: true,
        version: "0.0.0",
        scripts: { test: "node probe.mjs" },
      },
      null,
      2,
    ),
  );

  git(dir, ["init", "-q"]);
  // 인계 커밋이 서명할 신원. 없으면 커밋이 실패해 훅의 성공 경로가 통째로 달라진다.
  git(dir, ["config", "user.email", "hook@example.invalid"]);
  git(dir, ["config", "user.name", "hook"]);
  return dir;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
}

/** 저장소가 아닌 디렉터리의 게이트 픽스처 — 카운터도 인계 커밋도 만들 수 없다. */
function makeBareDir(prefix, exitCode) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  writeFileSync(join(dir, "probe.mjs"), `process.exit(${exitCode});\n`);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "n", private: true, scripts: { test: "node probe.mjs" } }),
  );
  return dir;
}

function gitDirOf(cwd) {
  return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
  }).trim();
}

function runHook(cwd, { input = {}, env = {} } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: cleanEnv(env),
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    stdout,
    verdict: stdout.trim() ? JSON.parse(stdout) : null,
  };
}

describe("verify-green — SubagentStop 게이트 훅", () => {
  it(
    "green 이면 판정을 내지 않아 종료가 허용된다",
    () => {
      const { status, stdout } = runHook(makeFixture({ exitCode: 0 }));

      expect(status).toBe(0);
      expect(stdout.trim()).toBe("");
    },
    SLOW,
  );

  it(
    "red 면 block 판정을 내고, 그래도 종료 코드는 0 이다",
    () => {
      // exit 1 로 나가면 non-blocking error 로 처리돼 에이전트가 그대로 끝난다.
      // 차단이 성립하는 유일한 형태는 exit 0 + stdout JSON 이다.
      const { status, verdict } = runHook(makeFixture({ exitCode: 1 }));

      expect(status).toBe(0);
      expect(verdict.decision).toBe("block");
    },
    SLOW,
  );

  it(
    "실패 출력을 reason 에 실어 돌려준다",
    () => {
      const { verdict } = runHook(makeFixture({ exitCode: 1, stderr: "BOOM-1234" }));

      // reason 이 곧 에이전트가 읽을 다음 지시문이다. 실패 내용이 없으면 고칠 수 없다.
      expect(verdict.reason).toContain("BOOM-1234");
    },
    SLOW,
  );

  it(
    "상한을 넘으면 차단을 풀되 green 이 아님을 알린다",
    () => {
      const dir = makeFixture({ exitCode: 1 });

      expect(runHook(dir).verdict.decision).toBe("block");
      expect(runHook(dir).verdict.decision).toBe("block");

      // 3회차 = MAX_ATTEMPTS. 못 고치는 원인에서 영원히 갇히지 않도록 풀어주되,
      // 조용히 통과시키지는 않는다.
      const exhausted = runHook(dir).verdict;
      expect(exhausted.decision).toBeUndefined();
      expect(exhausted.systemMessage).toMatch(/green 이 아니다/);
    },
    SLOW,
  );

  it(
    "카운터를 이 트리의 gitdir 에 둔다",
    () => {
      const dir = makeFixture({ exitCode: 1 });
      runHook(dir);

      // gitdir 에 두어야 worktree 마다 격리되고 worktree 와 함께 사라진다.
      expect(existsSync(join(gitDirOf(dir), COUNTER))).toBe(true);
    },
    SLOW,
  );

  it(
    "green 이 되면 카운터를 지운다",
    () => {
      const red = makeFixture({ exitCode: 1 });
      runHook(red);
      const counter = join(gitDirOf(red), COUNTER);
      expect(existsSync(counter)).toBe(true);

      // 같은 픽스처를 green 으로 바꿔 다시 돌린다. 통과한 뒤에도 카운터가 남으면
      // 다음 red 가 남은 횟수를 물려받아 한 번 만에 상한에 걸린다.
      writeFileSync(join(red, "probe.mjs"), "process.exit(0);\n");
      runHook(red);

      expect(existsSync(counter)).toBe(false);
    },
    SLOW,
  );

  it(
    "카운터를 못 쓰면 stop_hook_active 로 재시도를 한 번만 준다",
    () => {
      // git 저장소가 아니면 gitdir 을 못 구해 카운터가 없다. 상한이 사라지는 대신
      // 훅 입력의 플래그로 대체한다 — 무한 루프만은 막아야 한다.
      const dir = makeBareDir("verify-green-nogit-", 1);

      expect(runHook(dir, { input: {} }).verdict.decision).toBe("block");
      expect(runHook(dir, { input: { stop_hook_active: true } }).verdict.decision)
        .toBeUndefined();
    },
    SLOW,
  );

  it(
    "자식 프로세스에 GIT_* 를 물려주지 않는다",
    () => {
      const dir = makeFixture({ exitCode: 1, echoGitDir: true });

      // GIT_DIR 이 새어 나가면 git 을 부르는 테스트가 전부 엉뚱한 저장소를 겨냥한다.
      // 훅은 npm test 를 띄우는 지점이므로 여기서 끊어야 한다.
      const { verdict } = runHook(dir, { env: { GIT_DIR: join(dir, "decoy.git") } });

      expect(verdict.reason).toContain("SAW_GIT_DIR=unset");
    },
    SLOW,
  );

  it(
    "green 이면 산출물을 인계 커밋으로 남긴다",
    () => {
      const dir = makeFixture({ exitCode: 0 });

      runHook(dir);

      // worktree 는 커밋된 상태만 밖으로 보인다. 커밋이 없으면 오케스트레이터가
      // 머지할 것이 없고 산출물은 worktree 와 함께 사라진다.
      expect(git(dir, ["log", "--format=%s"])).toContain(
        "chore(developer): 산출물을 인계 커밋으로 남긴다",
      );
      expect(git(dir, ["ls-files"])).toContain("probe.mjs");
    },
    SLOW,
  );

  it(
    "인계 커밋은 부분 스테이징을 하지 않는다",
    () => {
      const dir = makeFixture({ exitCode: 0 });
      writeFileSync(join(dir, "stray.txt"), "보고에 안 적힌 파일\n");

      runHook(dir);

      // 역할이 보고에 경로를 빠뜨려도 회수되게 한다 — 검사한 트리와 커밋되는 내용이
      // 어긋나지 않는 것이 규약이기도 하다.
      expect(git(dir, ["ls-files"])).toContain("stray.txt");
      expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
    },
    SLOW,
  );

  it(
    "커밋할 변경이 없으면 커밋하지 않고 알린다",
    () => {
      const dir = makeFixture({ exitCode: 0 });
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-qm", "seed"]);

      const { verdict } = runHook(dir);

      // green 은 맞지만 아무것도 안 만든 것이다. 빈 커밋을 찍어 인계인 척하지 않는다.
      expect(verdict.systemMessage).toContain("인계할 산출물이 없다");
      expect(git(dir, ["log", "--format=%s"]).trim()).toBe("seed");
    },
    SLOW,
  );

  it(
    "상한이 소진돼 red 로 끝나도 산출물은 커밋한다",
    () => {
      const dir = makeFixture({ exitCode: 1 });
      runHook(dir);
      runHook(dir);

      const exhausted = runHook(dir).verdict;

      // 커밋하지 않으면 오케스트레이터는 무엇이 실패했는지조차 볼 수 없다.
      // 머지할지 말지는 그쪽 판단이지만, 볼 수는 있어야 한다.
      expect(exhausted.decision).toBeUndefined();
      expect(git(dir, ["log", "--format=%s"])).toContain("chore(developer)");
    },
    SLOW,
  );

  it(
    "커밋하지 못하면 알리되 종료를 막지는 않는다",
    () => {
      // 역할에는 git 을 고칠 수단이 없어 되돌려 봐야 같은 자리에서 다시 실패한다.
      // 다만 조용히 실패하면 산출물이 사라진 것을 아무도 모른다.
      const dir = makeBareDir("verify-green-nocommit-", 0);

      const released = runHook(dir).verdict;

      expect(released.decision).toBeUndefined();
      expect(released.systemMessage).toContain("커밋하지 못했다");
    },
    SLOW,
  );
});

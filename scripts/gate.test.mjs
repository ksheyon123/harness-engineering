import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { markerPath, recordVerified } from "../.githooks/verified-marker.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { gate, report } from "./gate.mjs";

const dirs = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** 커밋 하나가 있는 임시 저장소. `config` 를 주면 `.claude/harness.config.json` 에 쓴다. */
function repo(config = null) {
  const dir = mkdtempSync(join(tmpdir(), "gate-"));
  dirs.push(dir);

  const git = (args) =>
    execFileSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "g@example.invalid"]);
  git(["config", "user.name", "g"]);

  if (config) {
    const at = join(dir, "harness.config.json");
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, JSON.stringify(config));
  }

  writeFileSync(join(dir, "a.txt"), "a\n");
  git(["add", "-A"]);
  git(["commit", "-q", "--no-verify", "-m", "seed"]);

  return { dir, git, head: () => git(["rev-parse", "HEAD"]).trim() };
}

/** 마커에 적힌 sha 들. 없으면 빈 배열. */
function marks(dir) {
  const path = markerPath(dir);
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

/** 정해진 종료 코드를 내는 가짜 러너. 무엇을 받았는지도 기록한다. */
function runner(status) {
  const calls = [];
  const run = (command, cwd) => {
    calls.push({ command, cwd });
    return status;
  };
  run.calls = calls;
  return run;
}

describe("harness gate — 통과했을 때만 기록한다", () => {
  it("게이트의 종료 코드를 그대로 전달한다", () => {
    const { dir } = repo();

    expect(gate(dir, runner(0)).status).toBe(0);
    expect(gate(dir, runner(1)).status).toBe(1);
    expect(gate(dir, runner(7)).status).toBe(7);
  });

  it("0 이면 `HEAD` 를 기록한다", () => {
    const { dir, head } = repo();

    const result = gate(dir, runner(0));

    expect(result.recorded).toBe(true);
    expect(marks(dir)).toEqual([head()]);
  });

  /**
   * **이 기능의 유일한 급소다.** npm 이 해 주던 "성공했을 때만 기록" 보장이 이 파일로
   * 넘어왔다. 실패했는데 적으면 `pre-push` 는 검증된 적 없는 트리를 통과시키고, 층 2 의
   * 그 방어선이 통째로 무의미해진다.
   */
  describe("0 이 아니면 아무것도 적지 않는다", () => {
    it.each([1, 2, 127])("종료 코드 %i", (status) => {
      const { dir } = repo();

      expect(gate(dir, runner(status)).recorded).toBe(false);
      expect(marks(dir)).toEqual([]);
    });

    it("신호로 죽어 `null` 이어도 적지 않는다", () => {
      // `spawnSync` 는 신호사에 `status: null` 을 낸다. `!== 0` 으로 적으면 통과하는 값이
      // 아니지만, 조건을 뒤집어 쓰다 보면 그 자리가 흐려진다 — 그래서 따로 잰다.
      const { dir } = repo();
      const result = gate(dir, runner(null));

      expect(result.recorded).toBe(false);
      expect(marks(dir)).toEqual([]);
    });

    it("신호사는 종료 코드 1 로 낸다 — `null` 을 흘리면 부르는 쪽이 못 쓴다", () => {
      expect(gate(repo().dir, runner(null)).status).toBe(1);
    });

    it("이미 기록이 있어도 실패가 그것을 덮거나 늘리지 않는다", () => {
      const { dir, head } = repo();
      gate(dir, runner(0));

      gate(dir, runner(1));

      expect(marks(dir)).toEqual([head()]);
    });
  });

  describe("무엇을 돌리는가는 설정이 정한다", () => {
    it("기본값은 `npm test` 다", () => {
      const run = runner(0);
      const result = gate(repo().dir, run);

      expect(result.gate).toBe("npm test");
      expect(run.calls[0].command).toBe("npm test");
    });

    it("`harness.config.json` 의 `gate` 를 그대로 돌린다", () => {
      const run = runner(0);
      const { dir } = repo({ gate: "pytest -q" });

      expect(gate(dir, run).gate).toBe("pytest -q");
      expect(run.calls[0].command).toBe("pytest -q");
    });

    it("게이트를 그 트리에서 돌린다 — 사본에서 부르면 사본이 검사된다", () => {
      const run = runner(0);
      const { dir } = repo();

      gate(dir, run);

      expect(run.calls[0].cwd).toBe(dir);
    });
  });

  describe("기록이 실패해도 게이트 결과를 뒤집지 않는다", () => {
    it("못 적었어도 종료 코드는 0 이다", () => {
      // 못 적으면 push 에서 막히고 그때 다시 돌리면 된다. 반대로 여기서 1 을 내면
      // **통과한 게이트가 실패로 보인다.**
      const result = gate(repo().dir, runner(0), () => false);

      expect(result.status).toBe(0);
      expect(result.recorded).toBe(false);
    });

    it("커밋이 하나도 없으면 적을 sha 가 없다", () => {
      const dir = mkdtempSync(join(tmpdir(), "gate-empty-"));
      dirs.push(dir);
      execFileSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(), stdio: "ignore" });

      const result = gate(dir, runner(0));

      expect(result.status).toBe(0);
      expect(result.recorded).toBe(false);
    });
  });

  describe("보고", () => {
    it("실패하면 push 가 막힌다는 것을 말한다", () => {
      expect(report({ gate: "npm test", status: 1, recorded: false })).toContain("push 되지 않는다");
    });

    it("통과했는데 기록을 못 남긴 것을 따로 말한다", () => {
      // 이 상태가 조용히 지나가면 사람은 push 에서 막히고 이유를 모른다.
      const text = report({ gate: "npm test", status: 0, recorded: false });

      expect(text).toContain("기록을 못 남겼다");
    });

    it("통과하면 push 할 수 있다고 말한다", () => {
      expect(report({ gate: "npm test", status: 0, recorded: true })).toContain("push 할 수 있다");
    });
  });
});

describe("recordVerified — 적는 방법은 하나뿐이다", () => {
  it("`posttest` 경로와 `harness gate` 가 같은 자리에 같은 형식으로 적는다", () => {
    // 사본이 둘이면 한쪽이 형식을 바꿀 때 `pre-push` 가 다른 쪽 기록을 조용히 못 읽는다.
    const { dir, head } = repo();

    recordVerified(dir);

    expect(marks(dir)).toEqual([head()]);
  });

  it("같은 sha 를 두 번 적지 않는다", () => {
    const { dir, head } = repo();

    recordVerified(dir);
    recordVerified(dir);

    expect(marks(dir)).toEqual([head()]);
  });
});

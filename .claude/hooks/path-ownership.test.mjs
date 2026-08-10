import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./path-ownership.mjs", import.meta.url));
const REPO = "C:/repo";

/** 부모의 `HARNESS_*` 를 지운 env — 작업 세션 안에서 돌려도 결과가 흔들리지 않게. */
function baseEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("HARNESS_")) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * @param {string} path 저장소 상대 경로
 * @param {{role?: string, agent?: string, cwd?: string, absolute?: string}} opts
 */
function ask(path, { role, agent, cwd = REPO, absolute } = {}) {
  const input = {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    cwd,
    tool_input: { file_path: absolute ?? join(cwd, path) },
    ...(agent ? { agent_type: agent, agent_id: "a1" } : {}),
  };

  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: baseEnv(role === undefined ? {} : { HARNESS_ROLE: role }),
  });

  const out = JSON.parse(result.stdout).hookSpecificOutput;
  return { verdict: out.permissionDecision, why: out.permissionDecisionReason ?? "" };
}

const WORK = { role: "work-session" };

describe("path-ownership — 층 1 경로 소유권", () => {
  describe("실행자 (HARNESS_ROLE 없음)", () => {
    it("하네스는 본업이라 통과한다", () => {
      expect(ask(".claude/hooks/verify-green.mjs").verdict).toBe("defer");
      expect(ask(".githooks/pre-commit.mjs").verdict).toBe("defer");
      expect(ask("package.json").verdict).toBe("defer");
    });

    it("저장소 코드는 막는다", () => {
      // 오타·리팩터도 마찬가지다. '인수기준이 바뀌나?' 를 실행자가 판단하게 두지 않는다.
      const { verdict, why } = ask("src/convex-hull.js");

      expect(verdict).toBe("deny");
      expect(why).toContain("spawn.ps1");
    });

    it("spec 도 막는다", () => {
      expect(ask("harness/thing/spec.md").verdict).toBe("deny");
    });
  });

  describe("작업 세션", () => {
    it("spec 은 자기 산출물이라 통과한다", () => {
      expect(ask("harness/thing/spec.md", WORK).verdict).toBe("defer");
    });

    it("하네스를 고치려 하면 막는다", () => {
      const { verdict, why } = ask(".claude/CLAUDE.md", WORK);

      expect(verdict).toBe("deny");
      expect(why).toContain("실행자 자리");
    });

    it("게이트 정의도 막는다", () => {
      expect(ask("package.json", WORK).verdict).toBe("deny");
      expect(ask("vitest.config.mjs", WORK).verdict).toBe("deny");
    });

    it("소스는 deny 가 아니라 ask 다", () => {
      // PreToolUse 에는 --no-verify 가 없다. 머지 충돌을 푸는 정당한 필요가 있으므로
      // 사람에게 넘긴다 — 갇히게 두지 않는다.
      const { verdict, why } = ask("src/convex-hull.js", WORK);

      expect(verdict).toBe("ask");
      expect(why).toContain("머지 충돌");
    });
  });

  describe("developer", () => {
    it("소스와 테스트는 통과한다", () => {
      expect(ask("src/convex-hull.js", { agent: "developer" }).verdict).toBe("defer");
      expect(ask("src/convex-hull.test.js", { agent: "developer" }).verdict).toBe("defer");
    });

    it("spec 을 고치려 하면 막는다", () => {
      // 자기가 요구사항을 고쳐 통과시키면 검증이 무의미해진다.
      const { verdict, why } = ask("harness/thing/spec.md", { agent: "developer" });

      expect(verdict).toBe("deny");
      expect(why).toContain("고치지 말고 보고");
    });

    it("게이트 정의를 고치려 하면 막는다", () => {
      expect(ask("package.json", { agent: "developer" }).verdict).toBe("deny");
      expect(ask(".claude/hooks/verify-green.mjs", { agent: "developer" }).verdict).toBe("deny");
    });
  });

  describe("qa", () => {
    it("체크리스트만 쓸 수 있다", () => {
      expect(ask("harness/thing/qa-checklist.md", { agent: "qa" }).verdict).toBe("defer");
    });

    it("spec 도 소스도 막는다", () => {
      expect(ask("harness/thing/spec.md", { agent: "qa" }).verdict).toBe("deny");
      expect(ask("src/convex-hull.js", { agent: "qa" }).verdict).toBe("deny");
    });
  });

  it("agent_type 이 HARNESS_ROLE 을 이긴다", () => {
    // 서브에이전트는 세션의 env 를 그대로 물려받는다. 이걸 놓치면 developer 가 작업
    // 세션으로 오인되어 spec 을 고칠 수 있게 된다 — 층 1 의 유일한 함정이다.
    const { verdict } = ask("harness/thing/spec.md", { role: "work-session", agent: "developer" });

    expect(verdict).toBe("deny");
  });

  it("모르는 에이전트는 판정하지 않는다", () => {
    expect(ask("src/x.js", { agent: "Explore" }).verdict).toBe("defer");
  });

  it("모르는 HARNESS_ROLE 은 판정하지 않는다", () => {
    // session-role 훅이 이미 '판정할 수 없다' 를 알린다. 여기서 또 막으면 갇힌다.
    expect(ask("src/x.js", { role: "planner" }).verdict).toBe("defer");
  });

  it("저장소 밖 경로는 판정하지 않는다", () => {
    // 스크래치패드 등. 우리 관할이 아니다.
    expect(ask("", { absolute: "C:/tmp/scratch/note.md" }).verdict).toBe("defer");
  });

  it("file_path 가 없으면 판정하지 않는다", () => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", cwd: REPO }),
      encoding: "utf8",
      env: baseEnv(),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("defer");
  });

  it("worktree 안의 경로도 그 트리 기준으로 본다", () => {
    // 작업 세션·서브에이전트는 사본 안에서 돈다. cwd 가 곧 그 트리의 루트다.
    const wt = "C:/repo/.claude/worktrees/agent-a1";

    expect(ask("src/x.js", { agent: "developer", cwd: wt }).verdict).toBe("defer");
    expect(ask("harness/t/spec.md", { agent: "developer", cwd: wt }).verdict).toBe("deny");
  });
});

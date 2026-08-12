import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
      // 안내하는 명령이 설치본에도 있어야 한다 — `scripts/` 는 A 에 복사되지 않는다.
      expect(why).toContain("harness spawn");
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

    it("하네스 문서는 막지 않는다", () => {
      // 고쳐도 강제되는 것이 하나도 안 바뀐다. 층이 판정할 대상이 아니다.
      expect(ask("docs/backlog.md", WORK).verdict).toBe("defer");
      expect(ask("README.md", WORK).verdict).toBe("defer");
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
    it("소스와 테스트는 allow 로 확정한다", () => {
      // defer 가 아니다. defer 는 '결정하지 않음' 이라 정상 권한 흐름으로 넘어가고,
      // 거기서 승인 프롬프트가 뜨면 답할 사람이 없어 서브에이전트가 멈춘다.
      expect(ask("src/convex-hull.js", { agent: "developer" }).verdict).toBe("allow");
      expect(ask("src/convex-hull.test.js", { agent: "developer" }).verdict).toBe("allow");
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

  describe("설정을 읽는다", () => {
    /** `harness.config.json` 이 놓인 임시 트리. 훅은 이 트리를 `cwd` 로 판정한다. */
    function repoWith(config) {
      const dir = mkdtempSync(join(tmpdir(), "path-ownership-"));
      writeFileSync(join(dir, "harness.config.json"), JSON.stringify(config));
      return dir;
    }

    it("source 를 바꾸면 그 경로가 저장소 코드가 된다", () => {
      const cwd = repoWith({ source: ["app/**"] });

      expect(ask("app/main.py", { cwd }).verdict).toBe("deny"); // 실행자는 코드를 안 고친다
      expect(ask("app/main.py", { ...WORK, cwd }).verdict).toBe("ask");
      expect(ask("src/legacy.js", { cwd }).verdict).toBe("defer"); // 더는 소스가 아니다
    });

    it("specRoot 를 바꾸면 spec 과 체크리스트가 따라간다", () => {
      const cwd = repoWith({ specRoot: "docs/specs" });

      expect(ask("docs/specs/login/spec.md", { ...WORK, cwd }).verdict).toBe("defer");
      expect(ask("docs/specs/login/spec.md", { agent: "developer", cwd }).verdict).toBe("deny");
      expect(ask("docs/specs/login/qa-checklist.md", { agent: "qa", cwd }).verdict).toBe("allow");
      expect(ask("harness/login/spec.md", { agent: "qa", cwd }).verdict).toBe("deny");
    });

    it("harnessFiles 를 바꾸면 작업 세션이 막히는 곳이 바뀐다", () => {
      const cwd = repoWith({ harnessFiles: ["tools/**"] });

      expect(ask("tools/gate.sh", { ...WORK, cwd }).verdict).toBe("deny");
      expect(ask("package.json", { ...WORK, cwd }).verdict).toBe("defer"); // 목록에서 빠졌다
    });
  });

  describe("qa", () => {
    it("체크리스트만 쓸 수 있고, 그것은 allow 로 확정한다", () => {
      expect(ask("harness/thing/qa-checklist.md", { agent: "qa" }).verdict).toBe("allow");
    });

    it("spec 도 소스도 막는다", () => {
      expect(ask("harness/thing/spec.md", { agent: "qa" }).verdict).toBe("deny");
      expect(ask("src/convex-hull.js", { agent: "qa" }).verdict).toBe("deny");
    });
  });

  describe("사람이 없는 자리는 프롬프트에 걸리지 않는다", () => {
    // 서브에이전트가 승인 프롬프트를 만나면 답할 사람이 없어 그 자리에서 멈춘다. 멈추는
    // 것은 끝나는 것과 달라서 SubagentStop 이 돌지 않고, 게이트도 인계 커밋도 없이
    // base 그대로인 브랜치와 빈 worktree 만 남는다 — 신호 하나 없이. 실제로 그렇게 죽었다.

    it("서브에이전트에는 ask 를 내지 않는다", () => {
      // 같은 경로라도 자리가 다르면 물을 수 없다.
      expect(ask("src/convex-hull.js", WORK).verdict).toBe("ask");
      expect(ask("src/convex-hull.js", { agent: "developer" }).verdict).toBe("allow");
    });

    it("사람이 붙어 있는 자리는 defer 를 유지한다", () => {
      // allow 로 답하면 사용자의 permission 설정을 건너뛴다. 물어볼 사람이 있으면
      // 그럴 이유가 없다 — 이 훅이 답할 것은 '만져도 되는 경로인가' 뿐이다.
      expect(ask(".claude/hooks/verify-green.mjs").verdict).toBe("defer");
      expect(ask("harness/thing/spec.md", WORK).verdict).toBe("defer");
    });

    it("저장소 밖은 사람이 없는 자리라도 판정하지 않는다", () => {
      // 규칙이 없는 곳까지 allow 로 열지 않는다. 관할 밖은 관할 밖이다.
      const out = ask("", { agent: "developer", absolute: "C:/tmp/scratch/note.md" });

      expect(out.verdict).toBe("defer");
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

    expect(ask("src/x.js", { agent: "developer", cwd: wt }).verdict).toBe("allow");
    expect(ask("harness/t/spec.md", { agent: "developer", cwd: wt }).verdict).toBe("deny");
  });
});

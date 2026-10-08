import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./role-context.mjs", import.meta.url));

/** 이 저장소의 최상단. 배포되는 `.claude/roles/` 가 실제로 실리는지 볼 때 쓴다. */
const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** `<트리>/.claude/roles/` 에 지침을 깔아 둔 임시 트리. */
function treeWithRoles(docs) {
  const tree = mkdtempSync(join(tmpdir(), "role-context-"));
  const dir = join(tree, ".claude", "roles");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(docs)) writeFileSync(join(dir, name), body);
  return tree;
}

function runHook({ agentType, cwd }) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: agentType, agent_id: "a1", cwd }),
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    out: stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null,
  };
}

describe("role-context — SubagentStart 역할 지침 주입 훅", () => {
  it("역할의 지침 파일을 싣는다", () => {
    const cwd = treeWithRoles({ "developer.md": "개발자 지침 본문\n", "qa.md": "QA 지침 본문\n" });

    const { status, out } = runHook({ agentType: "developer", cwd });

    expect(status).toBe(0);
    expect(out.hookEventName).toBe("SubagentStart");
    expect(out.additionalContext).toContain("개발자 지침 본문");
    expect(out.additionalContext).not.toContain("QA 지침 본문");
  });

  it("어느 파일에서 왔는지와 우선순위를 머리에 밝힌다", () => {
    // 에이전트 정의 본문(A 의 것)과 부딪힐 때 어느 쪽이 이기는지 역할이 알아야 한다.
    const cwd = treeWithRoles({ "qa.md": "QA 지침 본문\n" });

    const { out } = runHook({ agentType: "qa", cwd });

    expect(out.additionalContext).toContain(".claude/roles/qa.md");
    expect(out.additionalContext).toContain("이긴다");
  });

  it("하네스 역할인데 지침이 없으면 일을 시작하지 말라고 한다", () => {
    // 조용히 지나가면 그 역할은 게이트도 경계도 모른 채 돈다.
    const cwd = treeWithRoles({});

    const { status, out } = runHook({ agentType: "developer", cwd });

    expect(status).toBe(0); // 차단할 수 없는 이벤트다 — 통보로 끝낸다
    expect(out.additionalContext).toContain("시작하지 말고");
  });

  it("빈 파일은 없는 것과 같다", () => {
    const cwd = treeWithRoles({ "developer.md": "  \n" });

    const { out } = runHook({ agentType: "developer", cwd });

    expect(out.additionalContext).toContain("시작하지 말고");
  });

  it("하네스 역할이 아니면 아무것도 내지 않는다", () => {
    // matcher 가 빠져도 Explore 같은 것에 경고를 뿌리지 않는다.
    const cwd = treeWithRoles({});

    for (const agentType of ["Explore", "general-purpose", "../developer", undefined]) {
      const { status, out } = runHook({ agentType, cwd });
      expect(status).toBe(0);
      expect(out).toBe(null);
    }
  });

  it("배포되는 지침이 실제로 실린다", () => {
    // 이 저장소의 `.claude/roles/` 가 곧 설치본에 복사되는 것이다.
    for (const role of ["developer", "qa"]) {
      const { out } = runHook({ agentType: role, cwd: REPO });
      const body = readFileSync(join(REPO, ".claude", "roles", `${role}.md`), "utf8").trim();

      expect(out.additionalContext).toContain(body);
    }
  });
});

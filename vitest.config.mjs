import { defineConfig, defaultExclude } from "vitest/config";

// isolation 서브에이전트(`.claude/agents/*.md` 의 `isolation: worktree`)는
// `.claude/worktrees/agent-<id>/` 에 저장소 **사본**을 만든다. 그 사본은 저장소 안에
// 있으므로 부모에서 돌린 vitest 의 글로빙에 다시 걸리고, 같은 테스트가 두 번씩 돈다
// (실측: 172 → 344. worktree 가 늘수록 배수로 늘어난다).
//
// 오염은 한 방향뿐이다 — 사본 안에서 돌린 게이트는 부모를 보지 못한다(cwd 가 사본이라
// 글로빙 루트가 거기다). 그래서 막아야 하는 것은 **오케스트레이터 자신의 실행**이다.
//
// `defaultExclude` 를 펼쳐서 더한다. 통째로 덮어쓰면 `node_modules`·`dist` 가 다시
// 테스트 대상이 된다.
export default defineConfig({
  test: {
    exclude: [...defaultExclude, "**/.claude/worktrees/**"],
  },
});

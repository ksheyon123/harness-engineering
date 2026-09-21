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
//
// **`testTimeout` 을 기본값(5초)보다 넉넉히 둔다.** 이 저장소의 테스트는 실제 git 훅과
// worktree 동작을 검증하는 것이 목적이라 임시 저장소를 만들고 git·node 서브프로세스를
// 수십 번 띄운다. Windows 에서는 서브프로세스 하나가 수백 ms~1 초 넘게 걸려서, 평소 4초
// 안팎이던 테스트(`install/smoke.test.mjs` 의 첫 테스트)가 전체 게이트를 동시에 돌릴 때
// 부하만 조금 늘어도 5초를 넘긴다 — 코드가 틀려서가 아니라 여유가 없어서 실패하고, 실패
// 하는 테스트도 실행마다 달랐다. 게이트가 무작위로 red 가 되면 push 가 막혀 신호로서의
// 가치가 없어진다.
export default defineConfig({
  test: {
    exclude: [...defaultExclude, "**/.claude/worktrees/**"],
    testTimeout: 30_000,
  },
});

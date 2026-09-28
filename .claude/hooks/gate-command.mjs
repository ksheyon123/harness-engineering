/**
 * 게이트 지점이 **실제로 돌릴 명령**을 정한다 — 변경분만(`changedGate`)인가, 전체(`gate`)인가.
 *
 * ## 왜 기본이 변경분인가
 *
 * 전체 게이트는 두 가지로 사람을 붙잡았다. 느리고(developer 하나가 재시도까지 여러 번
 * 돈다), **이번 변경과 무관한 기존 테스트가 부하로 타임아웃되면 그 실패를 떠안는다** —
 * developer 는 자기가 만들지 않은 red 를 고칠 수 없어 상한까지 돌다 red 인 채 인계된다.
 * 변경분만 돌리면 둘 다 사라진다.
 *
 * **대가**: 러너는 import 그래프로 관련 테스트를 고른다. 테스트가 대상을 import 하지 않고
 * 자식 프로세스로 부르면(CLI·E2E) 관련 테스트가 빠지고, 설정 파일만 바꾼 변경은 아무것도
 * 안 돌 수 있다. 그런 저장소는 `changedGate: null` 로 끈다. 이 하네스 원본이 그렇다.
 *
 * ## 기준 커밋(`{base}`)은 부르는 자리가 정한다
 *
 * | 자리 | 기준 | 그래서 잡히는 변경 |
 * |---|---|---|
 * | 종료 훅(`verify-green`) | 역할 worktree 의 `HEAD` — spawn 지점 | 그 역할이 이번에 고친 것(아직 커밋 전) |
 * | `harness gate` | 보호 브랜치와의 merge-base | task 브랜치 전체 — 여러 developer 를 합친 결과 포함 |
 *
 * `harness gate` 가 task 전체를 기준으로 삼으므로, developer A·B 가 각자는 green 인데 합쳐서
 * 깨지는 경우도 **합친 트리 위에서** 두 쪽 관련 테스트가 다 돌아 걸린다.
 *
 * ## 기준을 못 잡으면 전체를 돈다
 *
 * 커밋이 없거나, 보호 브랜치가 없거나, 이미 보호 브랜치 위에 서 있으면(merge-base 가 `HEAD`
 * 자신) "무엇이 바뀌었나" 가 성립하지 않는다. 그때 변경분 명령을 돌리면 러너는 "바뀐 것
 * 없음" 으로 **아무것도 안 돌고 green** 을 낸다 — 검사 없는 통과가 기록된다. 그래서 전체로
 * 떨어진다. 느린 쪽으로 틀리는 것이 조용히 틀리는 것보다 낫다.
 */

import { execFileSync } from "node:child_process";

import { loadConfig } from "./harness-config.mjs";
import { cleanEnv } from "./hook-kit.mjs";

/** `changedGate` 안에서 기준 커밋으로 바뀌는 자리. */
export const BASE_PLACEHOLDER = "{base}";

/**
 * @param {string} tree 게이트를 돌릴 트리
 * @param {{base: string|null, config?: ReturnType<typeof loadConfig>}} options
 *   `base` 는 부르는 자리가 구한 기준 커밋(`spawnBase` · `branchBase`). `null` 이면 전체.
 * @returns {{command: string, base: string|null}} 돌릴 명령과, 변경분이면 그 기준
 */
export function gateCommand(tree, { base, config = loadConfig(tree) }) {
  if (!config.changedGate || !base) return { command: config.gate, base: null };
  return { command: config.changedGate.split(BASE_PLACEHOLDER).join(base), base };
}

/**
 * 종료 훅의 기준 — 역할 worktree 의 `HEAD`. `worktree.baseRef` 가 `head` 라 이것이 곧
 * spawn 지점이고, 역할의 산출물은 인계 커밋 전이라 전부 그 위의 미커밋 변경이다.
 *
 * @returns {string|null} 커밋이 없거나 저장소가 아니면 `null`
 */
export function spawnBase(tree) {
  return git(tree, ["rev-parse", "HEAD"]);
}

/**
 * `harness gate` 의 기준 — 보호 브랜치와의 merge-base. 로컬 브랜치가 없으면 `origin/` 쪽을
 * 본다. 로컬이 낡았어도 merge-base 가 더 과거로 갈 뿐이라 **더 많이** 돌 뿐 덜 돌지 않는다.
 *
 * @param {string} tree
 * @param {string[]} protectedBranches
 * @returns {string|null} 못 찾았거나 `HEAD` 자신이면 `null`(전체를 돌라는 뜻)
 */
export function branchBase(tree, protectedBranches) {
  const head = git(tree, ["rev-parse", "HEAD"]);
  if (!head) return null;

  for (const branch of protectedBranches) {
    for (const ref of [branch, `origin/${branch}`]) {
      const base = git(tree, ["merge-base", "HEAD", ref]);
      if (base) return base === head ? null : base;
    }
  }
  return null;
}

function git(cwd, args) {
  try {
    return (
      execFileSync("git", args, {
        cwd,
        env: cleanEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

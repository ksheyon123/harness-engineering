#!/usr/bin/env node
/**
 * SubagentStop 훅 — 이 에이전트는 green 이 아니면 끝낼 수 없다.
 *
 * 게이트(`npm test`)를 돌려 red 면 종료를 거부하고 실패 출력을 그대로 돌려준다.
 * 같은 에이전트가, 같은 worktree 에서, 자기 컨텍스트를 그대로 들고 이어서 고친다 —
 * 실패를 경계 밖으로 넘기지 않기 위함이다.
 *
 * 훅은 에이전트의 도구 제약을 받지 않는다. 그래서 developer 에게 Bash 를 주지 않고도
 * 게이트가 돈다 — "게이트를 돌리려면 그 역할에 Bash 를 줘야 한다"는 전제가 사라진다.
 *
 * 게이트 대상의 단일 출처는 `package.json` 의 `scripts.test` 다. 여기에 명령을 적지
 * 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋나고, 낡은 사본은 없는 것보다
 * 나쁘다(세션이 틀린 검사를 돌리고 통과했다고 확신한다).
 */

import { execSync } from "node:child_process";
import { cleanEnv, emit, readHookInput, retryBudget } from "./hook-kit.mjs";

/** red 를 몇 번까지 되돌려줄 것인가. 넘으면 차단을 풀어 종료를 허용한다. */
const MAX_ATTEMPTS = 3;

/** 실패 출력이 길면 뒤쪽(실제 실패 지점)이 정보가 많다. */
const TAIL_BYTES = 4000;

const env = cleanEnv();
const input = readHookInput();
const budget = retryBudget("verify-green", { env, input, max: MAX_ATTEMPTS });

let failure = null;
try {
  execSync("npm test", { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  failure = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error);
}

if (failure === null) {
  budget.reset();
  emit(null); // green — 종료를 허용한다.
}

const { count, exhausted, lastChance } = budget.record();

if (exhausted) {
  // 차단을 푼다. 조용히 통과시키지는 않는다 — 오케스트레이터가 red 를 알아야 한다.
  emit({
    systemMessage:
      `게이트 red 인 채로 종료를 허용했다(재시도 ${count ?? "?"}회 소진). ` +
      `이 에이전트의 결과는 green 이 아니다 — 회수 전에 확인이 필요하다.`,
  });
}

emit({
  decision: "block",
  reason:
    `게이트 red — 아직 끝난 것이 아니다. 아래 실패를 고치고 다시 끝내라.\n\n` +
    failure.slice(-TAIL_BYTES) +
    (lastChance
      ? "\n\n이번이 마지막 재시도다. 다음에도 red 면 그대로 종료되니, 고치지 못하겠으면 " +
        "보고에 '게이트 red · 원인 · 자력으로 해결 불가한 이유'를 적어라."
      : ""),
});

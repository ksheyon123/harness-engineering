#!/usr/bin/env node
/**
 * SubagentStop 훅 — 이 에이전트는 green 이 아니면 끝낼 수 없다.
 *
 * 게이트(`npm test`)를 돌려 red 면 종료를 거부하고 실패 출력을 그대로 돌려준다.
 * 같은 에이전트가, 같은 worktree 에서, 자기 컨텍스트를 그대로 들고 이어서 고친다 —
 * 실패를 경계 밖으로 넘기지 않기 위함이다(docs/harness-design.md §6·§7).
 *
 * 훅은 에이전트의 도구 제약을 받지 않는다. 그래서 developer 에게 Bash 를 주지 않고도
 * 게이트가 돈다 — "게이트를 돌리려면 그 역할에 Bash 를 줘야 한다"는 전제가 사라진다.
 *
 * 게이트 대상의 단일 출처는 `package.json` 의 `scripts.test` 다. 여기에 명령을 적지
 * 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋나고, 낡은 사본은 없는 것보다
 * 나쁘다(세션이 틀린 검사를 돌리고 통과했다고 확신한다).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

/** red 를 몇 번까지 되돌려줄 것인가. 넘으면 차단을 풀어 종료를 허용한다. */
const MAX_ATTEMPTS = 3;

/** 실패 출력이 길면 뒤쪽(실제 실패 지점)이 정보가 많다. */
const TAIL_BYTES = 4000;

/**
 * 판정은 **stdout 의 JSON 하나로만** 전달한다. 종료 코드로 하지 않는다:
 * `exit 1` 은 *non-blocking* error 라 사용자에게 메시지만 찍히고 **에이전트는 그대로
 * 끝난다** — 훅이 도는데 아무것도 막지 못하는 상태가 된다. 차단은 `exit 0` + JSON,
 * 또는 `exit 2` + stderr 뿐이다.
 *
 * `console.log` 는 파이프로 나갈 때 비동기라 곧바로 `process.exit` 하면 잘릴 수 있다.
 * 판정이 잘려 나가면 Claude Code 는 파싱할 JSON 이 없다고 보고 종료를 허용한다 —
 * 훅이 돌았는데 아무것도 막지 못한다. 동기 write 로 고정한다.
 */
function emit(payload) {
  if (payload) writeSync(1, JSON.stringify(payload));
  process.exit(0);
}

/**
 * 상속된 `GIT_*` 를 전부 씻어낸 env.
 *
 * `GIT_DIR` 이 설정돼 있으면 git 은 cwd 에서 위로 올라가며 저장소를 찾는 탐색을 통째로
 * 건너뛰고 그 값을 쓴다. `git -C <dir>` 도 `cwd` 도 이것을 이기지 못한다 — 임시
 * 디렉터리를 겨냥한 것처럼 보이는 명령이 실제로는 다른 저장소를 건드린다.
 *
 * 이 훅은 `npm test` 를 띄우므로 오염을 **전파하는 지점**이다. 씻지 않으면 git 을 부르는
 * 모든 테스트가 그 env 를 물려받는다. 자식을 띄우는 쪽이 매번 책임진다.
 */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  // 실패 출력은 사람이 아니라 모델이 읽는다. ANSI 색상은 읽는 데 도움이 안 되면서
  // `reason` 의 길이만 늘린다.
  env.NO_COLOR = "1";
  return env;
}

/** 훅 입력(JSON on stdin). 없거나 깨져도 판정 자체는 계속되어야 한다. */
function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/**
 * 시도 카운터는 **이 worktree 의 gitdir** 에 둔다. 링크된 worktree 의
 * `--absolute-git-dir` 은 `<main>/.git/worktrees/<id>` 라 에이전트마다 자연히 격리되고,
 * worktree 가 사라질 때 함께 사라진다. 추적되지도 않는다.
 *
 * 해석에 실패하면 `null` — 호출부가 `stop_hook_active` 로 대체한다.
 */
function counterPath(env) {
  try {
    const gitDir = execSync("git rev-parse --absolute-git-dir", {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitDir ? join(gitDir, "harness-verify-green-attempts") : null;
  } catch {
    return null;
  }
}

function bumpAttempts(path) {
  if (!path) return null;
  let count = 0;
  try {
    count = Number.parseInt(readFileSync(path, "utf8"), 10) || 0;
  } catch {
    count = 0;
  }
  count += 1;
  try {
    writeFileSync(path, String(count));
  } catch {
    return null;
  }
  return count;
}

function clearAttempts(path) {
  if (!path) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* 카운터 정리 실패가 green 판정을 뒤집어서는 안 된다. */
  }
}

// ── 판정 ────────────────────────────────────────────────────────────────────

const env = cleanEnv();
const input = readHookInput();
const path = counterPath(env);

let failure = null;
try {
  execSync("npm test", {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  failure = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error);
}

if (failure === null) {
  clearAttempts(path);
  emit(null); // green — 종료를 허용한다.
}

const attempts = bumpAttempts(path);

// 카운터를 못 쓰면 훅 입력의 `stop_hook_active` 로 대체한다(재시도 1회).
// 상한이 아예 없는 것보다는 낫다 — 못 고치는 원인에서 영원히 갇히는 것을 막는 게
// 이 분기의 목적이다.
const exhausted =
  attempts === null ? input.stop_hook_active === true : attempts >= MAX_ATTEMPTS;

if (exhausted) {
  // 차단을 푼다. 조용히 통과시키지는 않는다 — 오케스트레이터가 red 를 알아야 한다.
  emit({
    systemMessage:
      `게이트 red 인 채로 종료를 허용했다(재시도 ${attempts ?? "?"}회 소진). ` +
      `이 에이전트의 결과는 green 이 아니다 — 회수 전에 확인이 필요하다.`,
  });
}

const remaining = attempts === null ? 1 : MAX_ATTEMPTS - attempts;
const lastChance =
  remaining <= 1
    ? "\n\n이번이 마지막 재시도다. 다음에도 red 면 그대로 종료되니, 고치지 못하겠으면 " +
      "보고에 '게이트 red · 원인 · 자력으로 해결 불가한 이유'를 적어라."
    : "";

emit({
  decision: "block",
  reason:
    `게이트 red — 아직 끝난 것이 아니다. 아래 실패를 고치고 다시 끝내라.\n\n` +
    `${failure.slice(-TAIL_BYTES)}${lastChance}`,
});

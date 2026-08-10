#!/usr/bin/env node
/**
 * SessionStart 훅 — 세션에게 **자기가 누구인지** 알려준다.
 *
 * CLAUDE.md 는 모든 세션에 똑같이 로드되므로 역할을 가르지 못한다. 지금까지 그 판정은
 * 사람의 첫 발화에 기대고 있었는데, 그건 정의상 신뢰할 수 없다 — 세션이 대화를 보고
 * 자기 역할을 정하면 **정해졌을 땐 이미 논의를 받은 뒤**다.
 *
 * 그래서 역할을 **프로세스 환경**에 둔다. `scripts/spawn.ps1` 이 자식 프로세스에
 * `HARNESS_ROLE` 을 심고, 이 훅이 그 값을 읽어 컨텍스트로 주입한다. 세션이 만들어낸 값이
 * 아니라 **부모가 심은 값**이라는 것이 요점이다. 맨몸 `claude` 에는 변수가 없고, 그
 * 부재가 곧 '실행자' 다.
 *
 * 환경변수를 골랐기 때문에 이것이 **컨텍스트 초기화를 견딘다.** `/clear` 이후에도 훅이
 * 다시 돌고(`source: "clear"`) 변수는 프로세스에 그대로 있다. 대화에 적어둔 역할 선언은
 * 그 지점에서 사라진다.
 *
 * **이것은 강제가 아니라 통보다.** `SessionStart` 는 차단할 수 없는 이벤트다. 진짜
 * 강제는 층 1(`PreToolUse` 경로 소유권)이 같은 변수를 읽어 붙일 때 생긴다.
 *
 * > 주의: 서브에이전트는 세션의 env 를 물려받으므로 `HARNESS_ROLE` 을 그대로 갖는다.
 * > `SessionStart` 가 서브에이전트에는 돌지 않아 지금은 문제가 없지만, 층 1 이 이 변수로
 * > 경로를 강제하게 되면 **서브에이전트가 작업 세션으로 오인된다.** 그때는 변수만으로
 * > 부족하고 훅 입력의 에이전트 정보를 함께 봐야 한다.
 */

import { readFileSync, rmSync } from "node:fs";
import { emit, readHookInput } from "./hook-kit.mjs";

/** `HARNESS_ROLE` 이 이 값이면 작업 세션. 미설정이면 실행자. 그 외는 오설정이다. */
const WORK_SESSION = "work-session";

/** 세션이 처음 열린 경우에만 seed 를 싣는다. resume·clear 에 다시 실으면 작업이 중복된다. */
const FIRST_TURN = "startup";

const EXECUTOR = `너는 **실행자**다 — 맨몸 \`claude\` 로 열렸다(\`HARNESS_ROLE\` 미설정). 파이프라인 밖에 서 있다.

- **기능 요청·설계 논의는 받지 않는다.** \`scripts/spawn.ps1 "<사람의 원문>"\` 으로 작업 세션을 새 탭에 띄우고, 그 탭에서 논의하라고 안내한다. "로그인 어떻게 만들까" 처럼 코드가 아직 안 바뀌는 것도 **미래를 정하는 일이라 넘긴다.**
- **저장소 코드를 고치지 않는다.** 오타·리팩터도 마찬가지다. 하네스(\`.claude/\` · \`.githooks/\` · 루트 설정 · 문서)가 네 본업이다.
- 넘길 때는 **사람의 원문을 그대로** 싣는다. 요약해서 넘기면 spec 이 그 요약 수준에서 멈춘다.
- 하네스를 고칠 때도 \`main\`/\`dev\` 에 직접 커밋하지 않는다 — 브랜치를 자른다.`;

const WORK = `너는 **작업 세션**이다(\`HARNESS_ROLE=${WORK_SESSION}\`). 이 세션은 **한 task** 를 끝까지 들고 간다.

- **기획자 모드로 시작한다.** 사람과 논의하는 것이 본업이다. 논의는 저장소 본체에서(읽기만) 하고, task 가 정해지면 \`EnterWorktree\` 로 격리에 들어가 \`harness/<task>/spec.md\` 를 쓴다.
- **spec 커밋이 모드 전환점**이다. 그 뒤로는 오케스트레이터 모드 — 묻지 않고 스폰 · 회수 · 검증 · QA · push 까지 간다. 멈추는 것은 닫힌 집합에 해당할 때뿐이다.
- **하네스 파일(\`.claude/\` · \`.githooks/\` · 루트 설정)은 고치지 않는다** — 실행자 자리다.
- 세션은 끝나면 닫힌다. **spec 에 안 적힌 것은 없는 것이다.**`;

const input = readHookInput();
const role = (process.env.HARNESS_ROLE ?? "").trim();

emit({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: contextFor(role),
    ...seed(input),
  },
});

function contextFor(value) {
  if (value === "") return EXECUTOR;
  if (value === WORK_SESSION) return WORK;

  // 조용히 실행자로 떨어뜨리지 않는다. 오설정을 기본값으로 흡수하면 역할이 틀린 채로
  // 일이 굴러가고, 그 사실을 아무도 모른다.
  return (
    `\`HARNESS_ROLE\` 이 \`${value}\` 다 — 하네스가 아는 값이 아니다. ` +
    `**네가 실행자인지 작업 세션인지 판정할 수 없다.** 아는 값은 \`${WORK_SESSION}\`(작업 세션) ` +
    `또는 미설정(실행자)뿐이다. 일을 시작하기 전에 이 사실을 사람에게 알려라.`
  );
}

/**
 * 사람의 원문. `spawn` 이 **파일로** 건넨다 — 명령줄에 끼워 넣으면 따옴표·줄바꿈이
 * 셸마다 다르게 깨지는데, 원문을 온전히 옮기는 것이 이 경로의 존재 이유다.
 */
function seed(hookInput) {
  if (hookInput.source !== FIRST_TURN) return {};

  const path = (process.env.HARNESS_SEED_FILE ?? "").trim();
  if (!path) return {};

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // seed 를 못 읽었다고 역할 선언까지 잃을 수는 없다. 사람이 다시 말하면 된다.
    return {};
  }

  // 한 번 쓰고 버리는 파일이다. 남겨두면 사람의 요청 원문이 임시 디렉터리에 계속 쌓인다.
  try {
    rmSync(path, { force: true });
  } catch {
    /* 정리 실패가 seed 전달을 뒤집어서는 안 된다. */
  }

  // PowerShell 5.1 의 `Set-Content -Encoding UTF8` 은 BOM 을 붙인다.
  const trimmed = text.replace(/^﻿/, "").trim();
  return trimmed ? { initialUserMessage: trimmed } : {};
}

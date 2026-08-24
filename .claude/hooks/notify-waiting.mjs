#!/usr/bin/env node
/**
 * `Notification` 훅 — **세션이 사람을 기다리기 시작했다**를 밖으로 알린다.
 *
 * ## 왜 이 지점인가
 *
 * 오케스트레이터 모드는 사람이 떠나 있는 것을 전제로 돈다. 그런데 승인 프롬프트가 뜨면
 * 세션은 **끝나는 게 아니라 멈춘다** — 규약이 여러 번 짚는 그 실패다. 멈춘 것은 종료가
 * 아니라서 `SubagentStop` 도 `Stop` 도 돌지 않고, 아무 신호 없이 자리만 지킨다.
 * 사람이 자리를 비운 사이 그것을 알릴 수 있는 훅이 `Notification` 하나다.
 *
 * ## 아무것도 막지 않는다
 *
 * `Notification` 은 판정을 받는 이벤트가 아니다. 여기서는 stdout 에 아무것도 쓰지 않고
 * 항상 0 으로 끝난다 — 알림이 실패해도(목적지가 죽었든 URL 이 없든) 세션은 그대로 간다.
 */

import { readHookInput } from "./hook-kit.mjs";
import { notify, where } from "./notify.mjs";

const input = readHookInput();

// 훅 입력의 `cwd` 를 쓴다 — 이 훅은 세션의 트리에서 돌고, 설정과 비밀은 그 트리의 것을
// 읽어야 한다. 작업 세션은 worktree 사본 안에 서 있어 본체와 다르다.
const baseDir = input.cwd || process.cwd();

const message = `${input.message ?? ""}`.trim() || "세션이 입력을 기다린다.";
const place = where(baseDir);

await notify("notification", {
  baseDir,
  text: `⏸ 하네스가 사람을 기다린다${place ? ` — ${place}` : ""}\n${message}`,
  detail: { message, session: input.session_id ?? null },
});

process.exit(0);

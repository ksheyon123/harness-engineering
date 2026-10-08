#!/usr/bin/env node
/**
 * SubagentStart 훅 — 스폰된 역할에게 **하네스가 소유하는 역할 지침**을 싣는다.
 *
 * ## 왜 에이전트 정의에서 갈라냈나
 *
 * 에이전트 정의(`.claude/agents/<역할>.md`)에는 두 가지가 섞여 있었다 — 훅과 맞물린 약속
 * (게이트 · 인계 커밋 · `COMMIT:` 줄 · 체크리스트 형식)과, 프로젝트마다 다른 사정(스택 ·
 * 테스트 스타일). 한 파일이라 `sync` 의 선택지가 둘뿐이었다: 덮으면 A 의 수정이 사라지고,
 * 안 덮으면 A 는 약속 쪽 갱신을 영영 못 받는다.
 *
 * 그래서 가른다. 약속은 `.claude/roles/<역할>.md` 에 두고 하네스가 소유하고(`sync` 가
 * 맞춘다), 에이전트 정의는 A 가 소유한다(`sync` 가 안 건드린다). `CLAUDE.md` 가
 * `@harness.md` 를 끌어오는 것과 같은 모양이다.
 *
 * ## 왜 `@` 임포트가 아니라 훅인가 — 실측
 *
 * 에이전트 본문의 `@<경로>` 는 **안 펼쳐진다.** 글자 그대로 시스템 프롬프트에 들어간다.
 * 같은 서브에이전트 안에서 `CLAUDE.md` 의 `@harness.md` 는 펼쳐진다 — 임포트는 메모리
 * 파일의 기능이지 에이전트 정의의 기능이 아니다.
 *
 * 그리고 이 훅은 **`settings.json` 에 걸어야 한다.** 에이전트 frontmatter 의 `hooks:` 에
 * `SubagentStart` 를 적으면 **안 돈다**(실측 — 같은 스폰에서 settings 쪽만 불렸다). 그것도
 * 맞는 동작이다: frontmatter 훅은 그 에이전트가 도는 동안에만 붙는데, 이 이벤트는 그 전에 난다.
 *
 * ## 무엇을 싣나
 *
 * 훅 입력의 `agent_type` 으로 `<cwd>/.claude/roles/<agent_type>.md` 를 찾는다. `cwd` 는
 * **스폰한 세션의 트리**다(실측) — 작업 세션이면 그 worktree 이고, 거기에는 `roles/` 가
 * 커밋이나 심기로 와 있다(`managedPaths()` 에 든다).
 *
 * | 경우 | 무엇을 내나 |
 * |---|---|
 * | 하네스 역할이고 파일이 있다 | 머리 한 줄 + 본문 |
 * | 하네스 역할인데 파일이 없다 | **일을 시작하지 말고 보고하라** — 조용히 지나가면 그 역할은 게이트도 경계도 모른 채 돈다 |
 * | 하네스 역할이 아니다 | 아무것도 — `matcher` 가 빠졌어도 `Explore` 같은 것에 경고를 뿌리지 않는다 |
 *
 * **차단할 수 없는 이벤트다.** `SessionStart` 처럼 통보일 뿐이고, 강제는 층 0(도구)·층 1(경로)·
 * 종료 훅이 한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { emit, readHookInput } from "./hook-kit.mjs";

/** 지침을 싣는 역할. 이 이름들의 지침이 없으면 설치가 깨진 것이다. */
const ROLES = ["developer", "qa"];

/** 역할 지침이 사는 곳. 저장소 최상단 기준이다. */
const ROLES_DIR = ".claude/roles";

const input = readHookInput();
const role = `${input?.agent_type ?? ""}`;

if (!ROLES.includes(role)) emit(null);

emit({
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: contextFor(role, input?.cwd ?? process.cwd()),
  },
});

function contextFor(name, baseDir) {
  const path = `${ROLES_DIR}/${name}.md`;

  let body = "";
  try {
    body = readFileSync(join(baseDir, path), "utf8").trim();
  } catch {
    // 아래로 떨어진다. 없는 것과 빈 것은 같은 처방이다.
  }

  if (!body) {
    return (
      `너의 역할 지침 \`${path}\` 가 없다 — 하네스 설치가 깨졌다. ` +
      `게이트 · 인계 · 경계를 모른 채 일하게 되므로 **일을 시작하지 말고** 이 사실만 보고하고 종료하라.`
    );
  }

  return (
    `아래는 \`${path}\` — 하네스가 소유하는 **너의 역할 지침**이다. ` +
    `에이전트 정의 본문은 이것을 보충할 뿐이고, 부딪히면 이것이 이긴다.\n\n${body}`
  );
}

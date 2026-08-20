/**
 * **하네스가 소유하는 파일**의 목록과, 설치 흔적을 남기는 기록부.
 *
 * ## 왜 기록부가 필요한가
 *
 * 문서(`harness.md` · `planner-mode.md` · `agents/*.md`)는 A 에 **복사**된다. 회피가
 * 아니라 유일한 수단이었다 — `@` 임포트는 worktree 안에서 `node_modules` 를 못 타고,
 * 에이전트 정의는 `.claude/agents/` 에 실체로 있어야 Claude Code 가 읽는다(둘 다 실측).
 *
 * 대가는 **드리프트**다. 패키지를 올려도 사본은 그대로라, A 의 `developer` 가 옛 규약대로
 * 돌고 훅은 새 규칙으로 판정하는 상태가 된다. 그런데 지금은 **낡았는지 물어볼 방법조차
 * 없다** — 사본에는 어느 버전에서 왔는지가 안 적혀 있다.
 *
 * 그래서 설치할 때 **버전과 내용 해시**를 남긴다. 그러면 `sync` 가 세 경우를 가를 수 있다:
 *
 * | 지금 파일이 | 뜻 |
 * |---|---|
 * | 패키지의 것과 같다 | 최신이다 — 건드릴 것 없다 |
 * | 기록된 해시와 같다 | A 가 손댄 적 없다 — **안전하게 갱신한다** |
 * | 둘 다 아니다 | **A 가 손댔다** — 덮지 말고 알린다 |
 *
 * 세 번째가 요점이다. `developer.md` 를 자기 스택에 맞게 고치는 것은 정당한 일이고,
 * `sync` 가 그걸 조용히 날리면 아무도 모른다.
 */

import { createHash } from "node:crypto";

/** 기록부. A 의 저장소에 추적된다 — 어느 버전이 깔려 있는지가 히스토리에 남는다. */
export const MANIFEST_PATH = ".claude/harness-manifest.json";

/**
 * `.claude/hooks/` 의 shim. 훅 본체는 임포트되는 순간 판정을 내보내고 끝나므로 한 줄이면
 * 된다. **내용이 패키지 이름에만 의존하므로 사실상 안 바뀐다.**
 */
export const HOOK_SHIMS = [
  "path-ownership.mjs",
  "session-role.mjs",
  "verify-green.mjs",
  "verify-checklist.mjs",
];

/** `.githooks/` 쪽 shim. 셸 진입점이 `$(dirname "$0")/<이름>.mjs` 를 부른다. */
export const GITHOOK_SHIMS = ["pre-commit.mjs", "pre-push.mjs", "mark-verified.mjs"];

/** 그대로 복사할 것. 셸 진입점은 git 이 직접 실행하므로 shim 이 될 수 없다. */
export const VERBATIM = [
  { from: ".githooks/pre-commit", to: ".githooks/pre-commit", exec: true },
  { from: ".githooks/pre-push", to: ".githooks/pre-push", exec: true },
  { from: ".claude/agents/developer.md", to: ".claude/agents/developer.md" },
  { from: ".claude/agents/qa.md", to: ".claude/agents/qa.md" },
  { from: ".claude/planner-mode.md", to: ".claude/planner-mode.md" },
  // 작업 세션이 시작할 때 물고 들어가는 문서(`session-role` 이 붙인다). **디렉터리가 곧
  // 스위치라** A 가 지우면 안 물고 바꾸면 그대로 돈다 — 기록부가 'A 가 손댔다' 를 구분해 준다.
  { from: ".claude/planner/grilling.md", to: ".claude/planner/grilling.md" },
  // 사람이 요청의 영역을 명시하는 빠른 길. **선언이지 강제가 아니다** — 붙어 있으면 실행자가
  // 라우팅을 판정할 필요가 없고, 없으면 규약의 기준으로 판단한다. 스킬을 고른 이유는
  // 사람이 직접 치기 때문이다: 부르는 시점이 곧 필요한 시점이라, `planner/` 를 스킬로 못
  // 하게 만들었던 지연 로딩이 여기서는 오히려 원하는 성질이 된다.
  { from: ".claude/skills/harness-fix/SKILL.md", to: ".claude/skills/harness-fix/SKILL.md" },
  { from: ".claude/skills/task/SKILL.md", to: ".claude/skills/task/SKILL.md" },
  // 규약 본문. A 의 `CLAUDE.md` 가 `@harness.md` 로 끌어온다 — 루트 안이라 worktree 에서도
  // 임포트가 풀린다(밖으로 나가는 것만 막힌다).
  //
  // **이 저장소도 같은 파일을 같은 방식으로 읽는다.** 여기 `CLAUDE.md` 는 규약을 임포트하고
  // 이 저장소 사정만 덧붙인다 — 그래서 임포트가 깨지면 A 가 아니라 여기서 먼저 드러난다.
  { from: ".claude/harness.md", to: ".claude/harness.md" },
];

/**
 * 하네스가 **통째로 소유하는** 경로. `sync` 가 갱신하는 것이 정확히 이 목록이다.
 *
 * 병합해서 만든 것(`settings.json` · `.gitignore` · `package.json` · `CLAUDE.md`)은
 * 여기 없다 — **그건 A 의 파일**이고, 하네스는 거기 몇 줄을 얹었을 뿐이다.
 */
export function managedPaths() {
  return [
    ...HOOK_SHIMS.map((name) => `.claude/hooks/${name}`),
    ...GITHOOK_SHIMS.map((name) => `.githooks/${name}`),
    ...VERBATIM.map((item) => item.to),
  ];
}

/**
 * 내용 해시. **줄바꿈을 normalize 한 뒤에 잰다.**
 *
 * A 가 `core.autocrlf=true` 인 Windows 라면 우리가 LF 로 쓴 파일이 체크아웃에서 CRLF 로
 * 바뀐다. 그대로 해시하면 아무도 손대지 않았는데 "A 가 손댔다" 로 판정되고, `sync` 가
 * 영원히 갱신을 거부한다.
 */
export function hashOf(contents) {
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}

/** 기록부 본문. 키를 정렬해 둔다 — 순서가 흔들리면 diff 가 시끄러워진다. */
export function manifestContents({ version, files }) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ version, files: sorted }, null, 2)}\n`;
}

/** 기록부를 읽는다. 없거나 깨졌으면 `null` — 그 자체가 "모른다" 는 정보다. */
export function parseManifest(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.version !== "string") return null;
    return { version: parsed.version, files: parsed.files ?? {} };
  } catch {
    return null;
  }
}

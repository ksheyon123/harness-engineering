/**
 * **하네스가 소유하는 파일**의 목록과, 설치 흔적을 남기는 기록부.
 *
 * ## 왜 기록부가 필요한가
 *
 * 문서(`harness.md` · `planner-mode.md` · `roles/*.md`)는 A 에 **복사**된다. 회피가
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
 * 세 번째가 요점이다. 하네스 파일을 고치는 것은 A 의 정당한 결정일 수 있고, `sync` 가
 * 그걸 조용히 날리면 아무도 모른다.
 *
 * ## 고치라고 만든 자리는 따로 있다 — 에이전트 정의
 *
 * 역할을 자기 스택에 맞추는 것은 **예외가 아니라 일상**이다. 그런데 그것이 하네스 소유
 * 파일 안에서 일어나면 위 세 번째 줄에 영원히 걸려, A 는 약속(게이트 · 인계 · 보고 형식)
 * 쪽 갱신까지 못 받는다. 그래서 갈랐다:
 *
 * | 파일 | 소유 | `sync` |
 * |---|---|---|
 * | `.claude/roles/<역할>.md` — 훅과 맞물린 지침 | 하네스 | 맞춘다 |
 * | `.claude/agents/<역할>.md` — frontmatter + 프로젝트 사정 | **A** | 없을 때만 만든다 |
 *
 * 역할 지침은 `SubagentStart` 훅(`role-context.mjs`)이 스폰 때 싣는다.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 패키지 루트. 이 파일은 `<pkg>/install/` 에 있다. */
const PKG = fileURLToPath(new URL("..", import.meta.url));

/**
 * 기록부. 어느 버전이 깔려 있는지를 여기서만 알 수 있다.
 *
 * **추적될지는 A 가 정한다.** 하네스 파일이 그렇듯 이것도 A 의 `.gitignore` 에 달려 있고,
 * 설치 도구가 정하지 않는다. 커밋하는 저장소라면 버전이 히스토리에 남고, 아니라면 로컬
 * 파일로 남는다 — 어느 쪽이든 `sync`·`doctor` 가 읽는 것은 같다.
 */
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
  "notify-waiting.mjs",
  "role-context.mjs",
];

/** `.githooks/` 쪽 shim. 셸 진입점이 `$(dirname "$0")/<이름>.mjs` 를 부른다. */
export const GITHOOK_SHIMS = [
  "pre-commit.mjs",
  "pre-push.mjs",
  "post-checkout.mjs",
  "mark-verified.mjs",
];

/** 그대로 복사할 것. 셸 진입점은 git 이 직접 실행하므로 shim 이 될 수 없다. */
export const VERBATIM = [
  { from: ".githooks/pre-commit", to: ".githooks/pre-commit", exec: true },
  { from: ".githooks/pre-push", to: ".githooks/pre-push", exec: true },
  // **아직 흔적만 남긴다.** 여기 있는 이유는 그 흔적이 A 에서 필요해서가 아니라, 이 훅이
  // 곧 **사본에 하네스를 심는 자리**가 되기 때문이다. 심기가 붙는 시점에
  // 배달 경로까지 같이 새로 만들면, 심기가 안 도는 원인이 '훅이 안 불린다' 인지 '훅이
  // A 에 없다' 인지 구별할 수 없다 — 배선을 먼저 세우고 내용은 나중에 채운다.
  //
  // 지금 붙여도 A 가 깨지지 않는다: `$1`(old-ref)이 전부 0 인 호출에만 반응하므로
  // 평범한 `git checkout` 은 아무것도 하지 않는다.
  { from: ".githooks/post-checkout", to: ".githooks/post-checkout", exec: true },
  // 역할 지침. 에이전트 정의(A 소유)에서 갈라낸 **하네스 몫**이다 — 아래 `AGENT_TEMPLATES` 참고.
  { from: ".claude/roles/developer.md", to: ".claude/roles/developer.md" },
  { from: ".claude/roles/qa.md", to: ".claude/roles/qa.md" },
  { from: ".claude/planner-mode.md", to: ".claude/planner-mode.md" },
  // 작업 세션이 시작할 때 물고 들어가는 문서(`session-role` 이 붙인다). **디렉터리가 곧
  // 스위치라** A 가 지우면 안 물고 바꾸면 그대로 돈다 — 기록부가 'A 가 손댔다' 를 구분해 준다.
  { from: ".claude/planner/grilling.md", to: ".claude/planner/grilling.md" },
  // 사람이 요청의 영역을 명시하는 빠른 길. **선언이지 강제가 아니다** — 붙어 있으면 실행자가
  // 라우팅을 판정할 필요가 없고, 없으면 규약의 기준으로 판단한다. 스킬을 고른 이유는
  // 사람이 직접 치기 때문이다: 부르는 시점이 곧 필요한 시점이라, `planner/` 를 스킬로 못
  // 하게 만들었던 지연 로딩이 여기서는 오히려 원하는 성질이 된다.
  // 비밀의 **본보기**만 복사한다. 값이 든 `.claude/harness.env` 는 A 가 자기 손으로
  // 만들고, `init` 이 `.gitignore` 에 그 줄을 깐다. 어떤 키가 필요한지 알릴 자리가
  // 없으면 알림 기능은 있어도 켜는 법을 아무도 모른다.
  { from: ".claude/harness.env.example", to: ".claude/harness.env.example" },
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
 * 에이전트 정의 — **A 가 소유한다.** 하네스는 처음 한 번 본보기를 깔 뿐이다.
 *
 * Claude Code 가 `.claude/agents/` 에 실체로 있어야 읽으므로 자리는 못 옮긴다. 대신 본문에서
 * 하네스 몫(`roles/`)을 빼냈고, 남은 것은 frontmatter 와 프로젝트 사정이다. frontmatter
 * (`tools` · `isolation` · `SubagentStop`)는 하네스가 기대는 값이지만 파일째 A 의 것이라
 * `sync` 가 못 고친다 — 어긋나면 `smoke` 가 짚는다.
 *
 * **기록부에 안 든다.** 기록부는 "설치 그대로인가" 를 묻는 장부인데, A 소유 파일에는 그
 * 질문이 성립하지 않는다. 예전 설치본의 기록부에 남아 있다면 그것이 **옮기기 전**이라는
 * 표식이다(`sync` 가 그것으로 마이그레이션을 판정한다).
 */
export const AGENT_TEMPLATES = [
  { from: ".claude/agents/developer.md", to: ".claude/agents/developer.md" },
  { from: ".claude/agents/qa.md", to: ".claude/agents/qa.md" },
];

/** 에이전트 정의의 경로. 하네스 소유는 아니지만 **사본에 없으면 역할이 안 뜬다.** */
export function agentPaths() {
  return AGENT_TEMPLATES.map((item) => item.to);
}

/**
 * 에이전트 정의를 어떻게 할지. **`init` 과 `sync` 가 같이 쓴다** — 둘이 따로 판정하면
 * 한쪽만 낡는다. 파일을 건드리지 않는다.
 *
 * | 지금 | 기록부에 | 판정 |
 * |---|---|---|
 * | 없다 | — | `create` — 본보기를 깐다 |
 * | 있다 | 없다 | `same` — A 의 것이다 |
 * | 있다 | 있고 해시가 같다 | `migrate` — 옮기기 전 설치본을 **손댄 적 없다.** 본보기로 바꾼다 |
 * | 있다 | 있고 해시가 다르다 | `legacy` — 옮기기 전 설치본을 **A 가 고쳤다.** 덮지 않고 알린다 |
 *
 * `migrate` 를 그냥 두면 안 되는 이유: 그 파일의 본문은 **옛 판의 역할 지침 전부**다.
 * 두면 훅이 싣는 새 지침과 함께 실려 두 판이 한 컨텍스트에서 부딪힌다.
 *
 * @param {string} tree A 의 최상단
 * @param {{files?: object}|null} manifest 지금 기록부(없으면 `null`)
 * @returns {{path: string, contents: string, state: string}[]}
 */
export function agentSteps(tree, manifest) {
  return AGENT_TEMPLATES.map((item) => {
    const contents = readFileSync(join(PKG, item.from), "utf8");
    const full = join(tree, item.to);
    if (!existsSync(full)) return { path: item.to, contents, state: "create" };

    const recorded = manifest?.files?.[item.to];
    if (!recorded) return { path: item.to, contents, state: "same" };

    const current = hashOf(readFileSync(full, "utf8"));
    return { path: item.to, contents, state: current === recorded ? "migrate" : "legacy" };
  });
}

/** `legacy` 판정을 사람에게 풀어 쓴 것. `init`·`sync` 가 같은 문장을 낸다. */
export function legacyAgentNote(path, pkgName) {
  const role = path.replace(/^.*\//, "").replace(/\.md$/, "");
  return (
    `\`${path}\` 는 역할 지침을 갈라내기 전의 설치본인데 손댄 흔적이 있어 덮지 않았다. ` +
    `하네스 몫은 이제 \`.claude/roles/${role}.md\` 로 옮겨 스폰 때 주입된다 — 그대로 두면 ` +
    `**옛 지침과 새 지침이 함께 실린다.** 이 파일에서 하네스 본문을 지우고 frontmatter 와 ` +
    `이 프로젝트 사정만 남겨라. 본보기: \`node_modules/${pkgName}/${path}\`.`
  );
}

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

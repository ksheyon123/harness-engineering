/**
 * `harness.config.json` — 프로젝트마다 달라지는 값의 단일 출처.
 *
 * 훅들에는 이 저장소의 사정이 리터럴로 박혀 있었다(`src/**` · `npm test` · `harness/` ·
 * `main`/`dev`/`master`). 그 값들이 여러 파일에 흩어져 있으면 남의 저장소에 옮길 때
 * 스무 줄을 손으로 고쳐야 하고, 하나를 빠뜨리면 **그 훅만 조용히 엉뚱한 경로를 지킨다.**
 *
 * ## 왜 `baseDir` 를 인자로 받나, 그리고 왜 본체로 튕겨내나
 *
 * 훅마다 서 있는 트리가 다르다 — `path-ownership` 은 훅 입력의 `cwd`, `verify-green`·
 * `verify-checklist`·`pre-commit` 은 `process.cwd()`. 예전엔 "설정은 추적되는 파일이라
 * worktree 사본에도 그대로 있다"고 가정하고 그 트리를 그대로 읽었는데, **이 전제가
 * 설치되는 프로젝트에서는 성립하지 않는다.** 그런 저장소는 보통 `.claude/` 를 통째로
 * gitignore 하고, `post-checkout`(심기)이 커밋 대신 파일을 복사해 채워 넣는다. 그 심기가
 * 실패하면(환경·Claude Code 버전에 따라 `post-checkout` 자체가 안 도는 경우가 실측됐다)
 * worktree 사본엔 `harness.config.json` 이 아예 없고, `cwd` 기준으로 그대로 읽으면
 * 조용히 스키마 기본값으로 돌아간다 — 설치된 프로젝트에서 기본값은 거의 항상 틀린 값이다.
 *
 * 그래서 `loadConfig` 는 `baseDir` 를 받아도 **그 트리 자체가 아니라 그 트리가 속한
 * 저장소의 본체(main worktree)** 에서 읽는다(`mainWorktreeRoot`). git 프로세스는 안
 * 띄운다 — `<worktree>/.git` 이 디렉터리면 자기 자신이 본체고, `gitdir: <본체>/.git/
 * worktrees/<이름>` 한 줄짜리 파일이면(링크된 worktree 의 문서화된 형식) 그 경로에서
 * 본체를 역산한다. 서브프로세스를 안 띄우는 이유는 성능이다 — `path-ownership` 처럼
 * 모든 Edit/Write 마다 도는 훅에서 호출마다 git 을 띄우면 그 지연이 누적된다(실측:
 * 어떤 환경의 git 서브프로세스 하나가 수백 ms~1 초 넘게 걸려, 시간 여유가 빠듯하던
 * 테스트 하나를 그 한 번 추가만으로 타임아웃시켰다). git 이 아니거나 저장소가 아니면
 * (순수 fs 테스트 등) `null` 이 나오고, 그때는 원래 받은 `baseDir` 그대로 쓴다 — 판정
 * 불가와 "본체가 곧 자기 자신"은 다르다.
 *
 * **이 설계가 `harness.config.json` 을 "task 브랜치가 자기 것만 따로 갖는" 파일이 아니라
 * "저장소 전체가 공유하는 하네스 설정"으로 취급한다는 뜻이다.** 실제로도 그렇다 —
 * `harnessFiles` 기본값의 `.claude/**` 에 이 파일이 들어있어, 층 1 이 애초에 작업
 * 세션에게 이 파일을 고칠 권한을 주지 않는다. 고치는 건 실행자가 본체에서 하는 일이고,
 * 그 값이 모든 worktree 에 즉시 · 일관되게 반영돼야 맞다.
 *
 * ## 없거나 깨졌으면 기본값이다
 *
 * 기본값은 **이 저장소의 현재 동작 그대로**다. 그래서 설정 파일이 없어도 아무것도
 * 바뀌지 않고, 설치 직후의 프로젝트도 일단 돈다.
 *
 * **이 저장소는 `harness.config.json` 을 두지 않는다.** 기본값과 같은 내용을 파일로 또
 * 적으면 사본이 둘이 되고, 사본은 반드시 어긋난다. 여기서는 기본값이 곧 설정이고,
 * 파일은 값이 달라지는 프로젝트를 위한 것이다.
 *
 * **대가가 있다: 오타 난 설정은 조용히 기본값으로 돌아간다.** 남의 저장소에서는 기본값이
 * 틀린 값이므로 엉뚱한 경로를 지키게 된다. 검증(`doctor`)은 아직 없다 — G 에 적혀 있다.
 * 여기서 던지지 않는 이유는 그게 더 나쁘기 때문이다: `PreToolUse` 훅이 죽으면 차단이
 * 아니라 **통과**가 되고, 층 1 이 통째로 사라지는데 아무 신호도 없다.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** 설정 파일 이름. */
export const CONFIG_FILE = "harness.config.json";

/**
 * 설정이 살 수 있는 자리. **앞의 것이 이긴다.**
 *
 * ## 왜 `.claude/` 로 옮겼나
 *
 * 하네스가 만드는 것이 **한 접두어 아래 모여 있어야** A 가 `.gitignore` 에 쓴 한 줄이
 * 전부를 덮는다. 루트에 흩어져 있으면 A 의 결정이 샌다 — `.claude/` 는 무시하기로 했는데
 * 루트의 설정 파일만 `git add -A` 에 잡혀 커밋되는 식이다.
 *
 * **A 대신 무시 규칙을 써 주는 것이 아니다.** 커밋 여부는 A 가 자기 `.gitignore` 에 자기
 * 손으로 정한다. 하네스가 할 수 있는 것은 **결정할 대상을 한 덩어리로 만드는 것**뿐이다.
 *
 * ## 루트를 계속 읽는 이유
 *
 * 이미 설치된 저장소가 루트에 파일을 갖고 있다. 그것을 안 읽으면 **조용히 기본값으로
 * 돌아간다** — 남의 저장소에서 기본값은 곧 틀린 값이라, `specRoot` 하나가 어긋나면 층 1 이
 * 엉뚱한 경로를 지키고 아무도 이유를 모른다. 그래서 읽어 주고, `doctor` 가 옮기라고 말한다.
 */
/*
 * **구분자는 `/` 로 고정한다.** 이 값들은 파일을 찾는 데도 쓰이지만 그대로 사람에게
 * 찍히기도 한다 — `join` 으로 지으면 Windows 에서 `.claude\…` 가 되어 문서·메시지의
 * 나머지와 어긋난다. `join(baseDir, "a/b")` 는 어느 플랫폼에서든 정상이다.
 */
export const CONFIG_PATHS = Object.freeze([`.claude/${CONFIG_FILE}`, CONFIG_FILE]);

/**
 * 설정 파일이 실제로 있는 자리. 없으면 `null`.
 *
 * **부르는 쪽이 경로를 조립하지 않게 한다.** 한때 `join(baseDir, CONFIG_FILE)` 이
 * `loadConfig` 와 `doctor` 두 곳에 따로 적혀 있었는데, 자리가 둘로 늘어나는 순간 그런
 * 사본은 반드시 어긋난다 — 로더는 새 자리를 읽는데 `doctor` 는 옛 자리를 보고 "없다"고
 * 말하는 식이다.
 *
 * @param {string} baseDir 설정을 찾을 트리의 최상단
 * @returns {{path: string, relative: string, legacy: boolean} | null}
 */
export function findConfig(baseDir) {
  for (const relative of CONFIG_PATHS) {
    const path = join(baseDir, relative);
    if (existsSync(path)) return { path, relative, legacy: relative === CONFIG_FILE };
  }
  return null;
}

/**
 * 이 저장소의 현재 동작. 설정이 없을 때 쓰인다.
 *
 * **배열까지 얼린다.** `Object.freeze` 는 얕아서 최상위만 얼리면 `DEFAULTS.source.push(…)`
 * 가 조용히 통한다 — 한 훅이 배열을 만지면 같은 프로세스의 다음 판정이 오염된다. 얼려
 * 두면 그 시도가 그 자리에서 터진다. 내보내는 값은 아래에서 **사본**으로 만든다.
 */
export const DEFAULTS = Object.freeze({
  /** 게이트. `verify-green` 이 이것을 돌린다. */
  gate: "npm test",
  /** 제품 코드. 역할이 고치고, 세션은 못 고친다. */
  source: Object.freeze(["src/**"]),
  /** 고치면 하네스의 동작이 바뀌는 것. 산문은 여기 들지 않는다. */
  harnessFiles: Object.freeze([
    ".claude/**",
    ".githooks/**",
    "scripts/**",
    "package.json",
    "package-lock.json",
    "vitest.config.mjs",
  ]),
  /** spec·체크리스트가 사는 디렉터리. 뒤에 `/` 를 붙이지 않는다. */
  specRoot: "harness",
  /** 직접 커밋을 막을 브랜치. */
  protectedBranches: Object.freeze(["main", "dev", "master"]),
  /**
   * `pre-commit` 의 "한 브랜치에 spec 은 하나" 판정이 base 후보로 추가로 보는 브랜치.
   * `protectedBranches` 와 별개다 — 여기 적어도 그 브랜치에 직접 커밋하는 것은 막히지
   * 않는다. 아직 protected 브랜치에 머지되지 않은 부모 task 브랜치 위에 다음 task 를
   * 쌓을 때(stacked branch), 그 부모를 여기 적으면 부모가 이미 담고 있는 spec 이
   * "이 브랜치가 새로 추가한 것"으로 잘못 잡히지 않는다.
   */
  specBaseBranches: Object.freeze([]),
  /**
   * 알림. **여기에 URL 은 없다** — 이 파일은 추적되고, 웹훅 URL 은 그 자체가 비밀이다.
   * 여기 적히는 것은 *어느 키를 읽을지*와 *어느 지점에서 쏠지*뿐이고, 값은
   * `.claude/harness.env`(무시됨)나 환경변수에 산다. 자세한 것은 `notify.mjs`.
   *
   * **기본이 켜져 있는 이유**: 실질 스위치는 URL 의 존재라, URL 이 없으면 이 값들이
   * 무엇이든 아무 일도 일어나지 않는다. 반대로 기본을 빈 배열로 두면 설정 파일을 두지
   * 않는 저장소는 알림을 켤 방법이 없어진다.
   */
  notify: Object.freeze({
    urlEnv: "HARNESS_NOTIFY_URL",
    events: Object.freeze(["notification", "push"]),
  }),
});

/** 기본값의 **사본**. 부르는 쪽이 고쳐도 다음 호출이 오염되지 않는다. */
function defaults() {
  return {
    gate: DEFAULTS.gate,
    source: [...DEFAULTS.source],
    harnessFiles: [...DEFAULTS.harnessFiles],
    specRoot: DEFAULTS.specRoot,
    protectedBranches: [...DEFAULTS.protectedBranches],
    specBaseBranches: [...DEFAULTS.specBaseBranches],
    notify: { urlEnv: DEFAULTS.notify.urlEnv, events: [...DEFAULTS.notify.events] },
  };
}

/**
 * 설정을 읽는다. 없거나 깨졌으면 기본값. 자리는 `CONFIG_PATHS` 가 정한다.
 *
 * 키 단위로 채운다 — 일부만 적은 설정도 나머지는 기본값으로 돈다. 타입이 어긋난 값은
 * **그 키만** 버린다. 설정 하나 틀렸다고 전부 기본값으로 되돌리면 어디가 틀렸는지
 * 판단하기가 더 어려워진다.
 *
 * @param {string} baseDir 설정을 찾을 트리의 최상단
 */
export function loadConfig(baseDir) {
  const root = mainWorktreeRoot(baseDir) ?? baseDir;
  const fallback = defaults();
  const found = findConfig(root);
  if (!found) return fallback;

  let raw;
  try {
    raw = JSON.parse(readFileSync(found.path, "utf8"));
  } catch {
    return fallback;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  return {
    gate: string(raw.gate) ?? fallback.gate,
    source: stringList(raw.source) ?? fallback.source,
    harnessFiles: stringList(raw.harnessFiles) ?? fallback.harnessFiles,
    specRoot: specRoot(raw.specRoot) ?? fallback.specRoot,
    protectedBranches: stringList(raw.protectedBranches) ?? fallback.protectedBranches,
    specBaseBranches: stringList(raw.specBaseBranches) ?? fallback.specBaseBranches,
    notify: notify(raw.notify, fallback.notify),
  };
}

/**
 * 알림 설정. **키 단위로 채운다** — `events` 만 적은 설정도 `urlEnv` 는 기본값으로 돈다.
 *
 * `events: []` 는 **버리지 않는다.** 다른 배열들과 반대인데, 여기서는 빈 값이 오타가
 * 아니라 "아무 데서도 쏘지 마라" 라는 정당한 의도이기 때문이다. 그 의도를 기본값으로
 * 되돌리면 끄려던 사람이 끌 수가 없다.
 */
function notify(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const events = Array.isArray(value.events)
    ? value.events.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
    : fallback.events;

  return { urlEnv: string(value.urlEnv) ?? fallback.urlEnv, events };
}

function string(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 빈 배열은 버린다 — '아무 경로도 지키지 않는다' 는 의도일 리 없고, 오타일 확률이 높다. */
function stringList(value) {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
  return items.length > 0 ? items : null;
}

/** 뒤의 `/` 를 떼서 저장한다. 붙이는 것은 쓰는 쪽 몫이라 한 곳에서 고정해 둔다. */
function specRoot(value) {
  const s = string(value);
  return s ? s.replace(/\/+$/, "") : null;
}

/**
 * 이 트리가 속한 저장소의 본체(main worktree) 최상위 경로. 판정할 수 없으면(`.git` 이
 * 없거나 알아볼 수 없는 모양이거나) `null` — 없는 것과 모르는 것은 다르다.
 *
 * **git 프로세스를 안 띄운다 — 순수 fs 로만 읽는다.** `git worktree list --porcelain` 로
 * 물어도 정답은 정답인데, 이 함수는 `loadConfig` 를 거쳐 `path-ownership`(모든 Edit/Write
 * 마다 도는 `PreToolUse` 훅)까지 타므로 **호출마다 서브프로세스 하나가 늘어나는 비용을
 * 못 견딘다** — 실측으로 어떤 환경에서는 git 서브프로세스 하나가 수백 ms~1초 넘게 걸려서,
 * 이미 시간 여유가 별로 없던 테스트(`install/smoke.test.mjs`)가 그 한 번 추가만으로
 * 타임아웃을 넘겼다.
 *
 * 대신 git 이 worktree 를 표시하는 방식 자체를 그대로 읽는다:
 *
 * - **평범한 저장소**(링크된 worktree 가 아님): `<cwd>/.git` 이 디렉터리다 → `cwd` 자신이
 *   곧 본체다.
 * - **링크된 worktree**: `<cwd>/.git` 이 `gitdir: <본체>/.git/worktrees/<이름>` 한 줄짜리
 *   **파일**이다(git 의 문서화된 형식). 그 경로에서 `worktrees/<이름>` 과 `.git` 을
 *   걷어내면 본체가 나온다.
 *
 * @param {string} cwd
 * @returns {string | null}
 */
export function mainWorktreeRoot(cwd) {
  const dotGit = join(cwd, ".git");

  let stat;
  try {
    stat = statSync(dotGit);
  } catch {
    return null; // `.git` 자체가 없다 — 저장소가 아니다.
  }

  if (stat.isDirectory()) return cwd;

  let content;
  try {
    content = readFileSync(dotGit, "utf8");
  } catch {
    return null;
  }

  const match = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  if (!match) return null; // 알아볼 수 없는 모양 — 판정하지 않는다.

  // `<본체>/.git/worktrees/<이름>` → 세 단계 위가 `<본체>` 다.
  return dirname(dirname(dirname(match[1])));
}

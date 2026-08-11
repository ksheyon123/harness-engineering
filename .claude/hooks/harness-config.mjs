/**
 * `harness.config.json` — 프로젝트마다 달라지는 값의 단일 출처.
 *
 * 훅들에는 이 저장소의 사정이 리터럴로 박혀 있었다(`src/**` · `npm test` · `harness/` ·
 * `main`/`dev`/`master`). 그 값들이 여러 파일에 흩어져 있으면 남의 저장소에 옮길 때
 * 스무 줄을 손으로 고쳐야 하고, 하나를 빠뜨리면 **그 훅만 조용히 엉뚱한 경로를 지킨다.**
 *
 * ## 왜 `baseDir` 를 인자로 받나
 *
 * 훅마다 서 있는 트리가 다르다. 설정은 추적되는 파일이라 worktree 사본에도 그대로
 * 있으므로, **각자 자기가 일하고 있는 트리의 것**을 읽어야 한다:
 *
 * | 부르는 곳 | `baseDir` | 왜 |
 * |---|---|---|
 * | `path-ownership` | 훅 입력의 `cwd` | 판정 대상 경로를 재는 기준과 같아야 한다 |
 * | `verify-green`·`verify-checklist` | `process.cwd()` | 역할의 worktree 에서 돈다 |
 * | `pre-commit` | `process.cwd()` | git 이 훅의 cwd 를 top-level 로 놓는다 |
 *
 * `pre-commit` 만 특히 주의해야 한다 — `core.hooksPath` 가 절대경로라 **본체의 스크립트**가
 * 불리는데 cwd 는 커밋이 일어나는 worktree 다. 모듈 위치(`import.meta.url`) 기준으로
 * 찾으면 본체 설정을 읽어버린다. cwd 기준이라야 맞다.
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

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 설정 파일 이름. 저장소 최상단에 둔다. */
export const CONFIG_FILE = "harness.config.json";

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
});

/** 기본값의 **사본**. 부르는 쪽이 고쳐도 다음 호출이 오염되지 않는다. */
function defaults() {
  return {
    gate: DEFAULTS.gate,
    source: [...DEFAULTS.source],
    harnessFiles: [...DEFAULTS.harnessFiles],
    specRoot: DEFAULTS.specRoot,
    protectedBranches: [...DEFAULTS.protectedBranches],
  };
}

/**
 * `<baseDir>/harness.config.json` 을 읽는다. 없거나 깨졌으면 기본값.
 *
 * 키 단위로 채운다 — 일부만 적은 설정도 나머지는 기본값으로 돈다. 타입이 어긋난 값은
 * **그 키만** 버린다. 설정 하나 틀렸다고 전부 기본값으로 되돌리면 어디가 틀렸는지
 * 판단하기가 더 어려워진다.
 *
 * @param {string} baseDir 설정을 찾을 트리의 최상단
 */
export function loadConfig(baseDir) {
  const fallback = defaults();

  let raw;
  try {
    raw = JSON.parse(readFileSync(join(baseDir, CONFIG_FILE), "utf8"));
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
  };
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

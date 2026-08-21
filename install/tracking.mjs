/**
 * **파일이 worktree 사본까지 갈 수 있는가** 를 판정한다. `init` 과 `smoke` 가 같이 쓴다.
 *
 * ## 왜 "추적된다" 로는 부족한가
 *
 * 한때 이 판정이 `git ls-files` 하나였다. 그건 **인덱스**를 본다 — 스테이징만 해도 잡힌다.
 * 그런데 worktree 사본은 **커밋된 것만** 받는다. 그래서 `git add` 만 하고 커밋을 안 한
 * 상태에서 `smoke` 가 전부 초록을 냈다(실측):
 *
 * ```
 * git add -f .claude/harness.md      # 커밋은 안 함
 * git ls-files  →  .claude/harness.md          ← 초록
 * worktree 사본 →  .claude 없음                 ← 하네스가 통째로 없다
 * ```
 *
 * `smoke` 가 존재하는 이유가 정확히 그 실패를 잡는 것인데, 그 상태를 통과시키고 있었다.
 * **기준은 인덱스가 아니라 `HEAD` 다.**
 *
 * ## 왜 상태가 다섯인가 — 처방이 다섯이기 때문이다
 *
 * 있다/없다 둘로만 보면 처방이 하나(`git add -A`)뿐인데, 그게 틀리는 경우가 있다. A 의
 * `.gitignore` 가 `.claude` 를 통째로 무시하면 `git add -A` 는 **몇 번을 돌려도** 담지
 * 못한다. 그때 필요한 것은 `-f` 다. 상태를 갈라야 그 말을 할 수 있다.
 *
 * `.gitignore` 는 **추적되지 않는** 파일에만 걸린다. 한 번 담기면 그 뒤로는 무시 규칙이
 * 그 파일에 아무 힘이 없다 — 그래서 `-f` 는 한 번만 하면 되고, 이후 `git add -A` 가
 * 수정분을 정상적으로 다시 담는다(실측).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** 파일 자체가 없다. 담고 말고 할 것이 없다. */
export const MISSING = "missing";
/** 디스크에 있는데 `.gitignore` 가 막는다. `git add -A` 로는 **영원히** 안 담긴다. */
export const IGNORED = "ignored";
/** 담을 수 있는데 아직 안 담았다. */
export const UNTRACKED = "untracked";
/** 인덱스에는 있는데 커밋이 안 됐다. **사본에는 아직 없다.** */
export const STAGED = "staged";
/** `HEAD` 에 있다. 사본이 이것을 받는다 — 여기만 통과다. */
export const COMMITTED = "committed";

/**
 * 상태별로 사람이 다음에 칠 것. `null` 이면 할 일이 없다.
 *
 * **`IGNORED` 에 더는 `git add -f` 를 처방하지 않는다.** A 가 `.claude/` 를 무시한 것은
 * 거기 든 것을 **개인 설정**으로 본 판단이고(개발자마다 다른 하네스를 쓴다), 그 판단
 * 자체가 옳다. 설치 도구가 그것을 뚫고 팀 파일을 심는 것은 설치 도구의 몫이 아니었다.
 *
 * 뚫지 않아도 되는 이유는 **도달 경로가 둘이 됐기 때문**이다 — 아래 `reaches` 를 봐라.
 */
export const PRESCRIPTION = {
  [MISSING]: "파일이 없다 — `harness init` 부터 돌려라.",
  [IGNORED]:
    "`.gitignore` 가 막아 `git add -A` 로는 안 담긴다. **뚫지 마라** — `post-checkout` 을 " +
    "배선하면(`harness init`) 커밋 없이 사본에 심긴다.",
  [UNTRACKED]: "아직 안 담겼다 — `git add -A` 로 담아 커밋하거나, `post-checkout` 을 배선해라.",
  [STAGED]: "스테이징까지만 됐다 — **커밋해야** 사본에 간다.",
  [COMMITTED]: null,
};

/** 보고 순서. 급한 것(고쳐야 담기는 것)부터. */
export const ORDER = [MISSING, IGNORED, UNTRACKED, STAGED];

/**
 * **사본에 도달하는가.** 물어야 할 것은 처음부터 이것이었다 — "커밋됐는가" 는 도달 수단이
 * 하나뿐이던 시절의 대용품이다.
 *
 * 도달 경로가 둘이다:
 *
 * | 경로 | 조건 |
 * |---|---|
 * | git 이 데려간다 | `HEAD` 에 있다 — 사본은 커밋된 것만 받는다 |
 * | `post-checkout` 이 심는다 | 배선돼 있고, 그 파일이 **본체 디스크에 있다** |
 *
 * 두 번째가 git 상태를 묻지 않는 것이 요점이다. 심기는 본체의 워킹트리에서 복사하므로
 * 무시됐든 미추적이든 스테이징만 됐든 똑같이 데려간다. **없는 것만 못 데려간다.**
 *
 * @param {string} state `trackingStates` 가 낸 상태
 * @param {boolean} planting `post-checkout` 심기가 배선돼 있는가
 */
export function reaches(state, planting) {
  if (state === COMMITTED) return true;
  if (state === MISSING) return false;
  return planting;
}

/**
 * 경로마다 상태를 낸다.
 *
 * @param {string} tree 저장소 최상단
 * @param {string[]} paths 저장소 기준 상대 경로(슬래시)
 * @param {(args: string[]) => string} git `tree` 를 겨냥한 git 러너
 * @returns {Map<string, string> | null} git 을 못 쓰면 `null` — **모른다는 것도 정보다**
 */
export function trackingStates(tree, paths, git) {
  const head = headSet(git);
  const index = pathSet(git, ["ls-files", "-z"]);
  if (head === null || index === null) return null;

  const ignored = ignoredSet(paths, git);

  const states = new Map();
  for (const path of paths) {
    if (head.has(path)) states.set(path, COMMITTED);
    else if (index.has(path)) states.set(path, STAGED);
    else if (!existsSync(join(tree, path))) states.set(path, MISSING);
    else if (ignored.has(path)) states.set(path, IGNORED);
    else states.set(path, UNTRACKED);
  }
  return states;
}

/**
 * 상태별로 묶는다. 보고가 경로 하나하나가 아니라 **처방 단위**로 나가야 읽힌다.
 *
 * **도달하는 것은 묶지 않는다.** `planting` 이 참이면 디스크에 있는 것은 전부 도달하므로
 * `MISSING` 만 남는다 — 하네스를 **커밋하지 않기로 한 저장소**에서 무시 상태를 결함으로
 * 부르지 않게 하는 것이 이 인자다. 무시할지는 A 가 정한 것이고, 그 결정 위에서도 하네스는
 * 선다.
 */
export function groupByState(states, planting = false) {
  const groups = new Map();
  for (const [path, state] of states) {
    if (reaches(state, planting)) continue;
    if (!groups.has(state)) groups.set(state, []);
    groups.get(state).push(path);
  }
  return ORDER.filter((state) => groups.has(state)).map((state) => ({
    state,
    paths: groups.get(state),
    prescription: PRESCRIPTION[state],
  }));
}

/**
 * `HEAD` 가 담고 있는 것.
 *
 * **커밋이 하나도 없는 저장소를 오류로 보지 않는다.** 갓 `git init` 한 트리에 설치하는
 * 것은 정상 경로이고, 그때 답은 "못 쟀다" 가 아니라 "아무것도 커밋 안 됐다" 다.
 */
function headSet(git) {
  try {
    git(["rev-parse", "--verify", "HEAD"]);
  } catch {
    return new Set();
  }
  return pathSet(git, ["ls-tree", "-r", "HEAD", "--name-only", "-z"]);
}

function pathSet(git, args) {
  try {
    return new Set(git(args).split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * 무시되는 경로만 되돌려준다.
 *
 * `git check-ignore` 는 **추적 중인 파일을 무시된 것으로 치지 않는다**(실측). 이미 담긴
 * 것에는 `.gitignore` 가 힘이 없으니 그게 맞고, 우리 판정에서도 그 경우는 이 함수에
 * 닿기 전에 `COMMITTED`·`STAGED` 로 갈린다.
 *
 * 걸리는 것이 하나도 없으면 종료 코드 1 이라 러너가 던진다 — **오류가 아니라 답이다.**
 *
 * **`-z` 를 쓰지 않는다.** `check-ignore` 는 `-z` 를 `--stdin` 하고만 받는다(실측:
 * `fatal: -z only makes sense with --stdin`). 여기 넘기는 경로는 하네스가 소유한 고정
 * 목록이라 줄바꿈이 들어갈 일이 없으므로, 줄 단위로 읽는 것으로 충분하다.
 */
function ignoredSet(paths, git) {
  if (paths.length === 0) return new Set();
  try {
    return new Set(
      git(["check-ignore", "--", ...paths])
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

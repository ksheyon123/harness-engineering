/**
 * verified marker 의 위치. 쓰는 쪽(`mark-verified`)과 읽는 쪽(`pre-push`)이 같은 곳을
 * 봐야 하므로 여기 한 번만 적는다.
 *
 * **gitdir 안에 둔다.** 링크된 worktree 의 `--absolute-git-dir` 은
 * `<main>/.git/worktrees/<id>` 라 worktree 마다 자연히 갈리고, 추적되지 않으며,
 * worktree 가 사라질 때 함께 사라진다.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 최근 것만 남긴다. amend·rebase 로 sha 가 갈리므로 하나만 두면 금세 어긋난다. */
const KEEP = 50;

/**
 * @param {string} [cwd] 어느 트리의 마커인가. 생략하면 프로세스의 cwd.
 * @returns {string|null} 마커 경로. git 저장소가 아니면 `null`.
 */
export function markerPath(cwd) {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitDir ? join(gitDir, "harness-verified") : null;
  } catch {
    return null;
  }
}

/**
 * **게이트가 green 인 `HEAD` 를 마커에 적는다.**
 *
 * 부르는 쪽이 둘이다 — `posttest` 로 걸린 `mark-verified.mjs`, 그리고 `harness gate`.
 * 여기 한 번만 적는 이유는 **`pre-push` 가 읽는 형식이 하나여야 하기 때문**이다. 사본이
 * 둘이면 한쪽이 형식을 바꿀 때 다른 쪽이 남긴 기록이 조용히 안 읽힌다.
 *
 * **성공했을 때만 부르는 것은 부르는 쪽의 책임이다.** 여기서는 판정하지 않는다 —
 * npm 은 `test` 가 0 일 때만 `posttest` 를 돌리고, `harness gate` 는 종료 코드를 직접 본다.
 *
 * 기록 실패는 삼킨다. **게이트 결과를 뒤집어서는 안 된다** — 못 적으면 push 에서 막히고,
 * 그때 다시 돌리면 된다. 반대로 여기서 던지면 통과한 게이트가 실패로 보인다.
 *
 * @param {string} [cwd] 어느 트리의 `HEAD` 를 적을 것인가.
 * @returns {boolean} 적었거나 이미 있으면 `true`. 적을 곳·적을 sha 가 없으면 `false`.
 */
export function recordVerified(cwd) {
  const path = markerPath(cwd);
  if (!path) return false; // git 저장소가 아니다 — 기록할 곳이 없다.

  let head;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return false; // 커밋이 하나도 없다. 기록할 sha 자체가 없다.
  }

  let existing = [];
  try {
    existing = readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    /* 아직 없다. */
  }

  if (existing[existing.length - 1] === head) return true;

  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existing.length + 1 > KEEP) {
      writeFileSync(path, `${[...existing.slice(-(KEEP - 1)), head].join("\n")}\n`);
    } else {
      appendFileSync(path, `${head}\n`);
    }
    return true;
  } catch {
    return false;
  }
}

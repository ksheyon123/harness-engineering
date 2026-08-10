/**
 * verified marker 의 위치. 쓰는 쪽(`mark-verified`)과 읽는 쪽(`pre-push`)이 같은 곳을
 * 봐야 하므로 여기 한 번만 적는다.
 *
 * **gitdir 안에 둔다.** 링크된 worktree 의 `--absolute-git-dir` 은
 * `<main>/.git/worktrees/<id>` 라 worktree 마다 자연히 갈리고, 추적되지 않으며,
 * worktree 가 사라질 때 함께 사라진다.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** @returns {string|null} 마커 경로. git 저장소가 아니면 `null`. */
export function markerPath() {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitDir ? join(gitDir, "harness-verified") : null;
  } catch {
    return null;
  }
}

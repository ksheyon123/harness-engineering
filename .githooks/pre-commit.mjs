#!/usr/bin/env node
/**
 * 층 2 — `pre-commit`. **불변식만 본다.**
 *
 * 게이트(`npm test`)를 여기서 돌리지 않는다. 회수 턴마다 몇 분이 붙는 데다, 정작 봐야 할
 * 트리를 못 본다 — 머지 커밋에는 `pre-merge-commit` 이 돌고 fast-forward 회수에는 아무
 * 훅도 돌지 않는다. 그래서 여기서는 **밀리초 안에 확실히 아는 것만** 검사한다.
 *
 * 세 가지다:
 *
 * 1. **브랜치** — `main`/`dev` 에 직접 커밋하지 않는다. 사람이 PR 을 머지하는 머지 커밋은
 *    `pre-merge-commit` 이 받으므로 여기 걸리지 않는다.
 * 2. **전체 스테이징** — 부분 스테이징을 막는다. 검사한 트리와 커밋되는 내용이 어긋나면
 *    검사가 무의미해지고, 역할이 만든 파일이 조용히 누락된다.
 * 3. **spec 형식** — 스테이징된 `harness/<task>/spec.md` 가 인계될 수 있는 모양인가.
 *    커밋이 곧 인계이므로 이 자리가 맞고, **누가 커밋하든 걸린다.**
 *
 * 막혔는데 정말 지나가야 한다면 `git commit --no-verify` 다. 규약을 어기는 것이므로
 * 그 사실이 보이게 남는다.
 */

import { execFileSync } from "node:child_process";
import { problemsIn } from "../.claude/hooks/spec-shape.mjs";

/** 직접 커밋을 막을 브랜치. */
const PROTECTED = new Set(["main", "dev", "master"]);

const problems = [
  ...protectedBranch(),
  ...partiallyStaged(),
  ...malformedSpecs(),
];

if (problems.length > 0) {
  process.stderr.write(
    `\n커밋을 막았다 — 아래를 처리하고 다시 커밋해라.\n\n` +
      problems.map((p) => `  · ${p}`).join("\n") +
      `\n\n정말 이대로 가야 한다면 \`git commit --no-verify\`.\n\n`,
  );
  process.exit(1);
}

function git(args) {
  // 훅은 git 이 띄운 자식이다. GIT_INDEX_FILE 등이 이 커밋을 겨냥하고 있으므로
  // **씻지 않는다** — 여기서는 그 값들이 정답이다.
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function protectedBranch() {
  let branch;
  try {
    branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
  } catch {
    return []; // detached HEAD — 리베이스·체리픽 중이다. 판정하지 않는다.
  }

  if (!PROTECTED.has(branch)) return [];

  // 충돌을 푼 뒤의 머지 커밋은 `pre-merge-commit` 이 아니라 여기로 온다. 사람이 PR 을
  // 머지하는 정당한 경로이므로 통과시킨다.
  if (inMerge()) return [];

  return [
    `\`${branch}\` 에 직접 커밋하려 한다. 브랜치를 자르고 거기서 커밋해라 ` +
      `— \`git switch -c <type>/<이름>\`.`,
  ];
}

function inMerge() {
  try {
    git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 워킹트리에 스테이징되지 않은 것이 남아 있는가.
 *
 * `-uall` 이 필수다. 기본값은 추적되지 않는 **디렉터리를 접어서** 보여주므로,
 * `harness/` 가 통째로 새로 생긴 경우 `?? harness/` 한 줄만 나오고 그 안의 파일은
 * 목록에 없다.
 */
function partiallyStaged() {
  let out;
  try {
    out = git(["status", "--porcelain", "-z", "-uall"]);
  } catch {
    return []; // git 을 못 쓰면 판정하지 않는다. 없는 것과 모르는 것은 다르다.
  }

  const leftovers = [];
  for (const entry of out.split("\0").filter(Boolean)) {
    const worktree = entry[1]; // XY <path> — Y 가 워킹트리 상태다
    const path = entry.slice(3);

    if (entry.startsWith("??")) leftovers.push(`${path} (추적되지 않음)`);
    else if (worktree !== " ") leftovers.push(`${path} (수정이 스테이징되지 않음)`);
  }

  if (leftovers.length === 0) return [];

  return [
    `부분 스테이징이다. 워킹트리 전체를 담아라 — \`git add -A\`.\n` +
      leftovers.map((l) => `      ${l}`).join("\n"),
  ];
}

/** 이 커밋에 담기는 spec 들. 워킹트리가 아니라 **인덱스**에서 읽는다. */
function malformedSpecs() {
  let staged;
  try {
    staged = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=d", "--", "harness/"]);
  } catch {
    return [];
  }

  return staged
    .split("\0")
    .filter((path) => path.endsWith("spec.md"))
    .flatMap((path) => {
      let text;
      try {
        text = git(["show", `:${path}`]);
      } catch {
        return [`\`${path}\` 의 스테이징된 내용을 읽을 수 없다.`];
      }
      return problemsIn(path, text);
    });
}

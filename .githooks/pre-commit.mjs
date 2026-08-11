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
 * 1. **브랜치** — 보호 브랜치에 직접 커밋하지 않는다. 사람이 PR 을 머지하는 머지 커밋은
 *    `pre-merge-commit` 이 받으므로 여기 걸리지 않는다.
 * 2. **전체 스테이징** — 부분 스테이징을 막는다. 검사한 트리와 커밋되는 내용이 어긋나면
 *    검사가 무의미해지고, 역할이 만든 파일이 조용히 누락된다.
 * 3. **spec 형식** — 스테이징된 `<specRoot>/<task>/spec.md` 가 인계될 수 있는 모양인가.
 *    커밋이 곧 인계이므로 이 자리가 맞고, **누가 커밋하든 걸린다.**
 * 4. **한 브랜치에 spec 은 하나** — 이 브랜치가 base 이후로 *추가한* spec 이 둘 이상이면
 *    두 task 가 한 PR 로 나간다.
 *
 * 보호 브랜치 목록과 spec 위치는 `harness.config.json` 이 정한다(기본값 `main`/`dev`/
 * `master` · `harness`).
 *
 * 막혔는데 정말 지나가야 한다면 `git commit --no-verify` 다. 규약을 어기는 것이므로
 * 그 사실이 보이게 남는다.
 */

import { execFileSync } from "node:child_process";
import { loadConfig } from "../.claude/hooks/harness-config.mjs";
import { problemsIn } from "../.claude/hooks/spec-shape.mjs";

/**
 * 설정은 **cwd 기준**으로 읽는다. `core.hooksPath` 가 절대경로라 worktree 에서 커밋해도
 * 본체의 이 스크립트가 불리는데, git 은 훅의 cwd 를 커밋이 일어나는 트리의 top-level 로
 * 놓는다. 모듈 위치 기준으로 찾으면 본체 설정을 읽어버린다.
 */
const { protectedBranches, specRoot } = loadConfig(process.cwd());

/** 직접 커밋을 막을 브랜치. */
const PROTECTED = new Set(protectedBranches);

const problems = [
  ...protectedBranch(),
  ...partiallyStaged(),
  ...malformedSpecs(),
  ...multipleSpecs(),
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
  const entries = out.split("\0").filter(Boolean);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const index = entry[0]; // XY <path> — X 가 인덱스, Y 가 워킹트리 상태다
    const worktree = entry[1];
    const path = entry.slice(3);

    // rename·copy 는 **레코드 둘**로 온다: `XY <새 경로>\0<원래 경로>`. 뒤엣것은 상태
    // 접두어가 없는 맨 경로라, 해석하면 첫 두 글자를 상태로 읽고 경로는 세 글자가 잘린다
    // (`.claude/…` → `aude/…`). 그러면 `git mv` 한 커밋이 전부 부분 스테이징으로 걸린다.
    if ("RC".includes(index) || "RC".includes(worktree)) i += 1;

    if (entry.startsWith("??")) leftovers.push(`${path} (추적되지 않음)`);
    else if (worktree !== " ") leftovers.push(`${path} (수정이 스테이징되지 않음)`);
  }

  if (leftovers.length === 0) return [];

  return [
    `부분 스테이징이다. 워킹트리 전체를 담아라 — \`git add -A\`.\n` +
      leftovers.map((l) => `      ${l}`).join("\n"),
  ];
}

/**
 * 이 브랜치가 base 이후로 **추가한** spec 을 센다. 둘 이상이면 거부한다.
 *
 * 규약은 "한 브랜치는 spec 을 정확히 한 번만 확정한다" 인데, 지금까지 그걸 지키는 것은
 * 규율뿐이었다. 어긋나면 **두 task 가 한 PR 로 나가고**, 리뷰하는 사람은 어느 인수기준이
 * 어느 변경을 덮는지 알 수 없게 된다.
 *
 * ## base 를 어떻게 잡나
 *
 * `main` 으로 박지 않는다 — `dev` 기반 브랜치에서 틀린다. 보호 브랜치 목록(설정)마다
 * `merge-base` 를 구하고 **HEAD 에서 가장 가까운 것**을 고른다. 하나도 못 찾으면
 * (보호 브랜치가 없는 저장소) 판정하지 않는다 — 없는 것과 모르는 것은 다르다.
 *
 * ## `HEAD` 가 아니라 **인덱스**와 비교한다
 *
 * 지금 커밋되려는 spec 은 아직 `HEAD` 에 없다. `git diff --cached <base>` 는 base 와
 * **인덱스**를 비교하므로, 이미 브랜치에 커밋된 spec 과 지금 담기는 spec 을 함께 센다.
 * `--diff-filter=A` 라 base 에 이미 있던 spec 은 세지 않는다.
 *
 * 그래서 **리비전은 걸리지 않는다** — 기존 spec 을 고치는 것은 추가가 아니라 수정이다.
 */
function multipleSpecs() {
  // 머지 커밋에는 상대 브랜치의 spec 이 통째로 들어온다. 사람이 PR 을 합치는 정당한
  // 경로이므로 세지 않는다.
  if (inMerge()) return [];

  const base = nearestBase();
  if (!base) return [];

  let added;
  try {
    added = git([
      "diff", "--cached", "--name-only", "-z", "--diff-filter=A", base, "--", `${specRoot}/`,
    ]);
  } catch {
    return [];
  }

  const specs = added.split("\0").filter((path) => path.endsWith("spec.md"));
  if (specs.length <= 1) return [];

  return [
    `이 브랜치가 spec 을 ${specs.length}개 추가한다 — 한 브랜치는 task 하나다.\n` +
      specs.map((s) => `      ${s}`).join("\n") +
      `\n      나중 것은 원본에서 새 브랜치를 자르고 거기서 확정해라.`,
  ];
}

/** 보호 브랜치 중 `HEAD` 에서 가장 가까운 갈림점. 못 찾으면 `null`. */
function nearestBase() {
  let best = null;

  for (const branch of PROTECTED) {
    let base;
    try {
      base = git(["merge-base", "HEAD", branch]).trim();
    } catch {
      continue; // 그 브랜치가 이 저장소에 없다.
    }
    if (!base) continue;

    let distance;
    try {
      distance = Number.parseInt(git(["rev-list", "--count", `${base}..HEAD`]).trim(), 10);
    } catch {
      continue;
    }
    if (!Number.isFinite(distance)) continue;

    if (best === null || distance < best.distance) best = { base, distance };
  }

  return best?.base ?? null;
}

/** 이 커밋에 담기는 spec 들. 워킹트리가 아니라 **인덱스**에서 읽는다. */
function malformedSpecs() {
  let staged;
  try {
    staged = git([
      "diff", "--cached", "--name-only", "-z", "--diff-filter=d", "--", `${specRoot}/`,
    ]);
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

#!/usr/bin/env node
/**
 * `post-checkout` — **지금은 흔적만 남긴다.**
 *
 * ## 왜 반쪽으로 두는가
 *
 * 미추적 설치 전체가 한 전제 위에 서 있다: **Claude Code 가 사본을 만들 때 git 의
 * worktree 생성 경로를 탄다.** 그것이 참이면 커밋 없이도 사본에 하네스를 심을 수 있고,
 * 거짓이면 그 위에 세운 것이 전부 헛돈다.
 *
 * 순수 git 에서 이 훅이 도는 것은 실측했다(`docs/measured.md`). 그러나 **Claude Code 가
 * 그 명령을 쓰는지는 비대화형(`claude -p`)으로 잴 수 없다** — 그 모드에서는 `isolation` 도
 * frontmatter 훅도 걸리지 않기 때문이다. 자동화의 끝이 거기라, 남은 것은 사람이 세션에서
 * 한 번 확인하는 것뿐이다.
 *
 * 그래서 이 파일은 **아직 아무것도 심지 않는다.** 발동 사실만 적어 두고, 사람이 두 경로
 * (`EnterWorktree` · 서브에이전트 격리)를 각각 한 번씩 지난 뒤 흔적을 본다. 판정이 음성이면
 * 심기를 구현하지 않는다 — 안 도는 훅에 심기를 얹는 것은 조용히 반쪽인 사본을 만드는 일이고,
 * 그 실패에는 신호가 없다.
 *
 * ## 무엇을 새 사본으로 보는가
 *
 * git 은 `<old-ref> <new-ref> <branch-flag>` 를 준다. **새 사본은 old-ref 가 전부 0** 이고,
 * 평범한 브랜치 전환은 실제 sha 다. 이것이 둘을 가르는 유일한 표식이다.
 *
 * 자릿수로 재지 않고 `pre-push.mjs` 와 같은 `^0+$` 를 쓴다 — SHA-256 저장소에서는 40자가
 * 아니라 64자다. 세는 것은 자릿수가 아니라 **0 뿐인가**다.
 *
 * ## 자식 git 을 부를 때 env 를 씻는다
 *
 * 훅은 `git worktree add` **안에서** 도는 자식 프로세스라 `GIT_DIR` 이 이미 심겨 있다.
 * 그 값이 있으면 git 은 cwd 에서 위로 올라가며 저장소를 찾는 탐색을 통째로 건너뛰고 그것을
 * 쓴다 — `cwd` 로도 못 이긴다. 씻지 않으면 **사본을 겨냥한 질의가 본체를 답한다.**
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";

/**
 * 흔적이 쌓이는 곳. **본체의 `.claude/` 아래**다.
 *
 * 사본 안에 쓰면 그 사본이 거둬질 때(`harness reap`) 같이 사라져, 하필 판정하려는 순간에
 * 근거가 없어진다. 본체는 남는다.
 *
 * `.claude/` 를 고른 이유는 A 가 그것을 무시하기 때문이다 — 이 spec 이 겨냥하는 저장소에서
 * 흔적 파일이 워킹트리에 미추적으로 뜨면, `pre-commit` 이 `git add -A` 를 강제하므로 다음
 * 커밋에 그대로 딸려 들어간다. (이 저장소는 `.claude/` 를 커밋하므로 `.gitignore` 에 이
 * 파일만 따로 적어 뒀다.)
 */
const TRACE = ".claude/post-checkout-trace.log";

/** 새 사본의 표식. 평범한 브랜치 전환은 실제 sha 라 여기 안 걸린다. */
const FRESH = /^0+$/;

const oldRef = process.argv[2] ?? "";
const newRef = process.argv[3] ?? "";

// 브랜치 전환이다 — **아무것도 하지 않는다.** 매 checkout 마다 흔적이 쌓이면 정작 재려는
// 두 경로가 잡음에 묻힌다.
if (!FRESH.test(oldRef)) process.exit(0);

const here = process.cwd();

let toplevel = "";
let main = "";

try {
  toplevel = git(["rev-parse", "--show-toplevel"]).trim();
  // `git worktree list --porcelain` 의 첫 줄은 **언제나 본체**다 — 사본 안에서 물어도 그렇다.
  const first = git(["worktree", "list", "--porcelain"]).split(/\r?\n/)[0] ?? "";
  main = first.startsWith("worktree ") ? first.slice("worktree ".length).trim() : "";
} catch (error) {
  // 여기서 죽으면 `git worktree add` 는 이미 끝난 뒤라 사본은 그대로 남는다. 조용히
  // 넘기면 "훅이 안 돌았다" 와 구별되지 않으므로 stderr 에 남긴다. **종료 코드는 0 이다** —
  // 지금 이 훅의 임무는 발동 여부를 재는 것뿐이라, 실패로 사본 생성을 물들이지 않는다.
  process.stderr.write(`post-checkout: git 질의에 실패했다 — ${`${error.message}`.split(/\r?\n/)[0]}\n`);
}

// 본체를 못 읽었으면 차선으로 이 트리에 쓴다. 흔적이 어디에도 안 남는 것보다 낫다.
const root = main || toplevel || here;

const line =
  [
    "post-checkout",
    `cwd=${here}`,
    `toplevel=${toplevel}`,
    `main=${main}`,
    `new-ref=${newRef}`,
  ].join("\t") + "\n";

try {
  mkdirSync(join(root, ".claude"), { recursive: true });
  appendFileSync(join(root, TRACE), line, "utf8");
} catch (error) {
  process.stderr.write(`post-checkout: 흔적을 남기지 못했다 — ${`${error.message}`.split(/\r?\n/)[0]}\n`);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: here,
    env: cleanEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

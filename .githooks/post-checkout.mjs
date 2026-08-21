#!/usr/bin/env node
/**
 * `post-checkout` — **새 worktree 사본에 하네스를 심는다.**
 *
 * ## 왜 이 자리인가
 *
 * git worktree 사본은 워킹 디렉터리의 복사가 아니라 **`HEAD` 커밋에서** 만들어진다.
 * 커밋에 없는 파일은 디스크에 있어도 사본에 나타나지 않는다. 그런데 하네스는
 * `developer`·`qa`·작업 세션을 **전부 사본 안에서** 돌린다 — 하네스 파일이 커밋되지
 * 않으면 **정작 하네스가 필요한 곳에 하네스가 없다.**
 *
 * 그래서 한때 설치기가 `git add -f` 로 무시 규칙을 뚫고 들어갔다. 그건 `.claude/` 를
 * **개인 설정**으로 보고 무시하는 저장소(각자 다른 하네스를 쓰는 팀)에는 쓸 수 없다.
 *
 * `git worktree add` 는 **새 사본 안에서** 이 훅을 부른다(실측: 순수 git · Claude Code 의
 * `EnterWorktree` · 서브에이전트 `isolation: worktree` 세 경로 전부). 그 자리에서 본체의
 * 하네스를 사본으로 복사하면 **커밋 없이도** 사본이 하네스를 갖는다.
 *
 * ## 반쪽으로 서는 것이 가장 나쁘다
 *
 * 사본에 `.claude/agents/*.md` 는 상속되는데(Claude Code 가 git 본체를 풀어 읽는다)
 * `.claude/settings.json` 은 안 온다(cwd 의 `.claude/` 에서만 읽힌다). 그래서 심기가
 * 실패하면 **에이전트는 정상 스폰되는데 종료 훅만 없는** 상태가 된다:
 *
 * ```
 * developer 가 끝났다고 선언 → frontmatter 의 SubagentStop 은 상속돼 등록돼 있다
 *   → 그 명령이 사본에 없는 파일을 가리킨다 → 훅이 에러로 끝난다(차단이 아니라 통과)
 *   → 게이트도 인계 커밋도 없다 → 작업이 사본 안에 갇힌 채 사라진다
 * ```
 *
 * 인계 실패를 알리는 `systemMessage` 조차 **그 훅 안에서** 나오므로 신호가 없다.
 * 그래서 이 파일은 **실패를 절대 삼키지 않는다** — stderr 와 종료 코드로 드러낸다.
 *
 * ## 무엇을 새 사본으로 보는가
 *
 * git 은 `<old-ref> <new-ref> <branch-flag>` 를 준다. **새 사본은 old-ref 가 전부 0** 이고,
 * 평범한 브랜치 전환은 실제 sha 다. 이것이 둘을 가르는 유일한 표식이다.
 *
 * 자릿수로 재지 않고 `pre-push.mjs` 와 같은 `^0+$` 를 쓴다 — SHA-256 저장소에서는 40자가
 * 아니라 64자다. 세는 것은 자릿수가 아니라 **0 뿐인가**다.
 *
 * `git clone` 도 old-ref 가 0 이지만, 그때는 본체 자신이 체크아웃되는 것이라 아래
 * "본체이면 종료" 에 걸린다.
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
import { plant } from "./plant.mjs";

/**
 * 발동 흔적이 쌓이는 곳. **본체의 `.claude/` 아래**다.
 *
 * 심기가 붙은 뒤에도 남겨 둔다. 이 훅의 실패 모드는 "조용히 반쪽" 이고, 흔적이 없으면
 * **훅이 안 불린 것**과 **불렸는데 심을 것이 없었던 것**을 구별할 수단이 사라진다 —
 * 그 구별이 정확히 `harness smoke` 가 사람에게 확인시키는 것이다.
 *
 * 사본 안이 아니라 본체에 쓴다. 사본에 쓰면 그것이 거둬질 때(`harness reap`) 같이
 * 사라져, 하필 판정하려는 순간에 근거가 없어진다.
 */
const TRACE = ".claude/post-checkout-trace.log";

/** 새 사본의 표식. 평범한 브랜치 전환은 실제 sha 라 여기 안 걸린다. */
const FRESH = /^0+$/;

/* ── 진입 ─────────────────────────────────────────────────────────────────── */

/**
 * **임포트되는 것만으로 돈다.** `pre-commit`·`pre-push` 와 같은 계약이다.
 *
 * 여기에 `process.argv[1] === import.meta.url` 같은 main 가드를 씌우면 안 된다. 설치본에서
 * A 의 `.githooks/post-checkout.mjs` 는 **패키지를 임포트하는 한 줄짜리 shim** 이라, 그때
 * 두 값은 서로 다른 파일을 가리킨다 — 훅은 불리는데 아무것도 안 하고 0 으로 끝난다.
 * **실제로 그렇게 만들었다가 실측에서 잡았다.** 판정을 `plant.mjs` 로 가른 이유가 이것이다.
 */
main();

function main() {
  const oldRef = process.argv[2] ?? "";
  const newRef = process.argv[3] ?? "";

  // 브랜치 전환이다 — **아무것도 하지 않는다.** 매 checkout 마다 심기가 돌면 사람이 사본
  // 안에서 한 수정을 되돌리게 된다.
  if (!FRESH.test(oldRef)) process.exit(0);

  const here = process.cwd();
  const git = (args) =>
    execFileSync("git", args, {
      cwd: here,
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  let toplevel = "";
  let mainRoot = "";

  try {
    toplevel = git(["rev-parse", "--show-toplevel"]).trim();
    // `git worktree list --porcelain` 의 첫 줄은 **언제나 본체**다 — 사본 안에서 물어도 그렇다.
    const first = git(["worktree", "list", "--porcelain"]).split(/\r?\n/)[0] ?? "";
    mainRoot = first.startsWith("worktree ") ? first.slice("worktree ".length).trim() : "";
  } catch (error) {
    die(`git 질의에 실패했다 — ${firstLine(error)}`);
  }

  // 어디서 어디로 심을지를 모르면 **심지 않는다.** 조용히 0 을 내면 사본은 반쪽인 채로
  // 에이전트가 시작하고, 그 실패에는 아무 신호도 없다.
  if (!toplevel || !mainRoot) {
    die(`본체(${mainRoot || "?"})나 사본(${toplevel || "?"})의 경로를 못 읽어 심지 못했다.`);
  }

  // 본체 자신이다 — `git clone` 과 최초 체크아웃이 여기로 온다. 심을 것이 없다.
  if (samePath(mainRoot, toplevel)) process.exit(0);

  const { planted, present, skipped, failed } = plant(mainRoot, toplevel);

  trace(mainRoot, {
    cwd: here,
    toplevel,
    main: mainRoot,
    "new-ref": newRef,
    planted: planted.length,
    // 사본이 `HEAD` 에서 이미 받아 둔 것. 이 칸이 있어야 `planted=0` 을 읽을 수 있다.
    present: present.length,
    skipped: skipped.length,
    failed: failed.length,
  });

  if (failed.length > 0) {
    process.stderr.write(
      `post-checkout: 사본에 하네스를 심지 못했다 — ${failed.length}개 실패.\n` +
        failed.map((line) => `  ! ${line}\n`).join("") +
        `사본: ${toplevel}\n` +
        `이대로 두면 그 사본의 에이전트는 **게이트도 인계 커밋도 없이** 끝난다.\n`,
    );
    process.exit(1);
  }

  process.exit(0);
}

/** 흔적 한 줄. **실패해도 종료 코드를 물들이지 않는다** — 기록은 심기의 조건이 아니다. */
function trace(root, fields) {
  const line = ["post-checkout", ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join("\t");
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    appendFileSync(join(root, TRACE), `${line}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`post-checkout: 흔적을 남기지 못했다 — ${firstLine(error)}\n`);
  }
}

function die(message) {
  process.stderr.write(`post-checkout: ${message}\n`);
  process.exit(1);
}

const firstLine = (error) => `${error.message}`.split(/\r?\n/)[0];

/** 경로 비교 — 구분자와 (Windows 면) 대소문자를 맞춘다. */
function samePath(a, b) {
  const norm = (p) => {
    const unified = `${p}`.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? unified.toLowerCase() : unified;
  };
  return norm(a) === norm(b);
}

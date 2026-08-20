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
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { managedPaths } from "../install/managed.mjs";

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

/**
 * 사본에 있어야 하는 것.
 *
 * **목록을 손으로 적지 않는다** — `managedPaths()` 에서 짓는다. 손 목록은 `sync` 가 파일을
 * 하나 더 얹을 때 이 훅만 그것을 모르고, 새 파일은 미추적으로 태어나므로 **하필 가장
 * 필요한 순간에** 빠진다.
 *
 * 거기에 더하는 것은 하네스가 *소유하지 않는* 것들이다 — A 의 파일에 하네스가 몇 줄을
 * 얹었을 뿐이라 `managedPaths()` 에 들 수 없지만, 사본에 없으면 그 층이 죽는다:
 *
 * | 더하는 것 | 없으면 |
 * |---|---|
 * | `.claude/settings.json` | **층 1 과 `SessionStart` 가 통째로 죽는다.** 사본에서는 여기가 유일한 출처다 |
 * | `.claude/CLAUDE.md` | `@harness.md` 가 안 펼쳐진다 — 조상의 `CLAUDE.md` 는 로드돼도 **그 임포트는 안 펼쳐진다**(실측) |
 * | `harness.config.json` | 게이트 명령·spec 위치가 기본값으로 조용히 되돌아간다 |
 * | `.claude/harness/` | 벤더링본. shim 이 이걸 상대경로로 부르게 되면 없는 곳을 가리킨다 |
 *
 * **`.claude/worktrees/` 는 여기 없다.** 목적지가 원본 안에 중첩돼 있어 통째 복사는
 * 재귀에 걸려 **조용히 절반만 복사하고 성공을 반환한다**(실측). 목록을 명시하는 이유가
 * 이것이고, 그래서 이 함수는 절대 "`.claude/` 전부" 로 넓어지면 안 된다.
 */
export function plantList() {
  return [
    ...managedPaths(),
    ".claude/settings.json",
    ".claude/CLAUDE.md",
    ".claude/harness.config.json",
    // 구 위치. 아직 옮기지 않은 설치본이 있다 — 있으면 같이 간다.
    "harness.config.json",
    ".claude/harness/",
  ];
}

/**
 * 본체의 하네스를 사본으로 심는다.
 *
 * ## 두 가지를 건너뛴다 — 이유가 서로 다르다
 *
 * - **본체에 없는 것**: 심을 것이 없는 것이지 실패가 아니다. 벤더링본도 `harness.config.json`
 *   도 선택 사항이라, 없다고 종료 코드를 물들이면 멀쩡한 저장소가 전부 빨개진다.
 * - **사본에 이미 있는 것**: `.claude/` 를 커밋하는 저장소에서는 사본이 `HEAD` 에서
 *   그것을 이미 받았다. 거기에 본체의 **워킹트리** 파일을 덮어쓰면, 본체에 미커밋 수정이
 *   있을 때 **사본이 dirty 해진다** — 갓 만든 사본의 `git status` 가 깨끗해야 한다는 것은
 *   협상 대상이 아니다(그 트리에서 인계 커밋이 찍힌다).
 *
 * 둘을 **따로 센다.** 합쳐 놓으면 `planted=0` 이 "이미 다 있었다"(정상)인지 "심을 목록이
 * 비었다"(고장)인지 구별되지 않는데, 그 둘은 진단이 정반대다.
 *
 * @param {string} main 본체 최상단
 * @param {string} copy 갓 만들어진 사본의 최상단
 * @returns {{planted: string[], present: string[], skipped: string[], failed: string[]}}
 */
export function plant(main, copy) {
  const planted = [];
  const present = [];
  const skipped = [];
  const failed = [];

  for (const rel of plantList()) {
    const from = join(main, rel);
    if (!existsSync(from)) {
      skipped.push(rel);
      continue;
    }

    let files;
    try {
      files = filesUnder(from, rel);
    } catch (error) {
      failed.push(`${rel} — ${firstLine(error)}`);
      continue;
    }

    for (const file of files) {
      const to = join(copy, file);
      if (existsSync(to)) {
        present.push(file);
        continue;
      }
      try {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(join(main, file), to);
        planted.push(file);
      } catch (error) {
        failed.push(`${file} — ${firstLine(error)}`);
      }
    }
  }

  return { planted, present, skipped, failed };
}

/** 저장소 기준 상대 경로들. 파일이면 자기 하나, 디렉터리면 그 아래 전부. */
function filesUnder(full, rel) {
  const path = rel.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!statSync(full).isDirectory()) return [path];

  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(join(full, entry.name), `${path}/${entry.name}`),
  );
}

const firstLine = (error) => `${error.message}`.split(/\r?\n/)[0];

/* ── 진입 ─────────────────────────────────────────────────────────────────── */

/**
 * **직접 실행될 때만 돈다.** 테스트가 `plant` 를 불러다 쓰려면 임포트가 안전해야 하는데,
 * 모듈 최상단에서 바로 판정하면 `import` 하는 것만으로 `process.exit` 가 돈다.
 * `init.mjs`·`smoke.mjs` 와 같은 가드다.
 */
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main();
}

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

/** 경로 비교 — 구분자와 (Windows 면) 대소문자를 맞춘다. */
function samePath(a, b) {
  const norm = (p) => {
    const unified = `${p}`.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? unified.toLowerCase() : unified;
  };
  return norm(a) === norm(b);
}

#!/usr/bin/env node
// worktree 생성 헬퍼.
// 저장소 밖 형제 디렉터리에 worktree 를 만들고, harness/config.json 의 baseBranch 에서 분기한다.
// 규약은 .claude/CLAUDE.md '## worktree 동시작업 규약' 참고.
// setup-githooks.mjs 와 같은 결: .git 이 없으면 조용히 종료, 비가역(remove/prune)은 하지 않는다.
//
// 설정은 스스로 파싱하지 않고 gate.mjs 의 loadConfig 를 import 한다 — 같은 설정을 다르게
// 해석하는 사본을 만들지 않기 위함이다(harness/gate-pipeline/spec.md 가 세운 경계).

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve, relative, isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, DEFAULTS, CONFIG_PATH } from "./gate.mjs";

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// 브랜치명 → 마지막 세그먼트(task). 빈 값/형식 위반은 에러.
export function taskFromBranch(branch) {
  if (!branch || !branch.trim()) throw new Error("브랜치명이 필요합니다");
  if (!BRANCH_RE.test(branch) || branch.includes("..")) {
    throw new Error(`브랜치명 형식이 올바르지 않습니다: ${branch}`);
  }
  const segs = branch.split("/").filter(Boolean);
  return segs[segs.length - 1];
}

// repoRoot + branch → 저장소의 형제 worktree 절대경로 (<parent>/<repoName>-<task>)
export function worktreePathFor(repoRoot, branch) {
  const root = resolve(repoRoot);
  const task = taskFromBranch(branch);
  return join(dirname(root), `${basename(root)}-${task}`);
}

// target 이 repo 트리 내부면 에러 (worktree 는 반드시 저장소 밖에 둔다).
export function assertOutsideRepo(repoRoot, target) {
  const root = resolve(repoRoot);
  const rel = relative(root, resolve(target));
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (inside) {
    throw new Error(`worktree 경로가 저장소 내부입니다: ${target} — 저장소 밖 형제 디렉터리를 사용하세요`);
  }
}

// 경로 비교용 정규화: resolve + normalize 후 Windows 의 대소문자 차이를 흡수한다.
// verify-branch 훅도 이 함수를 import 한다(세션/대상 워킹트리 비교) — 같은 비교 규칙을
// 두 곳이 각자 구현하면 한쪽만 Windows 대소문자를 흡수하는 식으로 어긋난다.
export function samePath(a, b) {
  const na = normalize(resolve(a));
  const nb = normalize(resolve(b));
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// `git worktree list --porcelain` 을 파싱해 [{ path, branch }] 로 반환. branch 는 마지막 세그먼트가 아닌
// 전체 ref 의 짧은 이름(refs/heads/<x> → <x>). detached 면 branch=null.
export function parseWorktreeList(porcelain) {
  const out = [];
  let cur = null;
  for (const raw of String(porcelain).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = { path: line.slice("worktree ".length), branch: null };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "" && cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ref 존재 여부. `origin/x` 는 refs/remotes/, 그 외는 refs/heads/ 로 검증한다
// (rev-parse 와 달리 태그·SHA 를 브랜치로 오인하지 않는다).
function refExists(ref) {
  const full = ref.startsWith("origin/") ? `refs/remotes/${ref}` : `refs/heads/${ref}`;
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", full], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// 로컬 브랜치 존재 여부.
function branchExists(branch) {
  return refExists(branch);
}

// 기준 브랜치명 → 실제로 분기에 쓸 ref. `<base>` → `origin/<base>` 순으로 찾는다.
// 순수 함수(refExists 주입) → git 없이 테스트할 수 있다. gate.mjs 의 planGate(dirExists) 와 같은 관례.
//
// 탐색 순서가 gate.mjs 의 mergeBase 와 반대(저쪽은 origin/ 우선)인 것은 의도적이다:
// 분기는 '사람이 방금 로컬에 만든 기준 브랜치' 를 존중해야 하고, merge-base 는 '원격 기준선과의
// 공통 조상' 이라 원격이 먼저다. origin/ 폴백을 두는 이유는 갓 클론한 저장소에 로컬 추적
// 브랜치가 없을 수 있기 때문이다.
//
// 둘 다 없으면 HEAD 로 물러서지 않고 throw 한다 — 조용히 물러서면 의도치 않은 커밋에서
// 분기되고, 그 사실은 머지할 때에야 드러난다. 실패 방향이 나쁘다.
export function resolveBaseRef(base, { refExists: exists }) {
  for (const ref of [base, `origin/${base}`]) {
    if (exists(ref)) return ref;
  }
  throw new Error(
    `기준 브랜치를 찾을 수 없습니다: '${base}' 도 'origin/${base}' 도 없습니다 — ` +
      `${CONFIG_PATH} 의 baseBranch 를 확인하세요`,
  );
}

// `git worktree add` 인자 조립. 브랜치가 이미 있으면 attach(-b·기준 ref 불필요),
// 없으면 기준 ref 에서 새로 분기한다. 브랜치명·경로는 항상 인자 배열로 넘어가 셸을 거치지 않는다.
export function worktreeAddArgs({ branch, path, baseRef, branchExists }) {
  return branchExists
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, baseRef];
}

// worktree 를 멱등하게 확보한다. 이미 같은 브랜치의 worktree 가 그 경로에 있으면 재사용한다.
//  반환: { created: boolean, baseRef: string|null } — created=false 면 기존 worktree 재사용,
//        baseRef=null 이면 기존 브랜치를 attach 한 것(분기 기준을 쓰지 않았다).
//  throw: 경로가 다른 브랜치의 worktree거나, worktree 가 아닌 일반 디렉터리로 점유돼 있을 때,
//        또는 새 브랜치를 만들어야 하는데 기준 브랜치를 찾을 수 없을 때.
function ensureWorktree(branch, path, baseBranch) {
  let list = [];
  try {
    const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    list = parseWorktreeList(porcelain);
  } catch {
    // worktree list 실패는 치명적이지 않다 — 아래 add 시도가 실제 에러를 드러낸다.
  }

  const atPath = list.find((w) => samePath(w.path, path));
  if (atPath) {
    if (atPath.branch === branch) return { created: false, baseRef: null };
    throw new Error(
      `경로가 다른 브랜치(${atPath.branch ?? "detached"})의 worktree 입니다: ${path}`,
    );
  }

  // 경로가 worktree 는 아니지만 일반 디렉터리로 점유돼 있으면 git add 가 실패하니 먼저 거른다.
  if (existsSync(path)) {
    throw new Error(`경로가 이미 존재하지만 worktree 가 아닙니다: ${path} — 먼저 정리하세요`);
  }

  // 브랜치가 이미 있으면 -b 없이 attach, 없으면 기준 ref 에서 새로 분기.
  // attach 경로에서는 resolveBaseRef 를 부르지 않는다 — 그러지 않으면 기준 브랜치가 없는
  // 저장소에서 기존 브랜치 attach 마저 막힌다(지금 되는 동작이라 회귀가 된다).
  const exists = branchExists(branch);
  const baseRef = exists ? null : resolveBaseRef(baseBranch, { refExists });
  const args = worktreeAddArgs({ branch, path, baseRef, branchExists: exists });
  execFileSync("git", args, { stdio: "inherit" });
  return { created: true, baseRef };
}

// --- 세션 기동 헬퍼 (순수 함수: import 시 부수효과 없음 → 단위 테스트 가능) ---

// 브랜치 → 새 세션에 줄 개발 지시 seed. 새 세션의 load-spec 로더가 브랜치로 spec 을
// 자동 주입하므로 seed 는 "개발을 시작하라"는 트리거면 충분하다(spec 경로를 박지 않는다).
export function seedPromptFor(branch) {
  const task = taskFromBranch(branch);
  return `${task} 개발 진행 — 등록된 spec 대로 test-first 로 구현`;
}

// argv(스크립트 인자 배열) → { branch, seed }. --seed <값> / --seed=<값> 지원.
// --seed 의 값 토큰은 브랜치명으로 오인하지 않는다. 순수 함수(부수효과 없음 → 테스트 가능).
export function parseArgs(args) {
  let branch;
  let seed;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--seed") {
      seed = args[i + 1];
      i++; // 다음 토큰(값)을 소비
    } else if (a.startsWith("--seed=")) {
      seed = a.slice("--seed=".length);
    } else if (!a.startsWith("--") && branch === undefined) {
      branch = a;
    }
  }
  return { branch, seed };
}

// POSIX 안전 단일인용: 내부 ' 를 '\'' 로 이스케이프해 공백/특수문자를 무력화한다.
export function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// worktree 에서 개발 세션을 여는 셸 명령(POSIX). path·seed 를 단일인용으로 감싼다.
export function launchCommandFor(path, seed) {
  return `cd ${shellSingleQuote(path)} && claude ${shellSingleQuote(seed)}`;
}

// PowerShell 안전 단일인용: 내부 ' 를 '' 로 이스케이프한다(PowerShell 의 리터럴 문자열 규칙).
export function powershellSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// worktree 에서 개발 세션을 여는 셸 명령(Windows/PowerShell). cd·&& 대신 Set-Location·; 사용.
export function launchCommandForWindows(path, seed) {
  return `Set-Location -LiteralPath ${powershellSingleQuote(path)}; claude ${powershellSingleQuote(seed)}`;
}

// 플랫폼에 맞는 "붙여넣기용" 기동 명령(자동 기동 실패 시 출력 폴백). win32=PowerShell, 그 외=POSIX.
export function displayLaunchCommand(path, seed) {
  return process.platform === "win32"
    ? launchCommandForWindows(path, seed)
    : launchCommandFor(path, seed);
}

// 플랫폼에 맞는 "수동 설치" 안내 명령. win32=PowerShell(Set-Location), 그 외=POSIX(cd &&).
// installCommand 는 harness/config.json 에서 온다(단일 출처). 인용 규칙만 여기서 정한다.
export function installCommandFor(path, installCommand) {
  return process.platform === "win32"
    ? `Set-Location ${powershellSingleQuote(path)}; ${installCommand}`
    : `cd ${shellSingleQuote(path)} && ${installCommand}`;
}

// Terminal.app 으로 명령을 실행하는 AppleScript. command 는 AppleScript 큰따옴표
// 문자열 안에 들어가므로 \ 와 " 만 이스케이프한다(셸 명령은 단일인용이라 충돌 없음).
export function terminalLaunchScript(command) {
  const esc = String(command).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `tell application "Terminal"\n  activate\n  do script "${esc}"\nend tell`;
}

// 새 터미널 창에서 worktree 개발 세션 자동 기동 시도.
//  · macOS: Terminal.app(osascript) 에서 POSIX 명령 실행.
//  · Windows: cmd 의 start 로 새 PowerShell 창을 열고, PowerShell 명령을 UTF-16LE base64 로
//    인코딩해 -EncodedCommand 로 넘긴다(인용 충돌 회피). -NoExit 로 세션 종료 후에도 창 유지.
// 지원 안 되는 플랫폼/실패 시 false (폴백은 호출부에서 명령 출력).
function tryLaunchTerminal(path, seed) {
  if (process.platform === "darwin") {
    try {
      execFileSync("osascript", ["-e", terminalLaunchScript(launchCommandFor(path, seed))], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    } catch {
      return false;
    }
  }
  if (process.platform === "win32") {
    try {
      const encoded = Buffer.from(launchCommandForWindows(path, seed), "utf16le").toString("base64");
      execFileSync(
        "cmd",
        ["/c", "start", "", "powershell", "-NoExit", "-EncodedCommand", encoded],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// 등록/spec 존재를 점검해 경고만 한다(차단하지 않음). 새 세션의 spec 주입 가능성을 알린다.
function warnLaunchContext(root, branch) {
  let specPath;
  try {
    const index = JSON.parse(readFileSync(`${root}/harness/index.json`, "utf8"));
    specPath = index?.tasks?.[branch];
  } catch {
    // index 없음/파싱 실패 → 아래 미등록 경고로 처리
  }
  if (!specPath) {
    console.warn(
      `[worktree-add] ⚠ '${branch}' 는 harness/index.json 에 등록돼 있지 않습니다 — 새 세션에 spec 이 자동 주입되지 않을 수 있습니다.`,
    );
    return;
  }
  if (!existsSync(`${root}/${specPath}`)) {
    console.warn(
      `[worktree-add] ⚠ spec 파일이 없습니다: ${specPath} — 새 세션의 설계 검증이 생략될 수 있습니다.`,
    );
  }
}

function usage() {
  process.stdout.write(
    [
      "사용법: node scripts/worktree-add.mjs <branch> [--install] [--launch] [--seed \"<문구>\"]",
      "  예) node scripts/worktree-add.mjs feat/monthly-view --launch",
      `  저장소 밖 형제 디렉터리에 worktree 를 만들고 ${CONFIG_PATH} 의 baseBranch 에서 분기합니다.`,
      `  --install : 생성 후 그 worktree 에서 설치 명령(${CONFIG_PATH} 의 installCommand)까지 실행합니다.`,
      "  --launch  : (--install 포함) 생성·설치 후 그 worktree 에서 개발 세션을 새 터미널 창에서 자동 실행합니다(macOS=Terminal.app, Windows=PowerShell). 실패/미지원 플랫폼이면 기동 명령을 출력합니다.",
      '  --seed "…" : --launch 시 새 세션의 초기 프롬프트(seed)를 지정합니다(생략 시 브랜치에서 도출).',
      "  ※ 이미 같은 브랜치의 worktree 가 있으면 재사용합니다(재실행 시 세션만 다시 기동). node_modules 가 있으면 install 도 건너뜁니다.",
      "",
    ].join("\n"),
  );
}

function main(argv) {
  const args = argv.slice(2);
  const { branch, seed: seedArg } = parseArgs(args);
  const doLaunch = args.includes("--launch");
  const doInstall = doLaunch || args.includes("--install"); // --launch 는 install 을 함의

  if (!branch) {
    usage();
    process.exit(1);
  }

  // .git 이 없으면 조용히 종료 (setup-githooks 와 동일한 방어).
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    process.exit(0);
  }

  let path;
  try {
    path = worktreePathFor(root, branch);
    assertOutsideRepo(root, path);
  } catch (e) {
    console.error(`[worktree-add] ❌ ${e.message}`);
    process.exit(1);
  }

  // 설정은 root 기준으로 읽는다 — cwd 에 의존하면 하위 디렉터리에서 다른 결과가 난다
  // (qa-hash.mjs 가 상대경로를 써서 해시가 어긋났던 전례를 반복하지 않는다).
  // 파일 부재는 정상(아직 설정하지 않은 저장소) → DEFAULTS. 있는데 깨졌으면 중단(gate.mjs 와 같은 판단).
  const configFile = join(root, CONFIG_PATH);
  let config = DEFAULTS;
  if (existsSync(configFile)) {
    try {
      config = loadConfig(readFileSync(configFile, "utf8"));
    } catch (e) {
      console.error(`[worktree-add] ❌ ${e.message}`);
      process.exit(1);
    }
  }

  // 멱등 확보: 이미 같은 브랜치의 worktree 가 그 경로에 있으면 재사용한다(--launch 재실행 대응).
  // 인자 배열로 셸 인젝션 방지.
  let created;
  let baseRef;
  try {
    ({ created, baseRef } = ensureWorktree(branch, path, config.baseBranch));
  } catch (e) {
    console.error(`[worktree-add] ❌ worktree 확보 실패 — ${e.message}`);
    process.exit(1);
  }

  if (created) {
    // 실제로 분기에 쓴 ref 를 그대로 출력한다(로컬/origin 어느 쪽을 썼는지가 드러나야 한다).
    const how = baseRef ? `${baseRef} 분기` : "기존 브랜치 attach";
    console.log(`[worktree-add] ✅ ${path}  (브랜치 ${branch}, ${how})`);
    console.log("[worktree-add] core.hooksPath 는 공유 config 라 worktree 에 자동 적용됩니다.");
  } else {
    console.log(`[worktree-add] ↩ 기존 worktree 재사용: ${path}  (브랜치 ${branch})`);
  }

  // 재사용 worktree 에 node_modules 가 이미 있으면 install 은 불필요(시간 낭비)하니 건너뛴다.
  const depsPresent = existsSync(join(path, "node_modules"));
  if (doInstall && !created && depsPresent) {
    console.log(`[worktree-add] node_modules 가 이미 있어 '${config.installCommand}' 를 건너뜁니다.`);
  } else if (doInstall) {
    console.log(`[worktree-add] ${config.installCommand} 실행...`);
    try {
      // 설치 명령은 셸을 거쳐 실행된다. 신뢰 모델은 gate.mjs 의 cmd 와 같다 —
      // harness/config.json 은 저장소에 커밋된 파일이고, 그것을 고칠 수 있는 사람은 이미
      // 코드를 고칠 수 있다. 새로운 신뢰 경계를 만들지 않는다.
      // (브랜치명 등 사용자 입력은 여전히 인자 배열로 넘겨 인젝션을 막는다 — 그 구분은 유지한다.)
      //
      // Windows: npm 은 npm.cmd 라 execFileSync('npm') 가 셸 없이 실패하고, Git Bash(MSYS) 하위에선
      // esbuild 등 native postinstall 바이너리가 0xC0000142(DLL init 실패)로 깨진다.
      // → PowerShell 로 install 을 돌려 둘 다 회피한다. 그 외 OS 는 기본 셸에 맡긴다.
      if (process.platform === "win32") {
        execFileSync("powershell", ["-NoProfile", "-Command", config.installCommand], {
          cwd: path,
          stdio: "inherit",
        });
      } else {
        execSync(config.installCommand, { cwd: path, stdio: "inherit" });
      }
    } catch {
      // 설치 실패로 worktree 를 지우지 않는다 — 삭제는 비가역이다.
      console.warn(
        `[worktree-add] ⚠ '${config.installCommand}' 실패 — worktree 는 유지됩니다. '${installCommandFor(path, config.installCommand)}' 를 수동 실행하세요.`,
      );
    }
  } else {
    console.log(`[worktree-add] 다음 단계: ${installCommandFor(path, config.installCommand)}`);
  }

  // --launch: 그 worktree 에서 개발 세션을 새 터미널 창에서 기동한다(실패/미지원 시 기동 명령 출력 폴백).
  if (doLaunch) {
    warnLaunchContext(root, branch);
    const seed = seedArg ?? seedPromptFor(branch);
    if (tryLaunchTerminal(path, seed)) {
      console.log("[worktree-add] ✅ 새 터미널 창에서 개발 세션을 기동했습니다.");
    } else {
      console.warn(
        "[worktree-add] ⚠ 터미널 자동 기동 실패(또는 미지원 플랫폼) — 아래 명령을 직접 실행하세요.",
      );
      console.log("[worktree-add] 새 세션 기동 — 아래를 새 터미널에 붙여넣으세요:");
      console.log(`\n  ${displayLaunchCommand(path, seed)}\n`);
    }
  }
}

// 직접 실행일 때만 main 실행 (import 시엔 실행 안 됨 → 순수 함수 단위 테스트 가능).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}

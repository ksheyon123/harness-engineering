#!/usr/bin/env node
// Hook 2 — 브랜치 진입 게이트 (PreToolUse: Edit|Write)
// 코드 작성(Edit/Write) 직전에 "지금 이 파일을, 이 세션에서 고쳐도 되는가" 를 판정한다.
//
// 판정 순서 (harness/verify-branch-guard/spec.md '완료 후 판정'):
//   0. 대상이 세션과 다른 워킹트리(같은 저장소)  → deny  — 그 worktree 의 세션에서 해야 한다
//   0. 대상이 다른 저장소                        → ask   — 다중 저장소 작업은 정당할 수 있다
//      대상이 git 밖(스크래치패드 등)            → worktree 강제 대상이 아니다(간섭 안 함)
//   1. git 아님 / harness/index.json 없음        → 통과
//   2. 보호 브랜치(config.baseBranch + protectedBranches) → ask
//   3. 미등록 브랜치                             → ask
//   4. 루트 기준 harnessMetaPaths 접두어          → 통과
//   5. 링크드 worktree 아님                      → deny  — spec 있는 task 는 worktree 에서만
//   6. 그 외                                     → 통과
//
// 0 이 맨 앞인 것은 의도적이다. 보호 브랜치 ask 가 먼저 조기 반환하면, 메인 체크아웃 세션이
// 다른 worktree 의 소스를 편집하는 것이 deny 가 아니라 ask 로 새어 나간다(실제로 그랬다).
//
// 판정 로직은 순수 함수로 두고(테스트는 verify-branch.test.mjs), git 호출·stdin 파싱은
// main() 에만 둔다. gate.mjs / worktree-add.mjs 와 같은 관례.
// 자체 오류는 프롬프트/작업을 깨지 않도록 항상 exit 0.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, DEFAULTS, CONFIG_PATH } from "../../scripts/gate.mjs";
import { samePath } from "../../scripts/worktree-add.mjs";

// ── 순수 함수 ────────────────────────────────────────────────────────────────

// 경로 정규화: 역슬래시 → 슬래시, 선행 './' 제거, 후행 '/' 제거.
const norm = (p) =>
  String(p ?? "")
    .split("\\")
    .join("/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");

// 저장소 루트 상대경로가 면제 목록에 해당하는가.
// 규칙: 정확 일치, 또는 디렉터리 경계('/') 로 시작하는 접두어.
//  · 'harness/' 는 'harness/x' 를 면제하지만 'apps/web/harness/x' 는 면제하지 않는다(루트 앵커링).
//  · 'BACKLOG.md' 는 'BACKLOG.md' 만 면제하고 'BACKLOG.md.bak' 은 면제하지 않는다.
//  · 슬래시를 빠뜨린 'harness' 도 경계에서 매칭한다 — 설정 오타가 조용히 강제를 뒤집는 것보다 낫다.
export function isHarnessMeta(relPath, metaPaths) {
  const rel = norm(relPath);
  if (!rel || rel.startsWith("..")) return false;
  return (metaPaths ?? []).some((raw) => {
    const entry = norm(raw);
    if (!entry) return false;
    return rel === entry || rel.startsWith(`${entry}/`);
  });
}

// 링크드 worktree 의 git-dir(<공용>/.git/worktrees/<name>) → 공용 git-dir.
// `--path-format=absolute --git-common-dir` 가 안 되는 git(2.31 미만)에서 `--absolute-git-dir`
// 로 폴백할 때 필요하다. 그대로 비교하면 모든 worktree 가 '다른 저장소' 로 오분류된다.
export function stripWorktreeSuffix(gitDir) {
  return norm(gitDir).replace(/\/worktrees\/[^/]+$/, "");
}

// 세션/대상의 (toplevel, common-dir) → 위치 관계.
//  same           : 같은 워킹트리 — 기존 판정으로 진행
//  other-worktree : 같은 저장소의 다른 워킹트리 — 규약 위반(deny)
//  other-repo     : 아예 다른 저장소 — 정당할 수 있다(ask)
//  outside        : 대상이 git 밖이거나 비교 불가 — 간섭하지 않는다
export function classifyLocation({ sessionTop, sessionCommon, targetTop, targetCommon }) {
  if (!targetTop || !targetCommon || !sessionTop || !sessionCommon) return "outside";
  if (!samePath(sessionCommon, targetCommon)) return "other-repo";
  return samePath(sessionTop, targetTop) ? "same" : "other-worktree";
}

// 설정 텍스트 → 면제 목록. 훅은 설정이 없거나 깨져도 죽지 않고 기본값으로 물러선다
// (설정 오류를 알리는 것은 gate.mjs 의 몫이다 — qa-hash.mjs 와 같은 방침).
export function resolveMetaPaths(configText) {
  try {
    if (typeof configText === "string") return loadConfig(configText).harnessMetaPaths;
  } catch {
    /* 깨진 설정 → 기본값 */
  }
  return DEFAULTS.harnessMetaPaths;
}

// 설정 텍스트 → 보호 브랜치 Set. `baseBranch` 를 **자동으로 포함**하고 `protectedBranches` 를
// 합집합으로 더한다. resolveMetaPaths 와 같은 방침으로 설정이 없거나 깨지면 DEFAULTS 로 물러선다.
//
// 목록을 훅에 박지 않는 이유: 분기 기준은 이미 config.baseBranch 한 곳에 있는데 훅이 이름을
// 따로 알고 있으면 이중 출처가 된다 — `baseBranch: "develop"` 인 프로젝트에서 develop 은
// 보호되지 않고, 이 저장소는 쓰지도 않는 dev·master 를 보호했다(harness/pipeline-review.md 논점 H).
export function resolveProtectedBranches(configText) {
  let baseBranch = DEFAULTS.baseBranch;
  let extra = DEFAULTS.protectedBranches;
  try {
    if (typeof configText === "string") {
      const cfg = loadConfig(configText);
      baseBranch = cfg.baseBranch;
      extra = cfg.protectedBranches;
    }
  } catch {
    /* 깨진 설정 → 기본값 */
  }
  return new Set([baseBranch, ...extra]);
}

// ── 실행부 ──────────────────────────────────────────────────────────────────

function decide(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
const ask = (reason) => decide("ask", reason);
const deny = (reason) => decide("deny", reason);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

// 디렉터리의 git 컨텍스트 → { top, common } (실패 시 null 값).
function gitContext(dir) {
  let top = null;
  let common = null;
  try {
    top = norm(git(["rev-parse", "--show-toplevel"], dir));
  } catch {
    return { top: null, common: null }; // git 밖
  }
  try {
    common = stripWorktreeSuffix(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], dir));
  } catch {
    try {
      // git 2.31 미만 폴백. 링크드 worktree 는 <공용>/.git/worktrees/<name> 을 주므로 되돌린다.
      common = stripWorktreeSuffix(git(["rev-parse", "--absolute-git-dir"], dir));
    } catch {
      common = null;
    }
  }
  return { top, common };
}

// 파일 경로 → 존재하는 가장 가까운 상위 디렉터리. 신규 파일(아직 없음)에도 동작해야 한다.
export function nearestExistingDir(filePath) {
  let dir = dirname(resolve(filePath));
  for (;;) {
    if (existsSync(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();
  const file = String(input.tool_input?.file_path || "");

  const session = gitContext(cwd);

  // 0. 대상 파일이 어느 워킹트리에 속하는가 — 다른 모든 판정보다 먼저다.
  let location = "same";
  if (file) {
    const targetDir = nearestExistingDir(file);
    const target = targetDir ? gitContext(targetDir) : { top: null, common: null };
    location = classifyLocation({
      sessionTop: session.top,
      sessionCommon: session.common,
      targetTop: target.top,
      targetCommon: target.common,
    });

    if (location === "other-worktree") {
      deny(
        `[하네스] 대상 파일이 이 세션과 다른 워킹트리에 있습니다.\n` +
          `  세션: ${session.top}\n  대상: ${target.top}\n` +
          `그 worktree 에서 세션을 열어 편집하세요 — 세션마다 브랜치가 다르고, spec 주입(load-spec)도 그 브랜치 기준입니다. ` +
          `여기서 고치면 'worktree 에서 작업 중' 이라는 전제만 거짓이 된 채 코드가 쓰입니다.`,
      );
    }
    if (location === "other-repo") {
      // 다중 저장소 작업은 정당할 수 있다 — 차단은 과하다.
      ask(
        `[하네스] 대상 파일이 다른 저장소에 있습니다.\n  세션: ${session.top}\n  대상: ${target.top}\n` +
          `의도한 다중 저장소 작업이면 승인하세요.`,
      );
    }
  }

  if (!session.top) process.exit(0); // git 저장소 아님 → 간섭하지 않음

  // 현재 브랜치
  let branch = "";
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  } catch {
    process.exit(0);
  }

  // index.json — 저장소 루트 기준으로 읽는다(cwd 가 하위 디렉터리여도 같은 결과).
  let index;
  try {
    index = JSON.parse(readFileSync(join(session.top, "harness/index.json"), "utf8"));
  } catch {
    process.exit(0); // 하네스 미설정 → 간섭하지 않음
  }

  const registered = Boolean(index?.tasks?.[branch]);

  // 설정 텍스트는 판정 2(보호 브랜치)와 판정 4(면제 경로)가 함께 쓴다. 여기서 한 번만 읽는다.
  // **읽는 위치를 앞으로 당겼을 뿐 판정 순서는 그대로다** — 이 읽기는 file·location 에
  // 의존하지 않는 순수한 파일 읽기라 다른 판정에 부작용이 없다. 보호 브랜치 검사를 설정
  // 읽기 뒤로 미루면 3(미등록)보다 나중이 되어, 보호 브랜치인데 미등록 안내가 나간다.
  let configText = null;
  try {
    configText = readFileSync(join(session.top, CONFIG_PATH), "utf8");
  } catch {
    /* 설정 없음 → 기본값 */
  }

  // 2. 보호 브랜치: 등록 여부와 무관하게 확인을 요구.
  //    목록은 config 의 baseBranch(+ protectedBranches) 가 유일한 출처다.
  if (resolveProtectedBranches(configText).has(branch)) {
    ask(
      `[하네스] 현재 '${branch}'는 보호 브랜치입니다. 코드 수정 전 작업 브랜치로 전환하세요(worktree 권장: node scripts/worktree-add.mjs feat/<task> --launch). 임시 수정을 그대로 진행하려면 승인하세요.`,
    );
  }

  // 3. 미등록 브랜치: 등록된 작업 브랜치로 전환을 권하되, 애드혹 수정은 승인으로 허용
  if (!registered) {
    ask(
      `[하네스] 현재 '${branch}'는 harness/index.json의 tasks에 등록된 작업 브랜치가 아닙니다. 등록된 작업 브랜치로 전환하거나, 애드혹 수정이면 승인하세요.`,
    );
  }

  // 대상이 git 밖이면(스크래치패드 등) 워킹트리 강제의 대상이 아니다.
  if (!file || location === "outside") process.exit(0);

  // 4. 면제 경로 — 저장소 루트 상대경로로 앵커링해서 판정한다(configText 는 판정 2 앞에서 읽었다).
  const metaPaths = resolveMetaPaths(configText);
  const rel = relative(session.top, resolve(file));
  if (isHarnessMeta(rel, metaPaths)) process.exit(0);

  // 5. 등록된 작업 브랜치인데 메인 체크아웃이면 차단 — spec 있는 task 는 worktree 에서만.
  let inLinkedWorktree = true; // 판별 실패 시 간섭하지 않음(오탐 deny 방지)
  try {
    // 링크드 worktree 의 git-dir 은 <공용>/.git/worktrees/<name>. 메인 체크아웃엔 없다.
    inLinkedWorktree = norm(git(["rev-parse", "--absolute-git-dir"], cwd)).includes("/worktrees/");
  } catch {
    inLinkedWorktree = true;
  }

  if (!inLinkedWorktree) {
    deny(
      `[하네스] '${branch}'는 spec이 등록된 task입니다. 면제 경로 밖의 파일(${norm(rel)})은 메인 체크아웃에서 편집할 수 없습니다(차단).\n` +
        `'node scripts/worktree-add.mjs ${branch} --launch' 로 worktree 를 만들고 그 디렉터리에서 세션을 여세요.\n` +
        `면제 경로는 ${CONFIG_PATH} 의 harnessMetaPaths 에 있습니다(현재: ${metaPaths.join(", ")}).`,
    );
  }

  // 6. 등록된 작업 브랜치 + worktree → 정상 흐름에 간섭하지 않음
  process.exit(0);
}

// 직접 실행일 때만 main (import 시엔 부수효과 없음 → 순수 함수 단위 테스트 가능).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    process.exit(0); // 입력 파싱 실패 등 — 작업을 깨지 않는다
  }
}

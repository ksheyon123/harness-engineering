#!/usr/bin/env node
// Hook 2 — 브랜치 진입 게이트 (PreToolUse: Edit|Write, command)
// 코드 작성(Edit/Write) 직전에 두 가지를 확인한다.
//  (1) 현재 git 브랜치가 "등록된 작업 브랜치"인지 — 보호(main/dev/master)/미등록이면 ask.
//  (2) 등록된 작업 브랜치인데, 제품 소스(apps/·packages/)를 "메인 체크아웃"(worktree 아님)에서
//      편집하려 하면 deny(차단) — spec 있는 task는 worktree에서만 작업하도록 강제한다.
//      · harness/·.claude/ 하네스 메타작업(spec·qa-checklist·CLAUDE.md·훅)은 면제.
//      · 링크드 worktree 판별 실패 시 간섭하지 않는다(안전 기본값 = 통과, 오탐 deny 방지).
// 보호/미등록 브랜치는 ask(승인 여지). 자체 오류는 프롬프트/작업을 깨지 않도록 항상 exit 0.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PROTECTED = new Set(["main", "dev", "master"]);

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
  return execSync(`git ${args}`, {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();

  // 현재 브랜치
  let branch = "";
  try {
    branch = git("rev-parse --abbrev-ref HEAD", cwd);
  } catch {
    process.exit(0); // git 저장소 아님 → 간섭하지 않음
  }

  // index.json
  let index;
  try {
    index = JSON.parse(readFileSync(`${cwd}/harness/index.json`, "utf8"));
  } catch {
    process.exit(0); // 하네스 미설정 → 간섭하지 않음
  }

  const registered = Boolean(index?.tasks?.[branch]);

  // 보호 브랜치: 등록 여부와 무관하게 확인을 요구
  if (PROTECTED.has(branch)) {
    ask(
      `[하네스] 현재 '${branch}'는 보호 브랜치입니다. 코드 수정 전 작업 브랜치로 전환하세요(예: git checkout dev && git pull && git checkout -b feat/<task> — 작업 브랜치는 dev에서 분기). 임시 수정을 그대로 진행하려면 승인하세요.`,
    );
  }

  // 미등록 브랜치: 등록된 작업 브랜치로 전환을 권하되, 애드혹 수정은 승인으로 허용
  if (!registered) {
    ask(
      `[하네스] 현재 '${branch}'는 harness/index.json의 tasks에 등록된 작업 브랜치가 아닙니다. 등록된 작업 브랜치로 전환하거나, 애드혹 수정이면 승인하세요.`,
    );
  }

  // (2) 등록된 작업 브랜치 — 제품 소스를 메인 체크아웃에서 편집하면 worktree 권고.
  //     harness/·.claude/ 하네스 메타작업은 면제(이 게이트가 자기 자신/QA 작업을 막지 않게).
  const file = String(input.tool_input?.file_path || "").split("\\").join("/");
  const isHarnessMeta =
    file.includes("/harness/") ||
    file.startsWith("harness/") ||
    file.includes("/.claude/") ||
    file.startsWith(".claude/");

  if (file && !isHarnessMeta) {
    let inLinkedWorktree = true; // 판별 실패 시 간섭하지 않음
    try {
      const gitDir = git("rev-parse --absolute-git-dir", cwd).split("\\").join("/");
      // 링크드 worktree의 git-dir 은 <공용>/.git/worktrees/<name>. 메인 체크아웃엔 없음.
      inLinkedWorktree = gitDir.includes("/worktrees/");
    } catch {
      inLinkedWorktree = true;
    }

    if (!inLinkedWorktree) {
      deny(
        `[하네스] '${branch}'는 spec이 등록된 task입니다. 제품 소스(apps/·packages/)는 메인 체크아웃에서 편집할 수 없습니다(차단). 'node scripts/worktree-add.mjs ${branch}' 로 worktree를 만들고 그 디렉터리에서 세션을 여세요. (harness/·.claude/ 메타작업은 메인에서 가능)`,
      );
    }
  }

  // 등록된 작업 브랜치 + (worktree이거나 하네스 메타작업) → 정상 흐름에 간섭하지 않음
  process.exit(0);
} catch {
  process.exit(0); // 입력 파싱 실패 등 — 작업을 깨지 않는다
}

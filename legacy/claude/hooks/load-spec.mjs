#!/usr/bin/env node
// Hook 1 — 기능 목록 로더 (UserPromptSubmit, command)
// 현재 git 브랜치의 spec(기능 목록)을 찾아 개발자 컨텍스트에 주입한다.
// 차단하지 않는다. 어떤 실패도 프롬프트를 깨지 않도록 항상 exit 0.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function emit(ctx) {
  if (ctx) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: ctx,
        },
      }),
    );
  }
  process.exit(0);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();

  // 현재 브랜치
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    /* git 저장소 아님 */
  }

  // index.json
  let index;
  try {
    index = JSON.parse(readFileSync(`${cwd}/harness/index.json`, "utf8"));
  } catch {
    emit(""); // index 없음 → 무동작
  }

  const specPath = index?.tasks?.[branch];
  if (!specPath) {
    // 소프트 경고 (전제: 기획자가 spec을 사전 작성)
    emit(
      `[하네스] 현재 브랜치 '${branch || "?"}'에 등록된 기능 목록(spec)이 없습니다. 설계 검증은 생략됩니다. 새 작업이라면 기획자(planner)로 spec을 먼저 작성하세요.`,
    );
  }

  let spec = "";
  try {
    spec = readFileSync(`${cwd}/${specPath}`, "utf8");
  } catch {
    emit(`[하네스] 기능 목록 경로(${specPath})를 읽을 수 없습니다. harness/index.json을 확인하세요.`);
  }

  emit(
    `[하네스] 개발자 역할. .claude/CLAUDE.md의 '하네스 개발자 프로토콜'에 따라 아래 기능 목록을 test-first로 자율 구현하세요(기능 사이에 사용자에게 묻지 않음). (${specPath})\n\n${spec}`,
  );
} catch {
  process.exit(0); // 입력 파싱 실패 등 — 프롬프트를 깨지 않는다
}

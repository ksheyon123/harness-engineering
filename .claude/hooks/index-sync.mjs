#!/usr/bin/env node
// Hook 3 — 인덱스 동기화 (PostToolUse: Edit|Write, command)
// 수정된 파일이 index.json의 components에 매핑돼 있으면, 관련 문서 갱신을 컨텍스트에 알린다.
// 정보 제공만 한다. 항상 exit 0.

import { readFileSync } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();
  const file = input.tool_input?.file_path;
  if (!file) process.exit(0);

  let index;
  try {
    index = JSON.parse(readFileSync(`${cwd}/harness/index.json`, "utf8"));
  } catch {
    process.exit(0); // index 없음
  }

  // 절대경로 → 저장소 상대경로(슬래시 정규화)
  let rel = isAbsolute(file) ? relative(cwd, file) : file;
  rel = rel.split(sep).join("/");

  const m = index.components?.[rel] || index.components?.[file];
  if (!m) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[인덱스 동기화] ${rel} 수정됨 → ${m.doc}의 '${m.section}' 섹션을 최신 코드에 맞게 갱신하세요.`,
      },
    }),
  );
  process.exit(0);
} catch {
  process.exit(0);
}

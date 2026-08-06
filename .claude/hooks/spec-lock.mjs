#!/usr/bin/env node
// spec 소유권 판정 — 규칙 2("한 브랜치는 spec 을 정확히 한 번 확정한다. 고치려면 브랜치를
// 갈아탄다")를 pre-commit 이 강제하기 위한 순수 함수 + CLI.
// 설계는 harness/spec-in-worktree/spec.md, 근거는 harness/pipeline-review.md §4-3 참고.
//
// 판정 로직을 셸이 아니라 여기에 두는 이유: frontmatter 파싱은 sed 한 줄로는 안전하지 않다.
// `sed -n 's/^branch:.*//p'` 는 파일 전체를 훑으므로 spec 본문에 줄 시작이 `branch:` 인
// 문장이 있으면 그것을 소유자로 읽는다. 여기서는 첫 `---`~다음 `---` 블록으로 범위를 좁히고,
// 그 판정을 vitest 로 고정한다.
//
// 훅이 이 파일을 실제로 호출하므로 사본이 아니다 — 강제되지 않는 사본은 이 저장소가
// 반복해서 겪은 실패 모드다(구 BACKLOG #1).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// spec 텍스트 → frontmatter 의 `branch:` 값(없으면 null).
// 첫 줄이 `---` 이고 뒤에 닫는 `---` 가 있을 때만 그 사이를 본다 — 닫는 구분자가 없는데
// 본문 전체를 블록으로 취급하면 본문의 `branch:` 가 소유자로 읽힌다.
export function frontmatterBranch(text) {
  const lines = String(text ?? "").split("\n");
  const trimEol = (s) => s.replace(/\r$/, ""); // CRLF 입력에서도 같은 판정이 나와야 한다

  if (trimEol(lines[0] ?? "") !== "---") return null;

  const close = lines.findIndex((line, i) => i > 0 && trimEol(line) === "---");
  if (close === -1) return null;

  for (const raw of lines.slice(1, close)) {
    const m = /^branch:\s*(.+?)\s*$/.exec(trimEol(raw));
    if (m) return m[1];
  }
  return null;
}

// 이 커밋이 '같은 브랜치에서 spec 을 또 고치는 것' 인가.
// frontmatterText 는 **HEAD 시점의** spec 내용이다(워킹트리가 아니다) — 그래서 리비전
// 브랜치의 첫 개정은 아직 옛 브랜치를 소유자로 갖고 있어 통과한다.
export function isRevisionAttempt(frontmatterText, branch) {
  const owner = frontmatterBranch(frontmatterText);
  return owner !== null && owner === branch;
}

// CLI: stdin = HEAD 시점의 spec 내용, argv[2] = 현재 브랜치.
// 재수정이면 exit 1, 아니면 exit 0. **아무것도 출력하지 않는다** — 사람에게 보여줄 문구는
// 훅의 say() 가 낸다(출력하다 SIGPIPE 로 죽으면 종료코드가 사라져 막아야 할 커밋이 통과한다).
function main(argv) {
  const branch = argv[2];
  if (!branch) process.exit(0); // 브랜치를 못 받으면 차단하지 않는다(원인 불명 실패 방지)

  let input = "";
  try {
    input = readFileSync(0, "utf8");
  } catch {
    // stdin 을 읽을 수 없으면 빈 입력과 같게 다룬다 → 통과.
  }

  process.exit(isRevisionAttempt(input, branch) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}

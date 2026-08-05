---
input_hash: 81cbd2521fcd379e4b3927045f5da7f4e3814befc91516218ce8c3e444b51619
generated: 2026-06-30
spec: harness/worktree-enforce/spec.md
---

# QA 기능 체크리스트 — worktree-enforce

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- CLAUDE.md 분기 기준 절에 worktree 우선 절차 명시 (`scripts/worktree-add.mjs` 호출, 메인 checkout도 임시작업으로 허용)
- CLAUDE.md worktree 동시작업 규약 절에 "메인 체크아웃에서 제품 소스 편집 금지" 규칙 명시
- CLAUDE.md에 `harness/`·`.claude/` 경로 면제 규칙 명시 및 훅의 경고 강제 기술
- verify-branch.mjs가 PreToolUse(Edit|Write) 게이트에서 파일 경로(`tool_input.file_path`) 읽기
- verify-branch.mjs가 링크드 worktree 판별 (`git rev-parse --absolute-git-dir`의 `/worktrees/` 포함 확인)
- verify-branch.mjs가 등록된 task + 메인 체크아웃 + 제품 소스(`apps/`·`packages/`) 편집 시 `permissionDecision: "ask"` 출력
- verify-branch.mjs가 `harness/`·`.claude/` 경로 편집 시 경고 없음(exit 0)
- verify-branch.mjs가 보호 브랜치·미등록 브랜치의 기존 `ask` 동작 유지
- verify-branch.mjs 문법 검증 통과 (`node --check`)

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| CLAUDE.md 분기 기준에 worktree-add.mjs 경로 명시 | (없음) | ✅ covered | — |
| CLAUDE.md worktree 규약에 메인 체크아웃 금지 명시 | (없음) | ✅ covered | — |
| CLAUDE.md에 harness/·.claude/ 면제 규칙 명시 | (없음) | ✅ covered | — |
| verify-branch.mjs: 파일 경로 읽기 (tool_input.file_path) | (없음, 동작 확인) | ✅ covered | — |
| verify-branch.mjs: worktree 판별 로직 (git rev-parse) | (없음, 동작 확인) | ✅ covered | — |
| verify-branch.mjs: harness/·.claude/ 경로 면제 처리 | (없음, 동작 확인) | ✅ covered | — |
| verify-branch.mjs: 등록된 task + 메인 + 제품소스 → ask 출력 | (없음, 동작 확인) | ✅ covered | — |
| verify-branch.mjs: 보호/미등록 브랜치 기존 ask 유지 | (없음, 동작 확인) | ✅ covered | — |
| verify-branch.mjs 문법 검증 (node --check) | (없음) | ✅ covered | — |

## 검증 방식 (Phase 1 보류)

- **CLAUDE.md 문서 항목**: 문서 텍스트 기반 인수기준 확인
- **verify-branch.mjs 동작 항목**: 
  - 코드 라인 정적 분석 (파일 경로 읽기, 경로 판별, worktree 검사, ask 호출 조건)
  - 동작 확인: PreToolUse JSON을 stdin으로 주입한 시뮬레이션 (수동/문서화됨)
  - 문법 검증: `node --check .claude/hooks/verify-branch.mjs` 통과

**테스트 파일 부재**: 루트 훅 스크립트(테스트 러너 없음) — 자동테스트는 Phase 2 보류. 인수기준은 동작 확인(문서 + 수동)으로 만족함.

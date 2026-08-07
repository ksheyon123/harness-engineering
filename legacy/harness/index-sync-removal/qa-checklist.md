---
input_hash: fe7c910bbec8a894ed4fe9be49634b5febfd5a6074e7981b3bc4aa4bac218eec
generated: 2026-08-05
spec: harness/index-sync-removal/spec.md
---

# QA 기능 체크리스트 — index-sync-removal

## 기능 체크리스트 (기획 의도로부터 독립 도출)

### 훅 및 설정 제거 (코드 레벨)
- `.claude/hooks/index-sync.mjs` 파일이 삭제됨
- `.claude/settings.json` 에서 `PostToolUse` 키가 완전히 제거됨 (빈 배열 아님)
- `.claude/settings.json` 이 유효한 JSON 으로 파싱 가능함 (트레일링 콤마 없음)
- `harness/index.json` 에서 `components` 키가 제거됨
- `harness/index.json` 이 유효한 JSON 으로 파싱 가능함
- 나머지 등록된 훅들이 실존하는 파일을 가리킴 (등록된 훅이 깨지지 않음)
- `harness/index.json` 의 `tasks` 키는 그대로 남아 있음 (load-spec·verify-branch·pre-push·worktree-add 의존성 유지)

### 설계 문서 정합성 (문서 레벨)
- `harness-engineering.md` 에서 `index-sync` 및 Hook 3 관련 서술이 제거됨 (변경 이력 항목 제외)
- 제거 결정과 근거가 `harness-engineering.md` 의 "설계 변경 이력" 섹션에 명시됨
- `harness-engineering.md` 의 `.claude/settings.json` 예시가 실제 설정 파일과 일치함
- `README.md` 가 존재하지 않는 훅 파일을 참조하지 않음

### BACKLOG 완료 정리 (추적성)
- `BACKLOG.md` 의 #5 항목이 완료로 표시됨
- #5 항목에 제거를 택한 이유(드리프트 알림 대신 중복 제거, 훅 미동작, 등록 절차 부재)와 커밋 해시가 기록됨

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| `index-sync.mjs` 파일 삭제됨 | `hooks-registration.test.mjs > "훅 파일이 존재하지 않는다"` | ✅ covered | — |
| `settings.json` PostToolUse 키 제거됨 | `hooks-registration.test.mjs > "PostToolUse 키가 없다"` | ✅ covered | — |
| `settings.json` 유효한 JSON | `hooks-registration.test.mjs > "유효한 JSON 이다"` | ✅ covered | — |
| `index.json` components 키 제거됨 | `hooks-registration.test.mjs > "components 키가 없다"` | ✅ covered | — |
| `index.json` 유효한 JSON | `hooks-registration.test.mjs > "유효한 JSON 이다"` | ✅ covered | — |
| 등록된 훅들이 실존 파일 가리킴 | `hooks-registration.test.mjs > "등록된 훅 command 가 모두 실존하는 파일을 가리킨다"` | ✅ covered | — |
| `tasks` 키 유지됨 | `hooks-registration.test.mjs > "tasks 매핑은 그대로 남아 있다"` | ✅ covered | — |
| `harness-engineering.md` 에서 index-sync 제거 (이력 제외) | `hooks-registration.test.mjs > "변경 이력 밖에서 index-sync 를 언급하지 않는다"` | ✅ covered | — |
| 제거 사실이 변경 이력에 기록됨 | `hooks-registration.test.mjs > "제거 사실이 설계 변경 이력에 남아 있다"` | ✅ covered | — |
| `README.md` 에서 index-sync 미언급 | `hooks-registration.test.mjs > "README 는 존재하지 않는 훅 파일을 서술하지 않는다"` | ✅ covered | — |
| `harness-engineering.md` 예시 정합성 | (없음) | △ partial (수동 검토 필요: 문서 예시와 실제 파일 일치 확인) | 수작업 검토 권장 |
| BACKLOG #5 완료 표시 | (없음) | ❌ 누락 | 사람이 BACKLOG.md 확인 |
| BACKLOG #5 에 근거/해시 기록 | (없음) | ❌ 누락 | 사람이 BACKLOG.md 확인 |

## 분석 및 권고

### 커버리지 현황
**장점:**
- 코드 변경 자체는 매우 높은 자동화 검증으로 덮혀 있음 (JSON 파싱, 파일 존재, 키 제거 여부 모두 테스트됨)
- 훅 등록의 무결성(실존 파일 참조)도 회귀 테스트로 보호됨
- 문서 변경(index-sync 언급 제거)도 정적 검사로 확인됨

**주의 사항:**
- `harness-engineering.md` 의 §8 `.claude/settings.json` 예시가 실제 파일과 일치하는지는 정적 테스트로 검증되지 않음. 설정을 제거한 후 문서가 그에 따라 갱신되었는지 사람의 눈으로 확인 필요.
- BACKLOG.md 의 #5 항목 완료 표시 및 근거 기록은 자동화 대상이 아님. 수동으로 확인 필요.

### 게이트 통과 기준
`node scripts/gate.mjs` 통과로 다음이 자동 확인됨:
- 다른 스크립트/도구가 `components` 키를 더 이상 참조하지 않음
- `PostToolUse` 제거로 인한 설정 로드 실패 없음

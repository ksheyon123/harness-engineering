---
input_hash: e09e0a74a7a67b7041fdf1d4b511e89118a39b07dce4352d722f330bd0d094f1
generated: 2026-08-05
spec: harness/drop-phase1/spec.md
---

# QA 기능 체크리스트 — drop-phase1

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- `.claude/agents/qa.md`에서 테스트 러너 부재를 가정하는 "Phase 1 주의" 절을 제거
- `.claude/agents/qa.md`에 테스트 러너 유무를 `harness/config.json`의 `gate.test` 항목으로 판단하는 조건부 지시 추가
- `.claude/agents/qa.md`에서 "이 저장소는 아직 테스트 러너가 없어"라는 사실 주장 제거
- `harness-engineering.md`의 Phasing 단계적 도입 서술을 현재 상태(vitest 도입 완료)로 갱신 (§6, §7.3, §10, §11)
- `harness-engineering.md`에 Phasing 이력을 설계 변경 이력 절에 남김
- BACKLOG #2 항목을 완료로 표시 및 커밋 해시 기록
- README.md의 spec 목록 갱신
- README.md의 '알려진 제약' 항목 정리 (해소된 제약 제거)
- `.claude/hooks/hooks-registration.test.mjs`의 README 검사 정규식이 "index-sync"를 찾되 "index-sync-removal"은 제외하도록 구성

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| `.claude/agents/qa.md` "Phase 1 주의" 절 제거 | (없음) | ❌ 누락 | 요검토 |
| `.claude/agents/qa.md` 조건부 러너 판단 지시 추가 | (없음) | ❌ 누락 | 요검토 |
| `harness-engineering.md` Phasing 서술 갱신 | (없음) | ❌ 누락 | 요검토 |
| `harness-engineering.md` 설계 변경 이력 기록 | (없음) | ❌ 누락 | 요검토 |
| BACKLOG #2 완료 표시 | (없음) | ❌ 누락 | 요검토 |
| README.md spec 목록 및 제약 갱신 | `.claude/hooks/hooks-registration.test.mjs > "README 는 존재하지 않는 훅 파일을 서술하지 않는다"` | ✅ covered | — |
| `.claude/hooks/hooks-registration.test.mjs` 정규식 정확성 | (없음) | ❌ 누락 | 요검토 |

## 주석

이 task는 spec의 "사람 확인 필요" 절에 명시한 대로, **문서·에이전트 정의만 고치므로 새로운 동작 기능 테스트가 없다.** 객관 게이트는 기존 60개 테스트(vitest)로 통과하고, 대부분의 변경이 정적 문서 기술이므로 자동 검증 대상이 아니다.

다만 `.claude/hooks/hooks-registration.test.mjs`의 "README 는 존재하지 않는 훅 파일을 서술하지 않는다" 테스트는 README가 제대로 갱신되었는지 검증한다 — `index-sync(?!-removal)` 정규식으로 "index-sync"는 없되 "index-sync-removal"은 있도록 확인하므로, 이 부분만 자동으로 검증된다.

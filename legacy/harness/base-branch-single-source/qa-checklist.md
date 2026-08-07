---
input_hash: aab548522cf1e4b1e44351d52d5aa1bee452c8f906bcd35f16e9d7381a08f32f
generated: 2026-08-06
spec: harness/base-branch-single-source/spec.md
---

# QA 기능 체크리스트 — base-branch-single-source

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- `loadConfig` 에서 `baseBranch` 필드의 타입 검증 (유효하지 않은 값은 throw, 필드 부재는 DEFAULTS)
- `loadConfig` 에서 `protectedBranches` 필드의 타입 검증 (배열 검사, 원소 문자열 검사, 부재는 `[]`)
- `resolveProtectedBranches` 함수가 `baseBranch` 를 자동 포함하고 `protectedBranches` 와 합집합으로 반환
- 훅의 보호 브랜치 판정이 config 에서 읽은 값을 사용하며, 하드코딩된 PROTECTED Set 이 없음
- 훅의 판정 순서가 보호 브랜치(2) → 미등록(3) 순서를 유지하여 보호 브랜치 판정이 먼저 반환됨
- `worktree-add.mjs` 에 `baseMismatchWarning` 순수 함수가 있고, --from 없을 때 현재 브랜치 ≠ baseBranch 불일치 감지
- 분기 기준 불일치 경고가 차단이 아니라 정보 제공 (exit 0, 종료 코드에 영향 없음)
- 문서에서 `--from` 과 merge-base 기준선의 비대칭성이 명시됨 (분기 기준은 바뀌지만 게이트 기준선은 유지)
- README 의 열린 구멍 표에서 #1/#2/#7 이 해결로 표기됨
- `harness/pipeline-review.md` 논점 H 에 결정 기록과 근거가 있고, QA 모델 이중 출처는 미결로 명시됨

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| `baseBranch` 타입 검증 (throw) | `scripts/gate.test.mjs:97-103` | ✅ covered | — |
| `baseBranch` 필드 부재 회귀 | `scripts/gate.test.mjs:107-110` | ✅ covered | — |
| `baseBranch` 정상값 보존 | `scripts/gate.test.mjs:112-114` | ✅ covered | — |
| `protectedBranches` 타입 검증 | `scripts/gate.test.mjs:130-140` | ✅ covered | — |
| `protectedBranches` 기본값 | `scripts/gate.test.mjs:118-121` | ✅ covered | — |
| `resolveProtectedBranches` 함수 존재 및 baseBranch 자동 포함 | `.claude/hooks/verify-branch.test.mjs:163-166` | ✅ covered | — |
| `resolveProtectedBranches` 에서 dev/master 하드코딩 없음 | `.claude/hooks/verify-branch.test.mjs:169-175` | ✅ covered | — |
| `resolveProtectedBranches` 에서 protectedBranches 합집합 | `.claude/hooks/verify-branch.test.mjs:177-182` | ✅ covered | — |
| `resolveProtectedBranches` 설정 오류 시 DEFAULTS 폴백 | `.claude/hooks/verify-branch.test.mjs:185-190` | ✅ covered | — |
| 훅 소스에 PROTECTED Set 하드코딩 없음 | `.claude/hooks/verify-branch.test.mjs:195-201` | ✅ covered | — |
| 훅 e2e: config.baseBranch 에서 보호 브랜치 결정 | `.claude/hooks/verify-branch.test.mjs:391-397` | ✅ covered | — |
| 훅 e2e: dev/master 보호 해제 (회귀) | `.claude/hooks/verify-branch.test.mjs:410-418` | ✅ covered | — |
| 훅 e2e: protectedBranches 로 추가 보호 가능 | `.claude/hooks/verify-branch.test.mjs:420-428` | ✅ covered | — |
| 훅 판정 순서: 보호 브랜치가 미등록보다 먼저 | `.claude/hooks/verify-branch.test.mjs:401-407` | ✅ covered | — |
| `baseMismatchWarning` 함수 존재 및 불일치 감지 | `scripts/worktree-add.test.mjs:47-52` | ✅ covered | — |
| `baseMismatchWarning` --from 지정 시 경고 없음 | `scripts/worktree-add.test.mjs:59-61` | ✅ covered | — |
| `baseMismatchWarning` 일치 시 경고 없음 | `scripts/worktree-add.test.mjs:54-56` | ✅ covered | — |
| `baseMismatchWarning` attach 경로 제외 | `scripts/worktree-add.test.mjs:64-66` | ✅ covered | — |
| `baseMismatchWarning` 판별 실패/detached 제외 | `scripts/worktree-add.test.mjs:69-73` | ✅ covered | — |
| `baseMismatchWarning` 순수 함수 (throw 없음) | `scripts/worktree-add.test.mjs:75-84` | ✅ covered | — |
| 불일치 경고가 비차단 (exit 0) | `scripts/worktree-add.test.mjs:75-84` 로직 및 코드 검증 | △ partial | 코드 리뷰 필요 |
| README 에 `--from` 과 merge-base 기준선 관계 명시 | 문서 검증 (테스트 대상 아님) | △ partial | README 확인 필요 |
| README 열린 구멍 표 갱신 (#1/#2/#7) | 문서 검증 (테스트 대상 아님) | △ partial | README 확인 필요 |
| `harness/pipeline-review.md` 논점 H 결정 기록 | 문서 검증 (테스트 대상 아님) | △ partial | pipeline-review 확인 필요 |

## 분석 및 주석

### 완전 커버리지 항목 (✅ covered)
- 기능 1 (`loadConfig` baseBranch 검증) 과 기능 2 (`loadConfig` protectedBranches 검증): `scripts/gate.test.mjs` 에서 모든 인수기준을 단위 테스트로 검증
- 기능 2 (`resolveProtectedBranches` 함수): `.claude/hooks/verify-branch.test.mjs` 에서 순수 함수 단위 테스트 + e2e 훅 테스트로 완전 검증
- 기능 3 (`baseMismatchWarning` 함수): `scripts/worktree-add.test.mjs` 에서 모든 입력 조합과 엣지 케이스를 순수 함수로 검증

### 부분 커버리지 항목 (△ partial)
- **불일치 경고가 비차단** (`exit 0`): `baseMismatchWarning` 함수 자체는 순수(throw 없음) 검증됐으나, `main()` 에서 실제로 경고를 `console.warn` 출력하고 `process.exit` 분기를 건너뛰는지는 **정적 코드 검토 대상** (e2e git 프로세스를 스폰하는 테스트 없음 — spec 주의 절 라인 71 에서 "실제 git 프로세스를 스폰하는 e2e 테스트는 기존 관례에 없으므로 강제하지 않는다" 명시)
- **문서 갱신** (기능 4): 테스트 대상이 아닌 문서 콘텐츠 검증. `README.md` 와 `harness/pipeline-review.md` 를 사람이 직접 확인해야 함.
  - `--from` 과 merge-base 관계 설명
  - 열린 구멍 표 (#1/#2/#7) 해결 상태
  - 논점 H 결정 기록 및 QA 모델 미결 명시

### 테스트 러너 확인
`harness/config.json` 의 `gate.test` 항목 있음 → vitest 기반 테스트 실행 가능. 테스트 파일 패턴: `**/*.test.{ts,tsx,js,mjs}`

### 테스트 파일 위치
- `scripts/gate.test.mjs` — gate.mjs 의 `loadConfig`, `resolveCommand`, `planGate` 등 순수 함수
- `.claude/hooks/verify-branch.test.mjs` — verify-branch.mjs 의 `resolveProtectedBranches`, `resolveMetaPaths` 등 및 훅 e2e
- `scripts/worktree-add.test.mjs` — worktree-add.mjs 의 `baseMismatchWarning`, `baseForNewBranch` 등

모든 기능이 단위 테스트(순수 함수)로 검증되며, 기능 2 는 추가로 e2e 훅 테스트로 판정 순서까지 검증됨. 기능 4 는 코드가 아닌 문서라 테스트 불필요.

## 결론

- **코드 기능 (1~3)**: 완전 검증 ✅
- **문서 기능 (4)**: 수동 검증 필요 (사람 판단)
- **최종 상태**: 게이트 통과 및 QA 커버리지 확보, 문서는 PR 리뷰 시 확인

---
input_hash: 2b05e20aa04ca0672cee959a17915b58b3e4e58cee55f6b035b2224fd0b681bc
generated: 2026-07-10
spec: harness/token-usage/spec.md
---

# QA 기능 체크리스트 — token-usage

## 기능 체크리스트 (기획 의도로부터 독립 도출)

### 기존 기능 (회귀)
- JSONL 한 줄에서 assistant 메시지의 usage 레코드 추출 (type/message.usage/message.id 필터)
- 역할 분류 (main vs subagent) — 경로 /subagents/ 확인 및 isSidechain 플래그
- cache_creation 분해 (ephemeral_5m/1h 있으면 분리, 없으면 5m 취급)
- 모델별 단가표 관리 및 접두 매칭 (버전 붙은 모델명 처리)
- 4종 토큰 가중 비용 계산 (input/output × 단가, cache_read × 0.1, cache_write × 1.25 또는 2.0)
- message.id 기반 중복 제거(dedup) — 전체 프로젝트 범위
- task별 리포트 + 역할(main/subagent) 서브행 출력
- --by 플래그로 집계 축 변경 (task/role/model/session)
- TOTAL 행 출력 및 정확성 (모든 축에서 합계 동일)
- --json 모드 및 타임스탬프 필터 (--since/--until)

### 리비전 기능 (2026-07-10)
- 메인 저장소 루트 도출 (git rev-parse --git-common-dir → dirname, 폴백 --show-toplevel)
- worktree-safe 근본 원인 —  worktree에서 실행해도 메인 루트로부터 모든 slug 후보 수집
- 메인 slug + worktree sibling slug 필터 (prefix <mainSlug>- 규칙)
- 메인 + 모든 worktree 크로스-집계 (기본 동작, --main-only로 메인만, --dir로 명시 경로만)
- 모든 디렉터리 범위에서 message.id dedup 유지 (충돌 불가)
- 디렉터리 부재 시 명확한 에러 메시지 + exit 0 (조용한 처리)
- --main-only 플래그 작동 확인
- --dir 플래그 오버라이드 확인
- candidateSlugDirs 순수 함수 — 메인 slug 및 <mainSlug>-* 패턴만 필터
- session-cost.mjs 주석 정확성 — 로그 위치를 ~/.claude/projects/<cwd-slug>/session-costs.log로 명확히 표기 (저장소 디렉터리 아님)

### session-cost.mjs (세션 종료 훅)
- SessionEnd 페이로드에서 transcript_path 추출 (없으면 session_id+cwd로 유도)
- 세션의 메인 트랜스크립트만 읽기 (~/../<slug>/<session_id>.jsonl)
- 서브에이전트 파일 병렬 수집 (<session_id>/subagents/*.jsonl)
- 이 세션만의 토큰/비용 집계 (전체 프로젝트 아님)
- systemMessage 및 session-costs.log 기록 (한 줄 append)
- 세션 종료 차단 금지 (어떤 실패도 exit 0)
- parseUsageLine/aggregate 함수 재사용 (단일 소스)
- main/subagent 역할 분리 요약

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| JSONL 한 줄 → assistant usage 레코드 추출 | (없음) | ❌ 누락(테스트 없음) | 순수 함수 parseUsageLine 구현 확인(`scripts/token-usage.mjs:57-88`), node --check 구문 통과, 실제 트랜스크립트 실행으로 검증 권장 |
| 역할 분류 (main vs subagent) | (없음) | ❌ 누락 | 경로 필터(`filePath.includes("/subagents/")`)와 isSidechain 플래그 구현 확인 |
| cache_creation 분해(ephemeral 5m/1h) | (없음) | ❌ 누락 | 구현 확인(`scripts/token-usage.mjs:70-72`), 실제 캐시 구분 트랜스크립트로 검증 |
| 모델별 단가표 관리 및 접두 매칭 | (없음) | ❌ 누락 | PRICING 상수 + priceFor 접두 매칭 구현 확인(`:31-38`) |
| 4종 토큰 가중 비용 계산 | (없음) | ❌ 누락 | costOf 함수 구현 확인(`:41-50`), opus-4.8/haiku 등 모델별 단가·배수 정확도 확인 필요 |
| message.id dedup (프로젝트 범위) | (없음) | ❌ 누락 | `seen` Set으로 전 디렉터리 공유 dedup 구현 확인(`:295,308,311`) |
| task별 리포트 + 역할 서브행 | (없음) | ❌ 누락 | printReport 및 내부 role 서브그룹 로직 구현 확인(`:212-245`) |
| --by 축 변경 (task/role/model/session) | (없음) | ❌ 누락 | keyOf 객체 + parseArgs 구현 확인(`:194-199,176-192`) |
| TOTAL 행 + 정확성 (모든 축 합계 동일) | (없음) | ❌ 누락 | aggregate 함수 누적 로직 + printReport TOTAL 구현 확인(`:239-241`), 여러 축(task/model/role)으로 실행 시 TOTAL 일치 확인 |
| --json 모드 및 타임스탬프 필터 | (없음) | ❌ 누락 | JSON 출력 로직(`:323-335`) 및 sinceMs/untilMs 필터(`:293-310`) 구현 확인 |
| 메인 저장소 루트 도출 (git common-dir) | (없음) | ❌ 누락 | mainRepoRoot 함수 구현 확인(`:125-143`), git --path-format + dirname 및 --show-toplevel 폴백 |
| worktree-safe —  메인 루트 도출 및 전 slug 수집 | (없음) | ❌ 누락 | mainRepoRoot 호출 + candidateSlugDirs 로직(`:262-284`), worktree 에서 실행 시 메인 루트 기준 결과 확인 |
| candidateSlugDirs 순수 함수 정확성 | (없음) | ❌ 누락 | 구현 확인(`:147-150`), 메인 slug + prefix <mainSlug>- 만 반환, 무관 디렉터리 제외(어서션: `["myrepo", "myrepo-task1", "myrepo-task2", "other-dir"]` → `["myrepo", "myrepo-task1", "myrepo-task2"]`) |
| --main-only 플래그 작동 (메인 slug만) | (없음) | ❌ 누락 | opt.mainOnly 플래그 처리(`:185,270-271`) 구현 확인, --main-only 실행 시 메인만 집계 |
| --dir 플래그 오버라이드 (명시 경로만) | (없음) | ❌ 누락 | opt.dir 처리(`:182,259-260`) 구현 확인, --dir 실행 시 그 경로만 집계 |
| 메인 + 모든 worktree 크로스-집계 (기본) | (없음) | ❌ 누락 | candidateSlugDirs 후보 → walkJsonl 재귀 → dedup 전 디렉터리 공유(`:276-314`), 메인 + 모든 worktree slug 포함 최종 TOTAL 확인 |
| 디렉터리 부재 시 명확한 에러 메시지 | (없음) | ❌ 누락 | existingDirs 필터 + 에러 메시지(`:287-290`) 구현 확인 |
| node --check 구문 검사 통과 | (없음) | ❌ 누락 | 실행 `node --check scripts/token-usage.mjs` → 0 |
| session-cost.mjs 주석 정확성 — 로그 위치 | (없음) | ❌ 누락 | 주석 확인(`:.claude/hooks/session-cost.mjs:4-5`), ~/.claude/projects/<cwd-slug>/session-costs.log 명확히 표기(저장소 dir 아님) |
| SessionEnd → transcript_path/session_id 추출 | (없음) | ❌ 누락 | currentSessionFiles 함수 구현 확인(`.claude/hooks/session-cost.mjs:15-35`) |
| 세션 메인 트랜스크립트 + 서브에이전트 파일 수집 | (없음) | ❌ 누락 | 경로 조합 + subdir 재귀 구현 확인(`:15-35,26-30`) |
| 세션 단위 집계 (전체 프로젝트 아님) | (없음) | ❌ 누락 | currentSessionFiles로 그 세션 파일만 필터 후 collect → aggregate 구현 확인 |
| systemMessage + session-costs.log 기록 | (없음) | ❌ 누락 | appendFileSync + JSON 표시 구현 확인(`:87-97`) |
| 세션 종료 차단 금지 (exit 0 보증) | (없음) | ❌ 누락 | 모든 catch에서 process.exit(0) 구현 확인(`:63,67,70,93,98`) |
| parseUsageLine/aggregate 함수 재사용 | (없음) | ❌ 누락 | import 문 + 호출 확인(`.claude/hooks/session-cost.mjs:12,49,72-73`) |
| main/subagent 역할 분리 요약 출력 | (없음) | ❌ 누락 | byRole aggregate + 출력 구현 확인(`:73-82`) |

---

## 검증 수단 요약

**테스트 러너 부재 (정상)**
- spec 명시: 루트 스크립트로 테스트 러너가 없음 → 자동화 테스트는 러너 도입 전까지 보류
- 커버리지는 모두 `❌ 누락(테스트 없음)` 표기

**대체 검증 수단**
1. **구문 검사**: `node --check scripts/token-usage.mjs` + `node --check .claude/hooks/session-cost.mjs`
2. **순수 함수 어서션**: parseUsageLine, costOf, aggregate, candidateSlugDirs 로직 수동 검증
3. **실제 트랜스크립트 실행**:
   - 인자 없이: 메인 + worktree slug 합산 결과 확인
   - `--main-only`: 메인 slug 한 곳만 확인
   - `--dir <path>`: 명시 경로 확인
   - `--by model`/`--by role` 축 변경 후 TOTAL 일치 확인
   - 메인과 worktree에서 각각 실행 → 결과 동일 여부
4. **코드 리뷰**: 위 매트릭스의 "구현 확인" 항목에 파일·줄 수 기재

---

## 상태 요약

**기존 기능 (회귀)**
- 10개 항목: 모두 ❌ 누락(테스트 없음)
- 구현 존재 확인: token-usage.mjs에서 parseUsageLine, priceFor, costOf, aggregate, printReport, parseArgs 등 모두 구현

**리비전 기능 (신규)**
- 크로스-worktree 집계 (8개 항목): 모두 ❌ 누락
  - mainRepoRoot, candidateSlugDirs 순수 함수 구현
  - CLI --main-only, --dir 플래그 구현
  - 기본 동작 메인+worktree 합산 구현
  - dedup 전 디렉터리 공유 구현

- session-cost.mjs 로그 위치 주석 (1개 항목): ❌ 누락
  - 주석은 이미 정확하게 표기됨 (저장소 디렉터리 아님, <cwd-slug> 기준)

**session-cost.mjs 훅 (6개 항목)**
- 모두 ❌ 누락(테스트 없음)
- 구현 존재 확인: currentSessionFiles, collect, main 로직 + 에러 핸들링 모두 구현

**총 25개 기능 항목**: 모두 ❌ 누락(테스트 없음) — 테스트 러너 도입 전까지 정상 상태. 구현은 완료.

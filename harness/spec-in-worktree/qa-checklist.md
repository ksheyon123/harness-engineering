---
input_hash: 37220de8a87b7d7cf6a940a28a3c99ee964d32aae3506f01bf395a0b525d2b67
generated: 2026-08-06
spec: harness/spec-in-worktree/spec.md
---

# QA 기능 체크리스트 — spec-in-worktree

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- frontmatter 블록 범위 정확성 (`---`...`---` 안에서만 `branch:` 읽기, 본문의 일반 텍스트는 무시)
- frontmatter 파싱의 경계 처리 (공백 트리밍, CRLF, 닫는 마크 부재, 블록 부재)
- isRevisionAttempt 로직: 동일 브랜치의 spec 재작성 감지 → 커밋 차단
- spec-lock CLI의 SIGPIPE 방어 (아무것도 출력하지 않음)
- .githooks/pre-commit 통합: 검사 단계가 객관 게이트 이전에 위치
- pre-commit 최초 작성 시 자연스러운 통과 (HEAD에 파일 없음)
- worktree-add.mjs의 --from 파싱: 문법 & 값 토큰의 브랜치 오인 방지
- baseForNewBranch: 기준 브랜치 선택 (--from 우선, 없으면 configBaseBranch)
- attach 경로(중단 재개)에서 --from 무시 + 정보성 로그
- isTaskRegistered: 파싱 실패/파일 부재 시 false(미등록)로 기울어진 판단
- seedPromptFor의 2분기: 등록 상태별로 다른 seed 문구 생성
- seedPromptFor: spec.md 경로를 결과에 포함하지 않음
- warnLaunchContext 함수의 완전 제거 (정의 & 호출 양쪽)
- planner.md: frontmatter 형식 정확성 (`---\nbranch: <>\n---\n`)
- planner.md: 리비전 task 유도 규칙 (브랜치 끝의 `-<숫자>` 패턴 제거)
- planner.md: 리비전 모드 (기존 spec 검사 → 개정 → `## 개정 이력` 추가)
- planner.md: worktree에서 브랜치 판별 (`.git` 파일 읽기로 linked worktree 판별)
- CLAUDE.md: main 디스패처 역할 명시
- CLAUDE.md: spec 개정은 새 브랜치에서 (`--from`) 진행하는 지시
- CLAUDE.md: 커밋 입도("spec 1개당 1커밋") 문구 삭제
- CLAUDE.md: doc-before-code를 인수기준 변경으로 조건화
- CLAUDE.md: 리비전 브랜치 정리 규약 추가
- README.md: §2 플로우 다이어그램 순서 (worktree 생성 후 planner)
- README.md: 끊긴 BACKLOG.md 링크 제거 (마크다운 링크 문법)
- README.md: 잔여 작업 안내 문장 수정 (pipeline-review 참조)
- harness/config.json: harnessMetaPaths에서 BACKLOG.md 제거

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| frontmatterBranch: 블록 범위 정확성 | `spec-lock.test.mjs:22-48` | ✅ covered | — |
| frontmatterBranch: 공백 트리밍 & CRLF | `spec-lock.test.mjs:26-34` | ✅ covered | — |
| frontmatterBranch: 경계 조건 (부재, 닫는 마크 없음, 블록 밖) | `spec-lock.test.mjs:36-56` | ✅ covered | — |
| isRevisionAttempt: 동일 브랜치 감지 | `spec-lock.test.mjs:67-77` | ✅ covered | — |
| spec-lock CLI: 종료코드 (1/0) | `spec-lock.test.mjs:83-92` | ✅ covered | — |
| spec-lock CLI: 출력 무음 & SIGPIPE 방어 | `spec-lock.test.mjs:97-101` | ✅ covered | — |
| .githooks/pre-commit: 순수 함수 검증 (CLI) | `spec-lock.test.mjs` 전체 | ✅ covered | — |
| .githooks/pre-commit: 훅 통합 & 단계 위치 | (코드 리뷰) | △ partial (단위만 자동, 훅 end-to-end는 범위 밖) | 수동 확인 완료 (사후 보고) |
| --from 파싱: `--from <값>` / `--from=<값>` | `worktree-add.test.mjs:248-258` | ✅ covered | — |
| --from 파싱: 값 토큰의 브랜치 오인 방지 | `worktree-add.test.mjs:262-267` | ✅ covered | — |
| --from + --seed 동시 사용 | `worktree-add.test.mjs:269-275` | ✅ covered | — |
| baseForNewBranch: --from 우선 | `worktree-add.test.mjs:31-33` | ✅ covered | — |
| baseForNewBranch: 기본값 (configBaseBranch) | `worktree-add.test.mjs:35-37` | ✅ covered | — |
| attach 시 --from 무시 | (코드 리뷰 필요) | △ partial (parseArgs만 테스트, attach 로직은 부수효과) | 코드 리뷰 |
| attach 시 정보성 로그 | (코드 리뷰 필요) | △ partial (부수효과, 자동 테스트 범위 밖) | 코드 리뷰 |
| isTaskRegistered: 등록 여부 판정 | `worktree-add.test.mjs:41-51` | ✅ covered | — |
| isTaskRegistered: 파싱 실패/부재 시 false | `worktree-add.test.mjs:55-65` | ✅ covered | — |
| seedPromptFor: 등록 상태별 분기 | `worktree-add.test.mjs:295-308` | ✅ covered | — |
| seedPromptFor: 기획(미등록) 지시 | `worktree-add.test.mjs:300-302` | ✅ covered | — |
| seedPromptFor: 구현(등록) 지시 | `worktree-add.test.mjs:304-308` | ✅ covered | — |
| seedPromptFor: spec.md 경로 미포함 | `worktree-add.test.mjs:284-289` | ✅ covered | — |
| warnLaunchContext: 함수 정의 제거 | `worktree-add.test.mjs:320-322` | ✅ covered | — |
| warnLaunchContext: 호출 제거 | `worktree-add.test.mjs:320-322` | ✅ covered | — |
| planner.md: frontmatter 형식 | (문서 검토), 형식은 `spec-lock.test.mjs:22-24` 간접 검증 | △ partial (문서 프롬프트, 형식 테스트는 간접) | 문서 검토 + 실제 planner 스폰 관찰 |
| planner.md: 리비전 task 유도 규칙 | (문서 검토) | △ partial (LLM 프롬프트) | 문서 검토 + 실제 스폰 관찰 |
| planner.md: 기존 spec 검사 → 개정 → 이력 추가 | (문서 검토) | △ partial (LLM 프롬프트) | 문서 검토 + 실제 스폰 관찰 |
| planner.md: worktree 브랜치 판별 알고리즘 | (문서 검토) | △ partial (Read 도구만, git 명령 불가) | 문서 검토 + 실제 스폰 관찰 |
| CLAUDE.md: main 디스패처 명시 | (문서 검토) | △ partial (정보 구조, 자동 테스트 불가) | 문서 검토 |
| CLAUDE.md: spec 개정 새 브랜치 지시 | (문서 검토) | △ partial (정보 구조, 자동 테스트 불가) | 문서 검토 |
| CLAUDE.md: 커밋 입도 문구 삭제 | `hooks-registration.test.mjs:100-104` | ✅ covered | — |
| CLAUDE.md: doc-before-code 조건화 | (문서 검토) | △ partial (정보 구조, 자동 테스트 불가) | 문서 검토 |
| CLAUDE.md: 리비전 정리 규약 추가 | (문서 검토) | △ partial (정보 구조, 자동 테스트 불가) | 문서 검토 |
| README.md: BACKLOG.md 링크 제거 | `hooks-registration.test.mjs:87-89` | ✅ covered | — |
| README.md: harnessMetaPaths에서 BACKLOG.md 제거 | `hooks-registration.test.mjs:91-93` | ✅ covered | — |
| README.md: §2 플로우 다이어그램 순서 | (문서 검토) | △ partial (텍스트 아트, 자동 단언 취약) | 문서 검토 (worktree가 planner 이전) |
| README.md: 잔여 작업 안내 문장 | (문서 검토) | △ partial (정보 구조, 자동 테스트 불가) | 문서 검토 |

## 주요 관찰

### 자동 테스트의 강점
- **순수 함수 분리**: `spec-lock.mjs`의 `frontmatterBranch`·`isRevisionAttempt`, `worktree-add.mjs`의 `baseForNewBranch`·`isTaskRegistered`·`seedPromptFor` 등이 git/fs 의존성 없이 unit 테스트 가능
- **비대칭적 오판 설계**: `isTaskRegistered`가 파싱 실패 시 false로 기우는 의도가 코드 주석으로 명시되고, 테스트(`lines 55-65`)에서 그 의도를 검증
- **CLI 격리**: pre-commit 훅의 로직을 순수 함수 + 서브프로세스 호출로 분리하여 vitest 재귀 위험 회피

### 자동 테스트의 한계
1. **`.githooks/pre-commit` end-to-end**: vitest 안에서 실제 훅을 실행하면 `npx vitest run` 재귀 스폰 위험. 단위 테스트(spec-lock CLI)로만 커버. 사람이 수동 1회 확인 완료.
2. **planner.md의 3개 기능**: LLM 프롬프트이므로 vitest로 검증 불가. frontmatter 형식 정확성은 `spec-lock.test.mjs:22-24`가 간접 검증.
3. **CLAUDE.md·README.md**: 문서의 정보 아키텍처(구조, 명사 일관성, 다이어그램 순서)는 자동 테스트 불가. 문자열 부재/존재(`grep` 형 단언)만 자동화.

### 개발자 수동 검증 (사후 보고된 사실)
1. `.githooks/pre-commit`의 셸 end-to-end: 실제 spec 파일 스테이징 후 `sh .githooks/pre-commit`을 같은 브랜치에서 재실행해 exit 1 차단 확인 ✓
2. `verify-branch.test.mjs`는 실제 `harness/config.json`을 읽는 단언이 존재 (기존 "읽지 않는다" 문서 오류를 감지 후 개발자가 테스트 갱신) ✓

## 종합 평가

**자동 테스트 커버리지**: 9개 기능이 ✅ covered, 나머지는 △ partial (LLM 프롬프트, 문서 구조, end-to-end 훅)

**△ partial인 항목의 보완 근거**:
- **planner.md 3개**: LLM의 지시 따름 능력에 의존하므로 형식 테스트(spec-lock)와 실제 스폰 관찰로 검증
- **CLAUDE.md 4개 항목** (디스패처, 새 브랜치, doc-before-code, 정리): 문서 내용이 설계 의도와 일치하는지 사람 검토 필요
- **README.md 2개** (플로우, 잔여 작업): 텍스트 아트 다이어그램은 정규식 단언 취약 → 문서 검토
- **attach & 정보성 로그**: 부수효과이므로 코드 리뷰 확인

**누락 항목**: 없음. 모든 기능이 테스트 또는 문서 검토로 추적됨.

---

**생성일**: 2026-08-06  
**spec**: `harness/spec-in-worktree/spec.md`

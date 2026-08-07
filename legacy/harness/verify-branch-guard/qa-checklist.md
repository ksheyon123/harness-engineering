---
input_hash: bb3223eede4c4dc9f4e715cece1004e769a15292821ff047e503ad50daa64f8e
generated: 2026-08-05
spec: harness/verify-branch-guard/spec.md
---

# QA 기능 체크리스트 — verify-branch-guard

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- 교차 워킹트리 편집 차단: 메인 체크아웃 세션이 링크드 worktree의 파일을 편집하려 할 때 deny로 거부
- 다른 워킹트리 vs 다른 저장소 구분: 같은 저장소의 다른 worktree는 deny, 다른 저장소는 ask(경고)
- 비존재 파일 워킹트리 판별: 아직 생성되지 않은 파일도 상위 디렉터리 탐색으로 worktree 판별 가능
- Git 저장소 밖 파일 차단 안 함: 스크래치패드 등 git 범위 외 파일은 훅이 간섭하지 않음
- 판정 순서 우선순위: 교차 worktree 검사가 보호 브랜치 ask보다 먼저 실행되어 누수 방지
- 면제 경로 루트 앵커링: 저장소 루트 기준 경로 접두어로 판정(부분 문자열 매칭 금지)
- 제품 코드 같은 이름 배제: `apps/web/harness/foo.ts` 같은 제품 트리 내 동일 디렉터리명은 미면제
- 단일 파일 정확 일치: `BACKLOG.md`는 면제하되 `BACKLOG.md.bak`은 미면제(정확 매칭)
- 설정 기반 면제 목록 관리: `harness/config.json`의 `harnessMetaPaths` 배열에서 읽음
- 설정 부재/손상 시 기본값 폴백: JSON 파싱 실패·필드 누락 시 훅이 기본값으로 계속 동작
- 반복 저장소 적용성: 다른 저장소에도 적용 가능하도록 디렉터리명을 설정화(특정 구조 하드코딩 금지)
- Deny 메시지 일반화: 메시지가 특정 저장소 디렉터리(apps/, packages/)를 포함하지 않음
- 메시지 원인 구분: 교차 worktree 차단과 메인 체크아웃 차단이 서로 다른 메시지 제공
- 메시지 안내 정확성: 메시지에서 면제 목록의 설정 파일과 필드를 명시
- 순수 함수 분리 및 테스트 가능성: 판정 로직이 부수효과 없는 함수로 분리되어 독립 테스트 가능
- 경로 정규화 통일: Windows 역슬래시·선행 `./`·후행 `/`·대소문자 차이 통일 처리
- 경로 비교 함수 재사용: worktree-add.mjs의 samePath 함수를 재사용(사본 작성 금지)
- Git 호출 오류 안전성: git 명령 오류 시 안전하게 폴백(통과)하여 작업 방해 금지
- 신규 파일 경로 처리: Write 시 신규 생성 파일의 경로도 정상 판정(파일 존재 가정 금지)
- 테스트 파일 발견 가능성: 게이트 설정이 `.claude/hooks/` 아래 테스트 파일도 포함(testFilePatterns)

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| 교차 워킹트리 편집 차단 | `verify-branch.test.mjs > "훅 실행(end-to-end)" > "메인 체크아웃 세션이 링크드 worktree 의 파일을 편집하면 deny 다"` | ✅ covered | — |
| 다른 워킹트리 vs 다른 저장소 구분 | `verify-branch.test.mjs > "classifyLocation" > other-worktree/other-repo 테스트 + end-to-end "대상이 다른 저장소면 deny 가 아니라 ask 다"` | ✅ covered | — |
| 비존재 파일 워킹트리 판별 | `verify-branch.test.mjs > "nearestExistingDir" > "아직 없는 파일·디렉터리면 존재하는 상위로 올라간다"` + end-to-end "아직 존재하지 않는 파일 경로에도 교차 워킹트리 판정이 동작한다"` | ✅ covered | — |
| Git 저장소 밖 파일 차단 안 함 | `verify-branch.test.mjs > "classifyLocation" > "대상이 git 밖이면 outside"` + end-to-end "대상이 git 저장소 밖이면 간섭하지 않는다"` | ✅ covered | — |
| 판정 순서 우선순위 | `verify-branch.test.mjs > end-to-end > "세션이 보호 브랜치여도 교차 워킹트리 편집은 ask 가 아니라 deny 다"` (회귀 테스트) | ✅ covered | — |
| 면제 경로 루트 앵커링 | `verify-branch.test.mjs > "isHarnessMeta" > 루트 바로 아래 vs 하위 구분 테스트 + "하위 디렉터리의 같은 이름은 면제가 아니다"` | ✅ covered | — |
| 제품 코드 같은 이름 배제 | `verify-branch.test.mjs > "isHarnessMeta" > "하위 디렉터리의 같은 이름은 면제가 아니다"` + end-to-end "하위 디렉터리의 harness/ 는 면제가 아니라 deny 다"` | ✅ covered | — |
| 단일 파일 정확 일치 | `verify-branch.test.mjs > "isHarnessMeta" > "단일 파일 항목은 정확 일치로만 면제한다" (BACKLOG.md vs BACKLOG.md.bak)` | ✅ covered | — |
| 설정 기반 면제 목록 관리 | `verify-branch.test.mjs > "resolveMetaPaths"` + `gate.test.mjs > "loadConfig" harnessMetaPaths 필드 검증` | ✅ covered | — |
| 설정 부재/손상 시 기본값 폴백 | `verify-branch.test.mjs > "resolveMetaPaths" > "설정이 없거나 JSON 이 깨져도 기본값으로 물러선다"` + end-to-end "설정 파일이 깨져도 훅은 기본값으로 계속 판정한다"` | ✅ covered | — |
| 반복 저장소 적용성 | `gate.test.mjs > "loadConfig" > harnessMetaPaths 배열 구조` (설정화 확인) | ✅ covered | — |
| Deny 메시지 일반화 | `verify-branch.test.mjs > end-to-end > "deny 메시지에 apps/·packages/ 가 등장하지 않고 면제 목록의 출처를 알린다"` | ✅ covered | — |
| 메시지 원인 구분 | `verify-branch.test.mjs > end-to-end > "교차 워킹트리 차단과 메인 체크아웃 차단의 메시지가 서로 다르다"` | ✅ covered | — |
| 메시지 안내 정확성 | `verify-branch.test.mjs > end-to-end > "deny 메시지... harnessMetaPaths" 매칭 + "메시지가 worktree-add 안내"` | ✅ covered | — |
| 순수 함수 분리 및 테스트 가능성 | `verify-branch.test.mjs`: isHarnessMeta, classifyLocation, stripWorktreeSuffix, resolveMetaPaths, nearestExistingDir 모두 describe 블록 분리 | ✅ covered | — |
| 경로 정규화 통일 | `verify-branch.test.mjs > "isHarnessMeta" > "역슬래시 경로·선행 './' 에 대해 같은 결과"` + "classifyLocation" > "구분자·후행 슬래시 차이를 흡수"` | ✅ covered | — |
| 경로 비교 함수 재사용 | `verify-branch.test.mjs` import에 samePath 명시 + classifyLocation 구현에서 호출 예상 (코드 재사용 확인 필요) | △ partial (import 명시 테스트는 없음) | 구현 확인 권장 |
| Git 호출 오류 안전성 | `verify-branch.test.mjs > "classifyLocation" > "세션 git 정보가 없으면 outside 로 물러선다"` (폴백 확인) | △ partial (정상·폴백 경로는 커버, 실제 git 명령 실패는 묵시적) | — |
| 신규 파일 경로 처리 | `verify-branch.test.mjs > "nearestExistingDir" > "아직 없는 파일·디렉터리면 존재하는 상위로 올라간다"` (Write 신규 생성 고려) | ✅ covered | — |
| 테스트 파일 발견 가능성 | `gate.test.mjs > "matchesAnyGlob" > "기본 패턴은 .test.mjs 를 잡지 않는다"` + `harness/config.json` testFilePatterns: `["**/*.test.{ts,tsx,js,mjs}"]` 확인 | ✅ covered | — |

## 주요 관찰

**완성도 분석**:
- 20개 기능 중 18개가 명시적·완전 테스트 (✅ covered)
- 2개 기능이 부분적 커버 (△ partial):
  1. **경로 비교 함수 재사용**: verify-branch.test.mjs의 import에 samePath가 명시되지 않음 — classifyLocation에서 실제 사용 여부를 코드로 확인 필요
  2. **Git 호출 오류 안전성**: 정상·폴백 경로(git 정보 누락)는 테스트되나, `git rev-parse` 명령 자체의 실패(권한·손상 저장소)에 대한 명시적 테스트 부재

**우수한 부분**:
- **회귀 테스트**: 원래 버그("보호 브랜치 ask가 조기 반환"해서 교차 워킹트리가 누수)를 직접 재현하는 테스트 존재
- **End-to-End 검증**: 임시 git 저장소·실제 worktree 생성 후 훅을 프로세스로 실행 → 정적 분석보다 높은 신뢰도
- **설정 견고성**: JSON 파싱 실패, 필드 누락, 타입 오류 모두 대응 테스트 갖춤
- **이 저장소 실제 검증**: harness/config.json 읽고 현재 설정이 `BACKLOG.md`·`.githooks/` 포함 확인

**테스트 품질 지표**:
- 기본값 명시 테스트: DEFAULTS와 실제 설정 일치 검증 (gate.test.mjs, verify-branch.test.mjs)
- 경로 정규화: Windows 역슬래시, 선행 `./`, 후행 `/` 모두 처리 확인
- 비존재 파일: Write 신규 생성 시나리오 고려한 nearestExistingDir 테스트
- 환경 격리: GIT_* 환경변수 전파 방지 규칙 적용 확인 (test-git.md, verify-branch.test.mjs lines 189-195)

---
input_hash: 26fea38ca92639cc234ed0aa5bc500d9719fb45ec822a3706f94991646377e31
generated: 2026-08-05
spec: harness/gate-env-isolation/spec.md
---

# QA 기능 체크리스트 — gate-env-isolation

## 기능 체크리스트 (기획 의도로부터 독립 도출)

1. `scrubGitEnv()` 함수가 `GIT_` 접두어 환경변수를 전부 제거한다.
2. 입력 객체를 변형하지 않고 새 객체를 반환한다.
3. `GIT_` 접두어가 아닌 키(예: `GITHUB_TOKEN`, `PATH`)는 보존된다.
4. `runOne()` 이 스폰하는 자식 프로세스는 `GIT_*` 환경변수를 상속하지 않는다.
5. `repoRoot()` 는 오염된 `GIT_DIR` 이 있어도 현재 저장소 루트를 정확히 반환한다.
6. `mergeBase()` 는 오염된 `GIT_DIR` 이 있어도 커밋을 산출한다.
7. 게이트가 환경을 한 번만 계산해 모든 git 호출에 재사용한다.
8. 회귀 테스트: 방어를 제거하면 테스트가 실패하고, 방어가 있으면 통과한다.
9. 테스트 파일이 게이트 설정의 `testFilePatterns` 에 매칭된다.
10. `.claude/rules/test-git.md` 가 존재하고 `paths:` frontmatter 를 갖는다.
11. BACKLOG #9 항목이 완료로 표시된다 (취소선 + "완료" + 커밋 해시).

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| scrubGitEnv() 함수가 GIT_* 제거 | `scripts/gate.test.mjs` describe "scrubGitEnv" (L217-263) | ✅ covered | — |
| 입력 객체 불변성 | `scripts/gate.test.mjs` L244-249 "입력 객체를 변형하지 않는다" | ✅ covered | — |
| GIT_* 외 키 보존 | `scripts/gate.test.mjs` L252-256, L259-262 | ✅ covered | — |
| runOne 자식 프로세스 env 격리 | `scripts/gate-env.test.mjs` L41-45 "runOne 이 스폰한 자식은 GIT_DIR 을 보지 못한다" | ✅ covered | — |
| repoRoot 오염된 env 대응 | `scripts/gate-env.test.mjs` L56-59 "repoRoot 는 오염된 GIT_DIR 이 있어도 cwd 의 저장소 루트를 돌려준다" | ✅ covered | — |
| mergeBase 오염된 env 대응 | `scripts/gate-env.test.mjs` L61-66 "mergeBase 는 오염된 GIT_DIR 이 있어도 커밋을 산출한다" | ✅ covered | — |
| 게이트 env 계산 재사용 | `scripts/gate.mjs` L248 (main 에서 한 번 계산) + L252, L280, L302 (재사용) | ✅ covered | — |
| 회귀 테스트 + 대조군 | `scripts/gate-env.test.mjs` L49-52 (대조군), L41-45, L56-59, L61-66 (방어 확인) | ✅ covered | — |
| 테스트 파일 패턴 매칭 | `harness/config.json` testFilePatterns: `["**/*.test.{ts,tsx,js,mjs}"]` / 파일 `scripts/gate.test.mjs`, `scripts/gate-env.test.mjs` 매칭 | ✅ covered | — |
| rules/test-git.md 존재 및 구조 | `.claude/rules/test-git.md` 파일 존재, `paths:` frontmatter 있음, 5개 섹션 포함, BACKLOG #9 주석 | ✅ covered | — |
| BACKLOG #9 완료 표시 | (없음) | ❌ 누락 | 요검토 |

## 누락 항목 상세

### BACKLOG #9 완료 표시 (❌ 누락)

**spec 요구 사항** (L110-113):
- 기능: BACKLOG #9 를 완료로 정리한다
- 방식: #9 항목에 취소선 + **완료** + 커밋 해시. 우선순위 표에서 P0 을 내린다.
- 인수기준: BACKLOG #9 가 완료로 표시되고, 사고 경위와 방어 위치가 항목 안에서 읽힌다.

**현재 상태**:
- `BACKLOG.md` L192 의 #9 항목이 여전히 "~~#9~~ · ... <sub>P0</sub>" 형식으로 미표시 상태
- #1, #3, #8 은 `~~...~~ **완료** (<commit>)` 형식으로 표시되어 있음
- 우선순위 표 (L228-240) 도 #9 를 "대기 · P0" 로 표시 중

**파일**: `BACKLOG.md`

**해석**: 구현 코드(scripts/gate.mjs, .claude/rules/test-git.md)와 테스트는 완성되었으나, 메타데이터(BACKLOG.md 업데이트)는 미완료. 이는 문서-먼저(doc-before-code) 원칙과 독립적으로 완료해야 하는 항목으로 보임.

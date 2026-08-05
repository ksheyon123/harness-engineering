# harness-engineering

Claude Code hooks + git pre-push 훅으로 **역할 기반(기획자 / 개발자 / QA) 문서 주도 개발**을 자동화하는 하네스.

- **설계 의도가 코드보다 먼저 문서로 확립된다** — 기획자가 기능 목록(spec)을 먼저 쓴다.
- **각 역할은 서로 다른 agent이고, 도구 경계로 역할이 강제된다**.
- **AI는 차단·판정하지 않는다** — 브랜치에 산출물(기능 목록 / 코드 / 테스트 / QA 체크리스트)을 남기고 push할 뿐이다.
- **사람의 머지 결정이 유일한 권위 게이트다**.

설계 전문은 [`harness-engineering.md`](./harness-engineering.md) 참고.

## 구성

```
.claude/
  CLAUDE.md               # 개발자(메인 세션) 행동 규약
  agents/planner.md       # 기획자 — spec.md(기능 목록) 작성. src 편집 ❌
  agents/qa.md            # QA — 커버리지 매트릭스 작성. src 편집 ❌, 테스트 실행 ❌
  hooks/load-spec.mjs     # UserPromptSubmit — 현재 브랜치의 spec을 컨텍스트에 주입
  hooks/verify-branch.mjs # PreToolUse — 보호 브랜치 / worktree 게이트
  hooks/index-sync.mjs    # PostToolUse — 코드↔문서 동기화 알림
  hooks/qa-hash.mjs       # QA 입력 해시 (재생성 무한루프 차단)
  hooks/session-cost.mjs  # SessionEnd — 세션 토큰/비용 요약
  settings.json           # 훅 등록 + 권한 경계
.githooks/pre-push        # 1층 객관 게이트(tsc+test) + 2층 headless QA
scripts/
  setup-githooks.mjs      # core.hooksPath 자동 활성화 (npm install 시)
  worktree-add.mjs        # 브랜치별 worktree 생성 + 세션 자동 기동
  token-usage.mjs         # 토큰/비용 집계
harness/
  index.json              # 브랜치 → spec 경로 매핑
  <task>/spec.md          # 기획자 산출물 — 기능 목록
  <task>/qa-checklist.md  # QA 산출물 — 커버리지 매트릭스
```

## 도입

```sh
npm install   # prepare 훅이 core.hooksPath 를 .githooks 로 설정한다
```

외부 의존성은 없다(node 빌트인만 사용). `npm install`은 사실상 git 훅 활성화용이다.

이후 기획자(`planner`)로 첫 태스크의 `harness/<task>/spec.md`를 쓰고, `harness/index.json`의 `tasks`에 `"<branch>": "harness/<task>/spec.md"`를 등록한다.

## 포함된 spec

`harness/`의 3개는 **하네스 자신을 만든 작업의 실제 spec**이다. 형식 예시이자 설계 근거로 남겨둔다.

| task | 내용 |
|---|---|
| `worktree-workflow` | 브랜치별 worktree 분리 규약 + `worktree-add.mjs` |
| `worktree-enforce` | task 시작을 worktree 우선으로 강제 (`verify-branch.mjs`) |
| `token-usage` | 세션 토큰/비용 사후 집계 (`token-usage.mjs`) |

## 알려진 제약

이 저장소는 Turborepo 기반 프로젝트에서 하네스 부분만 분리한 것이라, 아직 그 프로젝트 구조에 결합된 지점이 남아 있다. 다른 프로젝트에 적용하려면 아래를 손봐야 한다.

| 위치 | 결합 내용 |
|---|---|
| `.githooks/pre-push` | 게이트 대상이 `apps/web`·`packages/ui` 로 하드코딩(`TSC_DIRS`/`TEST_DIR`). 없으면 건너뛰므로 push 는 막히지 않지만, 그만큼 **객관 게이트가 무력화**된다 |
| `scripts/worktree-add.mjs` | base 브랜치가 `dev` 로 고정 |
| `.claude/hooks/qa-hash.mjs` | 테스트 파일 패턴이 `*.test.ts(x)` 로 고정 |
| `.claude/CLAUDE.md` | 하네스 프로토콜과 프로젝트별 코딩 규약(FSD·API 표기·카피 상수화)이 한 파일에 혼재 |

또한 `.claude/hooks/index-sync.mjs` 는 `harness/index.json` 의 `components` 매핑을 읽는데, 현재 매핑이 비어 있어 아무 동작도 하지 않는다.

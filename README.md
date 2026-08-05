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
  CLAUDE.md               # 하네스 코어 규약 (역할·게이트·커밋/push·worktree)
  rules/                  # 프로젝트별 코딩 규약 — paths: 로 조건부 로드
  agents/planner.md       # 기획자 — spec.md(기능 목록) 작성. src 편집 ❌
  agents/qa.md            # QA — 커버리지 매트릭스 작성. src 편집 ❌, 테스트 실행 ❌
  hooks/load-spec.mjs     # UserPromptSubmit — 현재 브랜치의 spec을 컨텍스트에 주입
  hooks/verify-branch.mjs # PreToolUse — 보호 브랜치 / worktree 게이트
  hooks/qa-hash.mjs       # QA 입력 해시 (재생성 무한루프 차단)
  hooks/session-cost.mjs  # SessionEnd — 세션 토큰/비용 요약
  settings.json           # 훅 등록 + 권한 경계
.githooks/
  pre-commit              # 1층 객관 게이트 — 실패하면 커밋 자체가 안 만들어진다
  pre-push                # 게이트(조건부 재실행) + 2층 headless QA
scripts/
  gate.mjs                # 1층 객관 게이트의 유일한 실행 진입점
  setup-githooks.mjs      # core.hooksPath 자동 활성화 (npm install 시)
  worktree-add.mjs        # 브랜치별 worktree 생성 + 세션 자동 기동
  token-usage.mjs         # 토큰/비용 집계
harness/
  config.json             # 게이트 대상의 단일 출처 (+ baseBranch, installCommand, testFilePatterns)
  index.json              # 브랜치 → spec 경로 매핑
  <task>/spec.md          # 기획자 산출물 — 기능 목록
  <task>/qa-checklist.md  # QA 산출물 — 커버리지 매트릭스
```

## 게이트

1층 객관 게이트는 **정의가 한 곳(`harness/config.json`), 실행이 한 곳(`scripts/gate.mjs`)** 이다. 훅도 세션도 그 스크립트를 부른다.

```
git commit ─[pre-commit]─ 부분 스테이징 거부 → gate.mjs → 통과한 트리 해시를 기록
                          실패 → 커밋 중단 (워킹트리 보존, 히스토리 무손상)
git push   ─[pre-push]──  HEAD 트리 == 기록된 트리?  같으면 게이트 생략
                          다르면(rebase·머지·--no-verify) gate.mjs 재실행
                          + QA 입력 해시 비교 → 재생성 → 미커밋 차단
```

게이트를 커밋 앞에 두는 이유: 없으면 `git commit` 은 무조건 성공하고 실패는 push 시점에야 드러난다. 그때는 이미 깨진 커밋이 히스토리에 남아 `--amend` 가 필요하고, 수정이 테스트/spec 에 닿으면 QA 입력 해시가 바뀌어 push 시도가 3회까지 늘어난다.

pre-push 의 게이트를 없애지 않는 이유: `rebase`·자동 머지는 `pre-commit` 을 실행하지 않는다. 각각은 통과하지만 합치면 깨지는 조합(semantic conflict)은 커밋 시점에 존재하지 않아 `pre-commit` 이 원리적으로 잡을 수 없다.

## 도입

```sh
npm install   # prepare 훅이 core.hooksPath 를 .githooks 로 설정한다
```

의존성은 `vitest` 하나뿐이다(하네스 자신의 테스트용). `npm install` 은 그 설치와 git 훅 활성화를 겸한다.

도입 프로젝트가 채워야 하는 것:

1. **`harness/config.json`** — 게이트 대상. 이게 1층 객관 게이트의 **유일한** 정의다.

   ```json
   {
     "baseBranch": "dev",
     "installCommand": "npm install",
     "testFilePatterns": ["**/*.test.{ts,tsx}"],
     "gate": {
       "typecheck": [{ "dir": "apps/web", "cmd": "npx tsc --noEmit" }],
       "test": [{
         "dir": "packages/ui",
         "cmd": "npx vitest run --changed {{BASE}} --passWithNoTests",
         "fallbackCmd": "npx vitest run"
       }]
     }
   }
   ```

   `baseBranch` 는 게이트의 merge-base 산출과 `worktree-add.mjs` 의 분기 기준을 겸한다. `installCommand` 는 `worktree-add.mjs` 가 새 worktree에서 돌릴 설치 명령이다(기본값 `npm install` — pnpm/yarn/bun 이면 여기서 바꾼다. lockfile 로 자동 감지하지 않는다: 추측이 틀리면 조용히 잘못된 매니저로 설치한다).

   `{{BASE}}` 는 `merge-base(baseBranch, HEAD)` 로 치환된다(브랜치 변경분만 검사). 산출할 수 없으면 `fallbackCmd` 로 물러선다. 존재하지 않는 `dir` 은 경고 후 건너뛰고, 설정 파일 자체가 없으면 게이트 없이 통과한다 — 도입 초기에 push 가 부당하게 막히지 않게 하기 위함이다. 반대로 파일이 있는데 JSON 이 깨져 있으면 **중단**한다(오타가 '게이트 없음' 으로 둔갑하면 안 된다).

2. **`.claude/rules/*.md`** — 프로젝트별 코딩 규약. `example.md.template` 을 복사해 쓴다.

`.claude/CLAUDE.md` 나 훅에 게이트 대상을 다시 적지 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋날 수 있고, **낡은 사본은 없는 것보다 나쁘다**(세션이 틀린 검사를 돌리고 통과했다고 확신한다).

그 다음 기획자(`planner`)로 첫 태스크의 `harness/<task>/spec.md`를 쓰고, `harness/index.json`의 `tasks`에 `"<branch>": "harness/<task>/spec.md"`를 등록한다.

### 프로젝트 규약을 CLAUDE.md 에 쓰지 않는 이유

`.claude/CLAUDE.md` 와 `@import` 로 끌어온 파일은 **세션 시작 시 전부 컨텍스트에 로드**된다. 파일만 나누는 것은 사람 가독성에만 도움이 되고 AI 쪽 이득은 없다. 반면 `paths:` frontmatter 가 붙은 `.claude/rules/*.md` 는 **매칭되는 파일을 읽을 때만** 로드되므로, 프론트 작업 중에 백엔드 규약이 컨텍스트를 차지하지 않는다.

주의: `paths:` 없는 rule 은 `.claude/CLAUDE.md` 와 동일하게 매 세션 로드된다. 또 rule 은 매칭 파일을 **읽을 때** 걸리므로, 파일을 읽기 전 계획 단계에서 지켜져야 하는 규약은 `CLAUDE.md` 에 둔다.

## 포함된 spec

`harness/` 아래 spec 들은 **하네스 자신을 만든 작업의 실제 spec**이다. 형식 예시이자 설계 근거로 남겨둔다.

| task | 내용 |
|---|---|
| `worktree-workflow` | 브랜치별 worktree 분리 규약 + `worktree-add.mjs` |
| `worktree-enforce` | task 시작을 worktree 우선으로 강제 (`verify-branch.mjs`) |
| `token-usage` | 세션 토큰/비용 사후 집계 (`token-usage.mjs`) |
| `gate-pipeline` | 게이트 정의·실행 단일화 + `pre-commit` 도입 (`gate.mjs`, `config.json`) |
| `worktree-config` | `worktree-add.mjs` 의 분기 기준·설치 명령을 `config.json` 에서 읽기 |
| `index-sync-removal` | 한 번도 동작한 적 없던 코드↔문서 드리프트 알림 훅 제거 |
| `gate-env-isolation` | 게이트가 스폰하는 프로세스에서 `GIT_*` 를 씻어낸다 |
| `verify-branch-guard` | 교차 워킹트리 편집 차단 + 면제 경로 루트 앵커링 (`harnessMetaPaths`) |
| `drop-phase1` | "테스트 러너가 없다" 는 낡은 전제를 조건부 규칙으로 대체 |

## 알려진 제약

이 저장소는 Turborepo 기반 프로젝트에서 하네스 부분만 분리한 것이다. 분리 과정에서 드러난 잔여 작업(원인·수정 방향·완료 조건)은 [`BACKLOG.md`](./BACKLOG.md) 에 정리돼 있다.

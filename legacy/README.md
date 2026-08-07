# legacy — 구 버전 하네스 아카이브

여기 있는 것은 **참고 자료**다. 실행되지 않고, 유지보수하지 않으며, 게이트도 돌지 않는다
(`vitest.config.mjs` 의 `exclude` 에 `legacy/**` 가 있다).

하네스를 처음부터 다시 쓰기로 하면서, 구 버전이 어떤 문제를 어떻게 풀었는지 되짚을 수
있도록 지우지 않고 옮겼다. 새 하네스는 이 코드를 import 하지 않는다.

## 원래 경로

| 아카이브 경로 | 원래 경로 |
|---|---|
| `legacy/scripts/` | `scripts/` |
| `legacy/harness/` | `harness/` |
| `legacy/githooks/` | `.githooks/` |
| `legacy/claude/hooks/` | `.claude/hooks/` |
| `legacy/claude/rules/` | `.claude/rules/` |
| `legacy/claude/CLAUDE.md` | `.claude/CLAUDE.md` (사본 — 원본은 그 자리에 남아 있다) |

`.githooks` → `githooks`, `.claude` → `claude` 로 앞의 점을 뗐다. 숨김 디렉터리로 두면
아카이브를 훑어볼 때 보이지 않는다.

## 무엇이 들어 있나

### `scripts/`
- `gate.mjs` — 객관 게이트 러너. `harness/config.json` 의 `gate.typecheck`/`gate.test` 를
  읽어 각 대상 디렉터리에서 명령을 돌린다. 자식 프로세스에서 `GIT_*` 를 씻어낸다.
- `worktree-add.mjs` — 수동 worktree 생성 스크립트(534줄). Claude Code 의
  `isolation: worktree` 자동 생성으로 대체되면서 역할을 잃었다.
- `token-usage.mjs` — 세션 트랜스크립트를 읽어 토큰/비용을 집계.
- `setup-githooks.mjs` — `git config core.hooksPath .githooks` 를 걸어주는 postinstall.

### `harness/`
- `config.json` — 게이트 대상·`baseBranch`·`harnessMetaPaths` 의 단일 출처였다.
- `index.json` — `브랜치 → spec 경로` 매핑. 훅 3곳이 조회했다.
- `<task>/spec.md` + `qa-checklist.md` — 이 하네스를 만들면서 실제로 돌린 12개 task 의
  기획 명세와 QA 리포트. **파이프라인이 만들어낸 산출물의 실제 표본**이라 형식 참고용으로
  가장 값이 있다.

### `githooks/`
- `pre-commit` — 부분 스테이징 거부 → spec 소유권 검사 → 객관 게이트 → 통과 트리 해시 기록.
  훅 출력을 서브셸로 감싸는 SIGPIPE 방어가 들어 있다(출력하다 죽어서 `exit 1` 에 도달하지
  못해 막아야 할 커밋이 통과한 사고가 있었다).
- `pre-push` — 트리 해시가 같으면 게이트 스킵, `input_hash` 가 같으면 QA 스킵,
  아니면 `claude -p` 로 headless QA 를 돌린다.

### `claude/hooks/`
- `load-spec.mjs` — `UserPromptSubmit`. 현재 브랜치의 spec 을 컨텍스트에 주입.
- `verify-branch.mjs` — `PreToolUse(Edit|Write)`. 보호 브랜치·교차 워킹트리 편집을 차단.
- `spec-lock.mjs` — "한 브랜치는 spec 을 한 번만 확정한다" 판정(`pre-commit` 이 호출).
- `qa-hash.mjs` — QA 입력(spec + 테스트 파일)의 해시. 변동 없으면 QA 를 건너뛰는 근거.
- `session-cost.mjs` — `SessionEnd`. 세션 비용 출력.

### `claude/rules/`
- `test-git.md` — 테스트가 임시 저장소를 겨냥해 git 을 부를 때의 규약. 과거에 이 저장소가
  bare 로 재초기화되고 `main` 이 픽스처 커밋으로 덮인 사고에서 나왔다.
- `example.md.template` — rule 작성 템플릿.

## 아카이브하면서 함께 끊은 배선

옮기기만 하면 dangling reference 가 남으므로 다음을 정리했다.

- `.claude/settings.json` — `hooks` 블록 전체 제거(등록된 훅 3개가 전부 여기로 옮겨졌다).
- `package.json` — `prepare`·`gate`·`worktree`·`token-usage` 스크립트 제거. `test` 만 남겼다.
- `vitest.config.mjs` — `exclude` 에 `legacy/**` 추가.

`git config core.hooksPath` 는 여전히 `.githooks` 를 가리킨다. 그 디렉터리가 없어 훅은 아무것도
돌지 않지만, 새 훅을 `.githooks/` 에 만들면 별도 설정 없이 바로 붙는다.

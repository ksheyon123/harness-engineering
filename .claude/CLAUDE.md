# CLAUDE.md

역할 기반(기획자 / 개발자 / QA) 문서 주도 개발 하네스.

@harness.md

> **위 한 줄이 규약 본문을 끌어온다.** 자리·모드·검증·커밋/push·worktree 는 전부 `.claude/harness.md` 에 있고, **그 파일이 곧 이 하네스가 남의 저장소에 설치될 때 복사되는 것**이다. 그래서 이 저장소도 A 와 똑같은 방식으로 자기 규약을 읽는다 — 임포트가 깨지면 여기서 먼저 드러난다.
>
> **아래는 이 저장소만의 사정이다.** 설치본에는 딸려가지 않는다.

## 현재 상태 — 하네스는 재작성 중이다

**이 저장소가 만드는 것이 하네스 자체다.** 규약은 `harness.md`, 안 된 것은 `docs/backlog.md` — 하네스를 손대기 전에 둘 다 읽어라.

지금 존재하는 전부:

```
.claude/harness.md         하네스 코어 규약 — 설치될 때 이 파일이 복사된다
.claude/CLAUDE.md          이 파일 — 위를 임포트하고 이 저장소 사정을 덧붙인다
.claude/agents/*.md        developer · qa (서브에이전트 정의는 이 둘뿐이다)
.claude/planner-mode.md    기획자 모드의 spec 작성 지침 (에이전트 아님)
docs/backlog.md            확인됐지만 안 고친 것 — 왜 문제이고 어떻게 고치는지 (실행자가 읽는다)
.claude/hooks/             층 1 · 종료 훅 · 세션 훅 (hook-kit.mjs = 공통 배선)
                           harness-config.mjs = 프로젝트마다 달라지는 값의 단일 출처
.githooks/                 층 2 — pre-commit · pre-push (core.hooksPath 가 가리킨다)
.claude/settings.json      permissions + worktree.baseRef
vitest.config.mjs          테스트 러너 설정
package.json               scripts.test = "vitest run"  ← 게이트 정의의 단일 출처
```

여기에 `scripts/`(`harness.mjs` — CLI 진입점 · `spawn.ps1` — 작업 세션을 새 탭에 띄운다 · `reap-worktrees.mjs` — 회수된 에이전트 사본을 거둔다 · `doctor.mjs` — 설정을 검사해 보고한다)와 `install/`(`init.mjs`·`sync.mjs`·`smoke.mjs` — **남의 저장소에 설치하고 갱신하고 검사한다.** 남의 트리를 고치는 유일한 코드라 운영 도구와 자리를 나눴다)와 `harness/<task>/`(spec · QA 체크리스트), `src/`(제품 코드)가 더 있다. 없는 것: `.claude/rules/`.

## 미착수 — 이 설계와 실재의 차이

**여기는 *무엇이* 안 됐는지를 한 줄로 적는다. *왜 문제이고 어떻게 고치는지*는 `docs/backlog.md` 에 있다** — 하네스를 손대러 왔다면 그쪽을 먼저 열어라. 항목을 고쳤으면 두 곳에서 다 지운다.

| 무엇 | 상태 |
|---|---|
| ~~`scripts/spawn.ps1`~~ | ✅ **있다.** `harness spawn` 으로 부른다. `wt` 가 없으면 새 창으로 떨어진다. **어느 저장소를 겨냥하는지는 `-DryRun` 으로 덮었다**(npm 설치 배치 포함). **탭이 실제로 뜨는지는 여전히 자동 검증 불가** |
| ~~역할을 진입 시점에 싣는 수단~~ | ✅ **있다.** `HARNESS_ROLE` + `SessionStart` 훅 |
| `spawn` 의 유닉스판 | 없다. `spawn.ps1` 은 Windows 전용이다 |
| ~~`.claude/agents/planner.md` 정리~~ | ✅ **끝.** `.claude/planner-mode.md` 로 옮겼고 에이전트 정의는 지웠다 |
| ~~`verify-spec.mjs` → `pre-commit` 이주~~ | ✅ **끝.** 판정은 `.claude/hooks/spec-shape.mjs` 로 옮겼고 `pre-commit` 이 **인덱스**를 읽어 부른다 |
| ~~층 1 (`PreToolUse` + 역할 환경변수)~~ | ✅ **붙었다.** `path-ownership.mjs` |
| ~~층 2 (`.githooks/`)~~ | ✅ **붙었다.** `pre-commit` · `pre-push` |
| ~~`harness/index.json` 존폐~~ | ✅ **없앴다.** 파일도 참조도 없다 |
| ~~격리 세션에서 `git merge <역할 브랜치>`~~ | ✅ **검증됨.** developer·qa 인계 커밋을 실제로 회수했다 |
| 게이트 플레이크 | 3회 중 1회, `verify-green.test.mjs` 한 항목이 30초 상한을 넘기고 vitest 가 `Timeout calling "onTaskUpdate"` 를 뱉었다. 재실행은 12초에 통과. **원인 미상** — `verify-green` 의 재시도가 3회뿐이라 죄 없는 developer 가 상한을 태울 수 있다 |
| 작업 세션끼리 파일 소유가 겹치는지 볼 수단 | 없다. 각 spec 이 자기 worktree 안에만 있어 **기획자 둘이 서로를 못 본다** — task 경계 기준의 첫 줄("파일이 겹치나")을 판단할 근거가 없다 |
| 진행 중인 작업 세션과 갓 열린 세션의 구별 | 없다. 다만 두 번째 task 가 **spec 을 쓰는 순간** `pre-commit` 에 걸린다 — 세션 자체를 막지는 못한다 |
| ~~한 브랜치에 spec 이 둘 쌓이는 것~~ | ✅ **막힌다.** `pre-commit` 이 base 이후로 *추가된* spec 을 세고, 둘 이상이면 거부한다 |
| ~~병렬 `developer` 의 통합 red 복구~~ | ✅ **경로가 생겼다.** 순차가 기본이 됐고, 통합 red 는 머지된 `HEAD` 에서 새 `developer` 를 스폰해 푼다 |
| ~~"한 세션 = 한 작업" 자기모순~~ | ✅ **한 세션 = 한 task 로 못 박았다.** 다중 task 문장은 지웠다 |
| 한 작업 세션이 두 번째 task 를 받는 것 | 못 막는다. spec 을 쓰는 순간 `pre-commit` 에 걸리지만, 브랜치를 새로 자르면 안 걸린다 — 규율이다 |
| 실행자가 원문 대신 요약을 실어 넘기는 것 | 못 막는다. 요약과 원문은 문자열로 구분되지 않는다 — 실리면 기획자 모드가 형식적으로 지나간다 |
| ~~회수할 브랜치명을 얻는 경로~~ | ✅ **조상 질의로 바꿨다.** `git branch --list 'worktree-agent-*' --contains <spec 커밋 sha>` — 보고에 기대지 않는다 |
| ~~"인계 커밋이 찍혔으니 worktree 는 반드시 남는다"~~ | ✅ **문장은 맞았다.** "깨끗해져 오히려 지워진다" 는 추측이 실측으로 뒤집혔다 — 인계 커밋이 있으면 Claude Code 는 안 지운다. 대신 11단계가 회수된 것을 거둔다 |
| 격리 세션에서 `git worktree remove <남의 사본>` | **미확인.** 순수 git 으로는 되지만(실측), Claude Code 의 worktree 격리가 막는지는 못 재봤다 — 실행자는 격리 안에 설 수 없다. 막히면 11단계가 `정리하지 못했다` 를 찍고 지나간다(손실 없음, 사본만 쌓임) |
| 11단계를 안 하고 끝난 세션의 사본 | 남는다. **의도한 트레이드오프다** — 남의 사본을 거두려면 판정을 저장소 전역으로 넓혀야 하는데, 그게 병렬 세션을 깨뜨렸다. 쌓인 것은 사람이 지운다 |
| ~~서브에이전트가 `HARNESS_ROLE` 을 물려받는다~~ | ✅ **풀렸다.** 훅 입력의 `agent_type` 이 변수를 이긴다 |
| ~~남의 저장소에 설치하는 수단~~ | ✅ **`harness init` 이 있다.** tarball 을 풀어 설치하는 통합 테스트가 층 1·2 와 worktree 해석까지 덮는다 → 남은 것은 **backlog G** |
| ~~배선이 끊긴 것을 알아챌 수단~~ | ✅ **`harness smoke` 가 있다.** 훅 명령이 실재하는 파일을 가리키는지·그것이 돌아 판정을 내놓는지·git 이 추적하는지를 서 있는 트리에 대고 묻는다. 설치본이 전부 초록인 것을 통합 테스트가 고정한다 |
| Claude Code 가 그 배선을 **실제로 부르는지** | **여전히 자동 검증 불가.** `smoke` 가 증명하는 것은 *부르면 도는가* 까지다 — 비대화형 `claude -p` 는 `isolation` 도 frontmatter 훅도 안 건다(실측). `smoke` 가 사람이 세션에서 볼 목록을 같이 찍는다 |
| `node_modules` 를 겨냥한 배선이 worktree 에서 죽는 것 | 실측됐다. `@` 임포트는 프로젝트 루트 밖으로 못 나가고 `${CLAUDE_PROJECT_DIR}` 는 worktree 를 가리킨다 — **둘 다 조용히 실패한다** → **backlog G** |
| ~~플러그인 에이전트의 `isolation`·`SubagentStop`~~ | ✅ **쟀다. 둘 다 안 걸린다** — `tools:` 화이트리스트만 먹는다. `developer`·`qa` 는 플러그인으로 못 옮긴다 → **backlog G** |

# 하네스 백로그 — 확인됐지만 아직 안 고친 것

**읽는 주체는 실행자다.** 하네스를 손대러 맨몸 `claude` 를 열었을 때 여는 문서이고, 그 외에는 아무도 읽지 않는다. `CLAUDE.md` 의 미착수 표가 *무엇이* 안 됐는지를 한 줄로 적는다면, 여기는 *왜 그게 문제이고 어떻게 고치는지*를 적는다.

> **쓰기만 하고 아무도 안 읽는 파일은 틀려도 아무도 모른다.** `harness/index.json` 이 그렇게 죽었다. 이 파일도 같은 위험을 진다 — **항목을 고쳤으면 여기서 지워라.** 남겨두고 "완료" 라고 적지 마라. 지워지지 않는 백로그는 곧 아무도 안 믿는 백로그가 된다.

각 항목은 **증상 → 근거 → 어떻게 → 어디를 만지나** 순서다. 근거는 전부 소스나 실측이고, 추측인 것은 그렇게 적었다.

---

## G — 패키지화: 이 하네스를 남의 저장소에 설치할 수 있게 한다

**증상.** 이 하네스를 다른 프로젝트(이하 **A**)에 이식하려면 파일을 손으로 옮기고 설정을 손으로 합쳐야 한다. 설계가 **단일 저장소 전제**로 되어 있어서다.

**근거 1 — 코드 결합은 작다.** 훅·스크립트 3,025줄 중 프로젝트에 따라 달라지는 리터럴은 스무 줄 남짓이다: `path-ownership.mjs` 의 `RULES`(`src/**` · `harness/**` · `HARNESS_FILES`), `verify-green.mjs` 의 `npm test`, `verify-checklist.mjs` 의 `harness/`·`qa-checklist.md`, `pre-commit.mjs` 의 `PROTECTED`·`harness/`. 나머지(`hook-kit` · `reap-worktrees` · `session-role` · `verified-marker` · `spec-shape`)는 이미 프로젝트에 무관하다.

**근거 2 — 진짜 비용은 설치 절차다.** `settings.json` 병합, `core.hooksPath` 점유(husky·lefthook 과 충돌), `posttest` 배선, 러너의 `**/.claude/worktrees/**` 제외, `.gitignore` 의 `.claude/worktrees/`. 마지막 것은 특히 위험하다 — **`pre-commit` 이 `git add -A` 를 강제**하므로 무시되지 않으면 작업 세션의 커밋이 에이전트 사본을 통째로 쓸어 담는다.

**근거 3 — 이게 설계를 가른다. worktree 는 추적되는 파일만 본다.** 실측(아래 표):

- `CLAUDE.md` 의 `@` 임포트는 **프로젝트 루트 밖으로 못 나간다.** worktree 세션에서는 worktree 자신이 프로젝트 루트라, `node_modules` 의 문서가 **조용히 안 실린다**
- `${CLAUDE_PROJECT_DIR}` 는 worktree 안에서 **worktree 루트**를 가리킨다. 거기엔 `node_modules` 가 없으므로 `${CLAUDE_PROJECT_DIR}/node_modules/...` 로 배선한 훅은 **전부 ENOENT** 로 죽는다 — 층 1 도, 종료 게이트도, 인계 커밋도. 그것도 **조용히**

즉 `npm install` 만으로는 하네스가 서지 않는다. **설치는 두 단계**다: `npm i -D` 로 기계를 배달하고, `npx harness init` 이 A 의 트리에 추적되는 실체를 만든다.

**어떻게 — 순서가 있다.**

1. ~~**설정 추출이 먼저다.**~~ ✅ **끝났다.** `.claude/hooks/harness-config.mjs` 가 `harness.config.json`(`gate` · `source` · `harnessFiles` · `specRoot` · `protectedBranches`)을 읽고, 네 파일이 전부 그걸 쓴다. 기본값이 이 저장소의 동작 그대로라 **파일이 없어도 아무것도 안 바뀐다** — 그래서 이 저장소는 설정 파일을 두지 않는다(사본을 만들지 않기 위해).
   - ~~설정 오타가 조용히 기본값으로 돌아가는 것~~ ✅ **`scripts/doctor.mjs` 가 검사한다.** 로더는 여전히 조용하다(훅에서 던지면 차단이 아니라 **통과**가 된다) — 대신 doctor 가 모르는 키·타입 불일치·헛도는 경로 패턴을 사람에게 보고한다. **막지는 않는다**: 오류가 있으면 종료 코드 1 을 줄 뿐이다
   - **남은 것**: `posttest` 의 "성공했을 때만 돈다" 보장은 아직 npm 에 얹혀 있다. `gate` 를 npm 밖 명령으로 바꾸면 그 기록이 안 남고 `pre-push` 가 막는다
2. **배포 수단은 플러그인 + A 의 실체 파일을 섞는 형태가 된다.** 플러그인은 CLI 쪽에 설치되어 **프로젝트 기준 해석에 아예 안 걸리므로** 위 근거 3 의 두 함정을 비껴간다(실측: 훅·주입 지침·에이전트가 **진짜 worktree 안에서 동작**했다). 다만 아래에서 보듯 **에이전트 정의와 종료 훅은 플러그인이 못 가져간다** — 그 둘은 A 에 남는다
3. **그래도 층 2 는 플러그인이 못 싣는다.** `.githooks/` · `core.hooksPath` · `harness.config.json` · `.gitignore` · 러너 제외 · `posttest` 는 A 에 남는다. `init`/`doctor` 가 그 다섯을 처리하고, 처리 못 하면 **덮어쓰지 말고 멈춰서 알린다**

~~**빌드는 없다 — 대신 발행 위생이 있다.**~~ ✅ **끝났다.** 컴파일할 것이 없다는 판단은 그대로다: TS 가 아니고(`.mjs` + `"type": "module"`), 소비자가 `import` 하는 라이브러리가 아니라 **Claude Code·git 이 별도 프로세스로 부르는 실행 파일**이며, payload 의 절반은 `.md` 다. `dist/` 를 만들면 **게이트가 검사한 트리와 발행되는 트리가 갈리기만** 한다.

`files` · `exports` · `bin` · `engines` 를 넣었고, **tarball 내용을 `package-manifest.test.mjs` 가 고정한다** — `npm pack --dry-run --json` 에게 실제로 담기는 것을 물어서 검사한다(손대기 전 46개 → 24개. `src/` 와 `harness/` 까지 딸려 나가고 있었다).

**남은 것: 실행권한. 이제 추측이 아니라 실측이다.**

```
$ tar -tvzf harness-engineering-0.1.0.tgz
-rw-r--r--  package/.githooks/pre-commit      ← git 인덱스는 100755 인데 644 로 떨어졌다
-rw-r--r--  package/.githooks/pre-push
```

**`npm pack` 은 git 이 아니라 워킹트리에서 tarball 을 뜬다.** Windows 워킹트리에는 실행권한이라는 개념이 없으므로 전부 `644` 가 된다. 그리고 **git 은 실행권한 없는 훅을 에러 없이 건너뛴다** — A 의 POSIX 환경에서 브랜치 보호도 verified marker 도 없는데 아무도 모르는 상태가 된다.

- `bin` 은 무사하다 — npm 이 설치할 때 shim 을 만들며 실행권한을 준다
- **`.githooks/` 는 무사하지 않다.** `init` 이 복사한 뒤 POSIX 에서 `chmod +x` 해야 하고, `doctor` 가 **실제로 실행 가능한지**를 검사해야 한다 → 3번
- POSIX 에서 발행하면 모드가 보존되므로 이 문제는 **발행 플랫폼에 따라 갈린다.** 그래서 발행자에게 기대지 않고 설치 쪽에서 고정한다

> 마지막 고리("git 이 조용히 건너뛴다")만 여전히 **이 저장소에서 재현 못 했다** — Windows git 은 실행권한을 파일 모드로 구분하지 않는다. 다만 `chmod +x` 비용이 워낙 작아 확인 전이라도 넣는 쪽이 맞다.

**플러그인이 가져갈 수 있는 것은 절반뿐이다 — 대화형에서 쟀다.** 플러그인이 제공한 에이전트를 실제로 스폰해 확인했다:

| 무엇 | 결과 |
|---|---|
| `tools:` 화이트리스트 (층 0) | **동작한다.** 에이전트가 "쓸 수 있는 것은 `Read` 하나, Bash 없다" 고 보고했다 |
| `isolation: worktree` | **안 붙는다.** `git worktree list` 에 사본이 늘지 않았다 |
| frontmatter `SubagentStop` | **안 돈다.** 훅이 아무것도 남기지 않았다 |

**그래서 `developer`·`qa` 는 플러그인으로 못 옮긴다.** 둘의 존재 이유가 정확히 뒤의 둘이다 — 격리된 사본에서 돌고, 종료 훅이 게이트를 걸고 인계 커밋을 찍는 것. 플러그인이 대신할 수 있는 것은 도구 화이트리스트까지다.

남는 이득은 이렇게 줄어든다:

| A 에 커밋되는 것 | 플러그인이 없앨 수 있나 |
|---|---|
| `agents/*.md` · 종료 훅 shim | **아니다** — 에이전트 frontmatter 가 부르므로 A 에 실체로 있어야 한다 |
| `SessionStart`·`PreToolUse` 훅 shim | 가능 |
| 문서(`CLAUDE.md` · `planner-mode.md`) | 가능 — `additionalContext` 주입으로 |

즉 **문서 사본과 훅 shim 절반이 사라지고, 에이전트 정의와 종료 훅은 남는다.** `harness sync` 는 여전히 필요하다(범위가 줄 뿐이다).

**부수 발견.** 플러그인을 깔거나 고치면 **세션을 다시 열어야 에이전트가 붙는다.** 스킬 목록은 세션 중에 갱신되는데 에이전트 레지스트리는 시작 시점에 고정된다 — `/reload-plugins` 로 풀린다. 설치 안내에 이 한 줄이 없으면 "깔았는데 에이전트가 없다" 로 막힌다.

**딸린 것.** 플러그인 에이전트는 **`플러그인명:에이전트명`** 으로 네임스페이스된다 — 스폰 코드와 문서가 그만큼 바뀐다. 그리고 플러그인 에이전트·지침은 CLI 쪽에 있어 **A 가 프로젝트별로 못 고친다**(지금은 A 가 `developer.md` 를 자기 스택에 맞게 손볼 수 있다).

**어디.** 2·3번은 **저장소 구조 전체**다. 1번은 끝났고 미확인이던 것도 다 쟀으므로, 남은 결정은 "무엇을 플러그인에 싣고 무엇을 A 에 남기나" 뿐이다 — 위 표가 그 답이다.

**부수 사실.** `.gitignore` 의 "worktree 는 저장소 밖 형제 디렉터리에 두는 것이 원칙" 주석은 패키지화하면 **틀린다.** 사본이 A 안에 중첩돼 있어야만 `node_modules` 상향 해석이 닿고(훅 shim · worktree 안의 `npm test`), 밖으로 나가면 둘 다 깨진다. 2번을 할 때 같이 고친다.

## 실측으로 확인된 것 — 다시 재보지 마라

| 무엇 | 결과 |
|---|---|
| 본체에서 링크된 worktree 의 브랜치 `git branch -m` | **된다.** 그 worktree 의 `HEAD` 파일까지 따라 바뀐다 |
| 같은 브랜치 `git worktree move` | **된다** |
| 같은 브랜치 `git branch -D` | **거부된다** (`used by worktree at …`) |
| 격리된 worktree 안에서 `git worktree list` · `git branch --list` · 남의 브랜치 `git log` | **전부 된다.** `git -C <남의 트리>` 와 다르다 — 남의 워킹트리를 건드리지 않는 읽기다 |
| `git branch --list` 의 `+` 접두어 | **다른 worktree 에 체크아웃 중**이라는 표시 |
| 에이전트가 Bash 없이 자기 브랜치 알기 | **된다.** `.git` → `gitdir:` → 그 경로의 `HEAD`, Read 두 번 |
| `.claude/` 가 protected path 라 쓰기가 막히나 | **아니다.** `.claude` 는 보호 대상이지만 **`.claude/worktrees` 는 명시적 예외**다 |
| `defer` 가 유효한 `permissionDecision` 인가 | **유효하다.** `allow`·`deny`·`ask`·`defer` 넷 다. `defer` = '결정하지 않음' = 정상 권한 흐름 |
| 사후 rename 으로 `agent-<난수>` 를 정리하는 것 | **의미 없다.** 회수는 한 번 쓰고 버리는 이름이고, 동일성은 `--contains <spec 커밋>` 조상 질의로 푼다 |
| 인계 커밋이 찍힌 사본을 Claude Code 가 자동으로 지우나 | **안 지운다.** 죽은 사본이 계속 쌓인다 — `reap-worktrees.mjs` 가 생긴 이유다 |
| 자기가 서 있는 worktree 를 지우기 | **안 된다.** `failed to delete: Permission denied` (Windows 가 cwd 를 잡는다). 그 사본을 cwd 로 가진 **다른** 프로세스가 살아 있어도 마찬가지다 |
| 링크된 worktree 안에서 *다른* worktree `remove` | **된다** (순수 git 기준) |
| 사본을 지운 뒤 그 브랜치 머지 | **된다.** `worktree remove` 는 objects 도 refs 도 건드리지 않는다 |
| dirty · 미머지 · locked 사본을 `--force` 없이 지우기 | **셋 다 거부된다.** 정리의 안전장치가 전부 여기 걸려 있다 |
| `SessionEnd` 가 Ctrl+C 에도 도나 | **돈다.** 그 세션이 무엇을 하던 중이었는지 묻지 않는다 — 정리를 거기 걸었다가 병렬 세션을 깨뜨렸다 |
| `.claude/worktrees/` 를 세션들이 공유하나 | **공유한다.** 그래서 정리 판정을 저장소 전역으로 넓히면 **남의 사본을 지운다.** 소유의 근거는 `--merged HEAD` 하나뿐이다 |
| `CLAUDE.md` 의 `@` 임포트가 `node_modules` 를 타나 | **탄다.** `.claude/CLAUDE.md` 의 `@../node_modules/<pkg>/CLAUDE.md` 가 로드됐다 |
| 그 임포트가 worktree 안에서도 되나 | **안 된다.** 상대경로 거리를 맞춰도 실패하고, `node_modules` 를 worktree **안**에 두면 성공한다 → **임포트는 프로젝트 루트 밖으로 못 나간다** |
| 조상 디렉터리의 `CLAUDE.md` 는 worktree 에서 로드되나 | **로드된다.** 다만 **그 파일의 임포트는 펼쳐지지 않는다** — A 가 직접 쓴 문장만 살아남는다 |
| worktree 안에서 `${CLAUDE_PROJECT_DIR}` 가 가리키는 곳 | **worktree 루트.** 본체가 아니다 — `node_modules` 가 없는 곳이다 |
| worktree 안에서 `import "<pkg>/..."` (node 상향 해석) | **된다.** 사본에 `node_modules` 가 없어도 부모의 것을 찾는다. **사본이 저장소 안에 중첩돼 있어야만 성립** |
| 플러그인 훅(`SessionStart`·`PreToolUse`)이 worktree 안에서 도나 | **돈다.** `${CLAUDE_PLUGIN_ROOT}` 는 **프로젝트 밖 절대경로**라 cwd 와 무관하다 |
| 플러그인의 `additionalContext` 주입이 worktree 안에서 실리나 | **실린다** |
| 플러그인 에이전트가 worktree 안에서 스폰되나 | **된다.** 이름은 **`플러그인명:에이전트명`**, 자기 시스템 프롬프트가 적용된다 |
| 플러그인 에이전트의 `tools:` 화이트리스트 | **먹는다.** 스폰된 에이전트가 `Read` 하나만 갖고 Bash 가 없다고 보고했다 |
| 플러그인 에이전트의 `isolation: worktree` | **안 붙는다.** 대화형에서 스폰해도 사본이 안 생긴다 |
| 플러그인 에이전트의 frontmatter `SubagentStop` | **안 돈다.** 훅이 아무것도 남기지 않는다 → `developer`·`qa` 는 플러그인으로 못 옮긴다 |
| 플러그인 설치·수정이 도는 세션에 반영되나 | **에이전트는 아니다.** 스킬 목록은 세션 중에 갱신되지만 에이전트 레지스트리는 시작 시점에 고정된다 — `/reload-plugins` 가 푼다 |
| Windows 에서 `npm pack` 이 실행권한을 지키나 | **아니다. 전부 `644` 로 떨어진다** — git 인덱스가 `100755` 여도 그렇다. `npm pack` 은 git 이 아니라 워킹트리를 뜬다 |
| `bin` 대상의 실행권한 | **npm 이 설치 때 shim 을 만들며 준다.** 문제는 `.githooks/` 처럼 복사만 되는 파일이다 |
| `claude -p` 에서 `isolation`·frontmatter 훅 | **판정에 쓸 수 없다.** 프로젝트 에이전트(대조군)도 똑같이 안 걸린다 — 비대화형 모드의 한계다 |

---

## 순서

**남은 것은 G 뿐이다.** `CLAUDE.md` 정리(B·C·E·F)가 끝났으므로 이제 구조를 흔들어도 된다. G-1(설정 추출)과 그 검증(`doctor`)은 끝났고, 남은 것은 2·3번 — **배포 수단과 설치 절차**다.

이 문서에 **일부러 없는 것** 둘:

- **실행자가 원문 대신 요약을 실어 넘기는 것.** 요약과 원문은 문자열로 구분되지 않고, "사람이 실제로 논의했는가" 는 훅이 판정할 수 있는 종류가 아니다. `CLAUDE.md` 미착수 표에 못 막는다고 적어두는 것이 전부다
- **spec 에 기능별 '건드릴 파일' 을 적는 것.** 병렬 스폰 판단에 근거가 생기지만, 코드가 없는 시점에 파일을 적는 것이 얼마나 정확할지 모른다. 순차가 기본이 된 지금은 급하지 않다 — **병렬이 실제로 필요해질 때 판단한다**

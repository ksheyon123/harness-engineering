# 실측으로 확인된 것 — 다시 재보지 마라

**여기 있는 것은 전부 이 저장소에서 직접 재본 결과다.** 추측은 들어오지 않는다 — 추측은 `backlog.md` 의 해당 항목에 '추측' 이라고 적어 둔다.

> **`backlog.md` 와 규율이 반대다.** 백로그는 고쳤으면 **지운다.** 여기는 항목이 끝나도 **남는다** — 이 값들은 어떤 결정의 근거였고, 그 결정을 나중에 다시 들여다볼 때 필요한 것이 결론이 아니라 근거다. 지우면 다음 사람이 같은 것을 다시 잰다.
>
> **틀린 것이 드러나면 지우지 말고 고쳐라.** 그리고 무엇이 뒤집혔는지 한 줄로 남겨라 — 뒤집힌 실측은 그 위에 세워진 설계를 같이 무너뜨린다.

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
| `claude -p` 에서 `isolation`·frontmatter 훅 | **판정에 쓸 수 없다.** 프로젝트 에이전트(대조군)도 똑같이 안 걸린다 — 비대화형 모드의 한계다. 그래서 `harness smoke` 는 그 둘을 **돌려보지 않고** frontmatter 로만 판정하고, 나머지는 사람 몫으로 찍는다 |
| `git ls-files` 가 **스테이징만** 한 파일을 잡나 | **잡는다.** 인덱스를 보기 때문이다 — 그래서 추적 판정의 기준으로 쓰면 안 된다 |
| 그 상태에서 worktree 사본이 그 파일을 받나 | **못 받는다.** 사본은 **커밋된 것만** 받는다. 이 둘이 어긋나서 `smoke` 가 거짓 초록을 냈다 |
| `.gitignore` 가 **이미 추적되는** 파일에 힘이 있나 | **없다.** 무시 규칙은 추적되지 않는 파일에만 걸린다 — `git add -f` 는 **한 번만** 하면 되고, 이후 `git add -A` 가 수정분을 정상적으로 담는다 |
| `git check-ignore` 가 추적 중인 파일을 무시된 것으로 치나 | **아니다.** 종료 코드 1(=무시 안 됨)을 낸다. 위 성질과 일관된다 |
| `git check-ignore` 의 `-z` | **`--stdin` 하고만 된다** (`fatal: -z only makes sense with --stdin`). 경로를 인자로 줄 때는 줄 단위로 읽어야 한다 |
| 통짜 `.claude` 무시가 `.claude/worktrees/` 도 덮나 | **덮는다.** 그래서 `.gitignore` 에서 그 **글자**를 찾던 검사는 거짓 경보였다 |
| **`EnterWorktree` 가 `post-checkout` 을 부르나** | **부른다.** 대화형 세션에서 실측 — 흔적에 `cwd`·`toplevel` 이 새 사본, `main` 이 본체로 정확히 잡혔다. **Claude Code 의 작업 세션 사본은 git 의 worktree 생성 경로를 탄다** |
| 그때 훅이 본체 경로를 알 수 있나 | **안다.** `git worktree list --porcelain` 첫 줄이 사본 안에서도 본체를 가리킨다. 단 자식 git 은 `GIT_` 를 씻고 불러야 한다 — 훅은 `git worktree add` 안에서 도는 자식이라 `GIT_DIR` 이 이미 심겨 있다 |
| **서브에이전트 격리(`isolation: worktree`)가 `post-checkout` 을 부르나** | **부른다.** 작업 세션에서 `developer` 를 스폰해 실측 — 흔적에 `cwd=…\worktrees\agent-<hex>` 가 잡혔고, `new-ref` 가 그 세션의 spec 커밋이었다(`worktree.baseRef: "head"` 와 일치) |
| 그래서 **두 경로가 다 도나** | **돈다.** `EnterWorktree` 와 서브에이전트 격리가 **둘 다** `post-checkout` 을 부른다 — 한쪽만 돌면 그쪽 사본에만 하네스가 심기므로 따로 쟀다. **커밋 없이 사본에 심는다는 전제가 성립한다** |
| `core.hooksPath` 를 절대경로로 두는 것 | **정상이다.** git 이 워킹트리 최상단 기준으로 푸므로 상대 `.githooks` 는 **링크된 worktree 안에서 그 사본의 훅**을 부른다. 이 저장소는 절대경로라 본체 것이 불린다 — 둘 다 성립하므로 `smoke` 는 표기가 아니라 **가리키는 곳**을 본다 |

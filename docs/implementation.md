# 설치와 운영

**남의 저장소(이하 **A**)에 이 하네스를 세우는 절차.** 규약 본문은 `.claude/harness.md` 에 있고, 여기는 *그것을 어떻게 붙이는가* 만 적는다.

## 요구사항

| 무엇 | 왜 |
|---|---|
| Node ≥ 18 | 훅과 스크립트가 전부 ESM `.mjs` 다 |
| git 저장소 | 층 2 가 `core.hooksPath` 를 쓴다. `git init` 만 돼 있으면 된다 |
| Claude Code | 층 1·세션 훅·서브에이전트 격리가 전부 Claude Code 의 기능이다 |
| **도는 게이트** | 종료 훅이 `npm test` 를 돌린다. `init` 은 러너를 설치하지 않는다 — [아래](#게이트는-init-이-만들지-않는다) |
| Windows | **`harness spawn` 만** 그렇다. 나머지는 플랫폼을 안 가린다 — 유닉스판 `spawn` 은 아직 없다 |

## 설치 — 다섯 단계

```sh
npm i -D @ksheyon123/harness-engineering
npx harness init                       # --dry-run 을 먼저 붙여 무엇을 쓸지 볼 수 있다
git switch -c chore/harness-install    # 보호 브랜치에는 직접 커밋이 안 된다
git add -A
git commit                             # 이것까지 해야 설치가 끝난다 — 아래 참고
```

**`init` 이 끝에서 `smoke` 를 직접 돈다.** 그래서 따로 부를 필요가 없다 — 배선이 깨졌으면 그 자리에서 종료 코드 1 이다. 다만 **커밋만 안 된 것은 1 이 아니다.** `init` 은 남의 저장소에 커밋을 만들지 않으므로 그것으로 실패를 내면 종료 코드가 *항상* 1 이 되고, 항상 같은 값은 아무 정보도 아니다. 커밋한 뒤 `npx harness smoke` 를 한 번 더 돌려 마지막 항목까지 초록인지 본다.

그 다음 **Claude Code 를 새로 연다.** 훅은 세션이 시작될 때 읽히므로, 이미 떠 있는 세션은 `.claude/settings.json` 이 생겨도 집지 않는다.

### `npm install` 만으로는 아무것도 안 된다

패키지를 설치하면 `node_modules` 에 코드가 놓일 뿐이고, Claude Code 입장에서 A 는 여전히 평범한 저장소다. 배선은 `harness init` 이 **A 의 트리에 실체를 만들어야** 생긴다:

| 하네스를 태우는 것 | 어디 있어야 하나 |
|---|---|
| 역할 선언(`너는 실행자다`) | `.claude/settings.json` 의 `SessionStart` 훅 |
| 경로 소유권(층 1) | `.claude/settings.json` 의 `PreToolUse(Edit\|Write)` 훅 |
| 종료 게이트 | `.claude/agents/developer.md`·`qa.md` 의 frontmatter 훅 |
| 규약 본문 | `.claude/CLAUDE.md` → `@harness.md` |
| 층 2 | `.githooks/` + `core.hooksPath` |

`.claude/settings.json` 이 없으면 훅이 등록될 자리가 없고, `CLAUDE.md` 가 없으면 규약도 안 실린다. **둘 다 `init` 이 만든다.**

### 커밋까지 왜 설치 절차에 넣나

**worktree 사본은 커밋된 것만 받는다.** 서브에이전트는 `isolation: worktree` 로 자기 사본에서 도는데, 갓 설치돼 커밋되지 않은 훅·규약·에이전트 정의는 그 사본에 **없다.** 없으면 막히는 게 아니라 **그냥 통과한다** — 층 1 이 통째로 사라지는데 아무 신호도 없다.

`harness smoke` 가 이것을 마지막 항목으로 묻는다. 설치 직후 바로 돌리면 이렇게 나온다:

```
  ✗  worktree 안에서도 살아남는다 — 필요한 것이 전부 커밋된다
      `.claude/CLAUDE.md` · `.claude/harness.md` · … — 아직 안 담겼다 — `git add -A`.

끊긴 배선 1개. 그 자리는 **조용히** 없는 것으로 돈다.
```

**스테이징만으로는 초록이 되지 않는다.** 기준은 인덱스가 아니라 `HEAD` 다 — `git add` 만 하고 커밋을 안 한 상태에서 사본을 떠보면 `.claude` 가 통째로 없다(실측). 상태마다 처방이 다르고, ✗ 가 그것을 직접 찍는다:

| 상태 | 다음에 칠 것 |
|---|---|
| 파일이 없다 | `harness init` 부터 |
| `.gitignore` 가 막는다 | `git add -f -- <경로>` — `git add -A` 로는 **몇 번을 돌려도** 안 담긴다 |
| 아직 안 담겼다 | `git add -A` |
| 스테이징까지만 됐다 | **커밋** |

> 첫 커밋에서 `pre-commit` 이 막을 수 있다 — 보호 브랜치(`main`/`dev`/`master`)에 직접 커밋하려 할 때다. **층 2 가 살아 있다는 증거이므로 정상이다.** `git switch -c chore/harness` 로 브랜치를 자르고 커밋해라.

### 게이트는 `init` 이 만들지 않는다

**무엇을 검사할지는 A 가 정한다.** 하네스가 정하는 것은 *어떤 명령을 부르는가*(`gate`)뿐이고, *무엇이 돌아가는가*는 `package.json` 의 `scripts.test` 다. 그래서 `init` 은 테스트 러너를 설치하지도 `scripts.test` 를 쓰지도 않는다 — 남의 러너 선택을 하네스가 대신하면 그때부터 그것도 하네스 책임이 된다.

대가는 **갓 설치된 프로젝트에 게이트가 없다**는 것이다. 그 상태는 스스로 드러나지 않는다:

- 배선은 전부 멀쩡하다. `smoke` 의 다른 항목이 전부 초록이다
- `developer` 를 스폰하고 나서야, 그 종료 훅이 `npm test` 를 돌려 `Missing script: test` 로 죽고 **재시도 상한을 태운 뒤에야** 보인다
- `scripts.test` 가 없으면 npm 은 `posttest` 도 안 부른다. 게이트 통과 기록이 안 남아 **push 까지 막힌다**

`smoke` 가 이것을 따로 묻는다:

```
  ✗  게이트 — `verify-green` 이 돌릴 것이 있다
      `scripts.test` 가 없다 — `npm test` 가 그 자리에서 죽는다. …
```

npm 이 아닌 게이트(`make check` 등)는 `?` 로 찍고 넘어간다. **없는 것과 모르는 것은 다르다** — 여기서 red 를 내면 make·just 를 쓰는 멀쩡한 프로젝트가 전부 빨개진다. 그때는 직접 한 번 돌려봐야 한다.

## `init` 이 만드는 것

```
.claude/hooks/          path-ownership · session-role · verify-green · verify-checklist
.githooks/              pre-commit · pre-push (+ .mjs 본체) · mark-verified
.claude/agents/         developer.md · qa.md
.claude/harness.md      규약 본문
.claude/planner-mode.md 기획자 모드 — 논의 · 격리 진입 · spec 작성
.claude/planner/        논의 방식 — 작업 세션에 자동 주입된다. 갈아끼워도 된다
.claude/skills/         /harness-fix · /task — 라우팅을 사람이 명시하는 빠른 길
.claude/CLAUDE.md       위를 @harness.md 로 끌어온다
.claude/settings.json   훅 등록 + worktree.baseRef=head
.claude/harness-manifest.json  설치 기록부 — 버전과 내용 해시
.gitignore              `.claude/worktrees/` 한 줄을 더한다
package.json            `posttest` 를 배선한다
core.hooksPath          `.githooks` 로 설정한다
```

**`.claude/hooks/` 에 놓이는 것은 한 줄짜리 shim 이다.** 본체는 패키지 안에 산다. 실측으로 확정된 것 둘 때문이다 — `CLAUDE.md` 의 `@` 임포트는 프로젝트 루트 밖으로 못 나가고, `${CLAUDE_PROJECT_DIR}` 는 worktree 안에서 **worktree 루트**를 가리킨다. 그래서 `node_modules` 를 직접 겨냥한 배선은 사본에서 조용히 죽는다. shim 은 사본에도 있어야 하고(커밋되어 있거나 `post-checkout` 이 심거나 — **어느 쪽인지는 A 가 정한다**), 거기서 node 의 상향 해석이 `A/node_modules` 까지 올라가 본체를 찾는다.

### 있는 것을 빼앗지 않는다

`init` 은 **덮어쓰지 않는다.** 충돌하면 고치지 않고 멈춰서 알린다:

| 상황 | 어떻게 되나 |
|---|---|
| `core.hooksPath` 가 `<A>/.githooks` **아닌 곳**을 가리킨다 | **멈춘다.** 빼앗으면 A 의 기존 훅이 통째로 죽는데 아무도 모른다. 묻는 것은 표기가 아니라 **가리키는 곳**이라, 절대경로로 우리 `.githooks` 를 가리키는 것은 **충돌이 아니다** — 그 표기를 그대로 둔다 |
| `posttest` 에 이미 다른 것이 걸려 있다 | 배선하지 않고 알린다 — 직접 이어 붙여야 한다 |
| A 에 `CLAUDE.md` 가 이미 있다 | 덮지 않고 `@harness.md` 한 줄만 앞에 붙인다 |
| `settings.json` 이 이미 있다 | 지우지 않고 훅 항목을 **더한다** |

## 설치 후 — 사람이 직접 봐야 하는 것

`smoke` 가 증명하는 것은 **"부르면 도는가"** 까지다. **Claude Code 가 실제로 부르는가**는 세션을 띄워야만 안다(비대화형 `claude -p` 는 `isolation` 도 frontmatter 훅도 안 건다 — 실측). `smoke` 가 끝에 이 목록을 같이 찍는다:

1. **역할이 실리나** — 맨몸 `claude` 를 열고 `"너는 누구지? 한 줄로."` → **실행자**라고 답해야 한다
2. **층 1 이 도구를 막나** — `"src 아래 아무 파일이나 한 줄 고쳐봐."` → 거부되고 `harness spawn` 안내가 떠야 한다
3. **`spawn` 이 다른 프로세스를 띄우나** — `harness spawn "..."` → 새 탭에서 `"너는 누구지?"` 에 **작업 세션**이라고 답해야 한다
4. **서브에이전트가 격리되나** — `developer` 스폰 후 `git worktree list` → `agent-<hex>` 가 하나 늘어야 한다
5. **종료 훅이 인계 커밋을 찍나** — `git branch --list 'worktree-agent-*' --contains <spec 커밋 sha>` → `chore(developer): …` 이 보여야 한다. 브랜치가 base 그대로면 `smoke` 의 **신뢰** 판정부터 봐라 — 저장소가 신뢰 목록에 없으면 훅은 실패하는 게 아니라 **등록조차 되지 않는다**
6. **층 2 가 검증 안 된 push 를 막나** — 게이트를 안 돌린 채 `git push` → 거부돼야 한다

1번이 안 되면 훅이 아예 안 붙은 것이다. **세션을 새로 열었는지부터 확인해라.**

## 프로젝트에 맞추기 — `harness.config.json`

저장소 최상단에 두고, **달라지는 값만** 적는다. 없으면 기본값으로 돈다.

| 키 | 기본값 | 무엇 |
|---|---|---|
| `gate` | `"npm test"` | 종료 훅이 돌리는 명령. npm 이 아니면 이것만 바꾸면 된다 |
| `source` | `["src/**"]` | 제품 코드. 역할이 고치고 세션은 못 고친다 |
| `harnessFiles` | `.claude/**` · `.githooks/**` · `scripts/**` · `package.json` · `package-lock.json` · `vitest.config.mjs` | 고치면 하네스의 동작이 바뀌는 것 |
| `specRoot` | `"harness"` | spec·QA 체크리스트가 사는 곳. 뒤에 `/` 를 붙이지 않는다 |
| `protectedBranches` | `["main", "dev", "master"]` | 직접 커밋을 막을 브랜치 |

> **무엇을 검사하는가**는 `package.json` 의 `scripts.test` 가 정하고, **어떤 명령을 부르는가**는 `gate` 가 정한다. 출처가 둘로 느는 것이 아니라 각각 한 곳씩 갖는다.

> **오타 난 설정은 조용히 기본값으로 돌아간다.** 훅에서 던지면 `PreToolUse` 가 죽어 차단이 아니라 **통과**가 되기 때문이다. `harness doctor` 로 확인해라.

### 테스트 러너에서 사본을 제외한다

**넣지 않으면 게이트가 배로 돈다** — 에이전트 사본 안의 테스트가 부모 실행에 다시 잡힌다(실측 172 → 344).

```js
// vitest.config.mjs
export default { test: { exclude: ["**/node_modules/**", "**/.claude/worktrees/**"] } };
```

```json
// jest (package.json 안에 설정이 있는 경우)
{ "jest": { "modulePathIgnorePatterns": ["<rootDir>/.claude/worktrees/"] } }
```

`**/` 접두어가 중요하다 — 사본이 중첩돼도 매칭된다.

## 매일 쓰는 명령

| 명령 | 언제 |
|---|---|
| `harness spawn "<사람의 원문>"` | 기능 요청이 왔을 때. 작업 세션을 새 탭에 띄운다 (Windows 전용) |
| `harness reap` | 한 task 의 push 직후, `ExitWorktree` **전에**. 회수가 끝난 사본을 거둔다 |
| `harness doctor` | 설정이 이 프로젝트에 맞는지 의심될 때 |
| `harness smoke` | 배선이 끊겼는지 의심될 때 |
| `harness sync` | 패키지를 올린 뒤 |

## 갱신

```sh
npm update @ksheyon123/harness-engineering
npx harness sync
```

**`npm update` 만으로는 부족하다.** A 에는 복사본이 산다 — `harness.md` · `planner-mode.md` · `agents/*.md` · shim 들. 그것들은 갱신되지 않으므로, 패키지만 올리면 **A 의 `developer` 는 옛 규약대로 돌고 훅은 새 규칙으로 판정한다.**

`sync` 는 하네스가 통째로 소유하는 것만 다시 쓴다. 병합해서 만든 것(`settings.json` · `.gitignore` · `package.json` · A 의 `CLAUDE.md`)은 손대지 않는다 — 그건 A 의 파일이고 하네스는 거기 몇 줄을 얹었을 뿐이다. 그리고 **A 가 손댄 파일은 덮지 않고 알린다**(설치 기록부의 해시로 판정한다).

## 막히는 자리

| 증상 | 원인 |
|---|---|
| `npm i` 가 404 | 갓 발행된 버전이면 CDN 부정 캐시다. `--prefer-online`, 그래도 안 되면 `npm cache clean --force` |
| Claude Code 가 하네스를 안 탄다 | `harness init` 을 안 돌렸거나, **세션을 새로 안 열었다**. `.claude/settings.json` 이 있는지부터 봐라 |
| `smoke` 가 `필요한 것이 전부 커밋된다` 로 ✗ | **처방을 그 ✗ 가 직접 찍는다.** `커밋해야` 면 커밋만 하면 되고, `git add -f` 면 그 경로가 `.gitignore` 에 걸린 것이라 `git add -A` 로는 **몇 번을 돌려도** 안 담긴다 |
| `.gitignore` 에 `.claude` 가 있는 저장소에 설치했다 | `init` 이 그 경로들을 `-f` 로 인덱스에 담아둔다(보고에 찍힌다). **커밋은 사람이 한다** |
| `init` 이 종료 코드 1 | 배선이 깨진 것이다 — 뒤에 붙은 `smoke` 출력의 ✗ 를 봐라. **커밋만 안 된 것은 1 이 아니다**(그건 0 + 안내다) |
| 첫 커밋이 막힌다 | 보호 브랜치 직접 커밋이다. **정상 동작** — 브랜치를 자르고 커밋해라 |
| `init` 이 멈추고 `core.hooksPath` 를 말한다 | 그 값이 `<A>/.githooks` 아닌 곳을 가리킨다(husky·lefthook 이 흔한 경우다). 빼앗지 않으므로 사람이 정한다 — 그쪽 훅에서 하네스의 `.githooks/` 훅을 직접 이어 붙이거나, 그쪽을 걷어내고 `git config --local --unset core.hooksPath` 한 뒤 `harness init` 을 다시 돌려라. **절대경로로 우리 `.githooks` 를 가리키는 것은 여기 해당하지 않는다** |
| `developer` 가 재시도만 태우고 red 로 끝난다 | 게이트가 없거나 안 돈다. `npm test` 를 직접 돌려봐라 — `Missing script: test` 면 `scripts.test` 부터 만든다 |
| 게이트가 두 배로 돈다 | 러너에서 `**/.claude/worktrees/**` 를 제외 안 했다 |
| 서브에이전트가 빈 브랜치만 남기고 끝났다 | 원인이 둘이다. **먼저 `smoke` 의 `신뢰` 항목을 봐라**(아래 행). 거기가 초록이면 승인 프롬프트에서 멈춘 것이다 — 멈춤은 종료가 아니라 `SubagentStop` 이 안 돌고, 게이트도 인계 커밋도 없다 |
| `smoke` 가 `신뢰 — 종료 훅이 등록될 수 있다` 로 ✗ | 저장소가 Claude Code 신뢰 목록에 없어 **frontmatter 훅이 등록조차 안 된다.** 실행 실패가 아니라 등록 누락이라 재시도 카운터도 `systemMessage` 도 안 남는다. **조상 폴더(`~/projects` 등)가 신뢰돼 있으면 다이얼로그가 안 뜨므로 스스로 낫지 않는다** — `~/.claude.json` 의 `projects["<이 저장소>"].hasTrustDialogAccepted` 를 직접 `true` 로 둬라 |

## 아직 안 되는 것

- **`spawn` 의 유닉스판이 없다.** Windows 밖에서는 작업 세션을 규약대로 띄울 수 없다. 직접 `claude` 를 열어 역할을 말로 심지 마라 — 그 세션은 `HARNESS_ROLE` 이 없어 자기를 실행자로 알고, 대화로 덮은 역할은 `/clear` 한 번에 사라진다
- **POSIX 실행권한이 검증되지 않았다.** `.githooks/pre-commit`·`pre-push` 의 실행 비트를 Windows 에서는 잴 수 없어 `smoke` 가 `?` 로 찍는다. 리눅스·맥에서 설치했다면 **층 2 가 붙었는지 직접 확인해라**
- 그 밖에 확인됐지만 안 고친 것은 [`backlog.md`](./backlog.md) 에 근거와 함께 있다

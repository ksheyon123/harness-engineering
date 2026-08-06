# 하네스 파이프라인 재검토 (2026-08-06)

**검토 기준: 보완·수정이 아니라 *사용법*.** "사람이 무엇을 치면, 무엇이 돌고, 어떤 문서를 읽고,
무엇이 남는가" 를 기획자 → 개발자 → QA → commit → push 전 구간에 걸쳐 추적한다.

검토 시점의 상태: 브랜치 `main`(`7b4b47e`), worktree 0개, `core.hooksPath=.githooks` 활성,
`claude` CLI PATH 에 있음, `node_modules` 설치됨.

> `BACKLOG.md` 는 검토 도중 `7b4b47e` 로 삭제됐다. 아래 인용 중 BACKLOG 항목(#1·#2·#7·#8·#9)은
> 삭제 직전 트리 기준이며, 근거로서의 사실관계는 코드와 커밋에 그대로 남아 있다.

---

## 1. 단계별 실행 추적

### 0단계 — 도입 (저장소당 1회)

| 사람이 치는 것 | 도는 것 | 읽는 문서 | 남는 것 |
|---|---|---|---|
| `npm install` | `package.json` `prepare` → `scripts/setup-githooks.mjs` | — | `git config core.hooksPath .githooks` |

멱등이고, `.git` 이 없으면 조용히 종료한다(tarball 의존성 설치를 막지 않기 위해).
**이 단계를 건너뛰면 `pre-commit`·`pre-push` 가 통째로 존재하지 않는다** — 게이트도 QA도 사라지는데
아무 경고가 없다. `.gitattributes` 의 `eol=lf` 가 셰뱅+CRLF 조합으로 worktree 게이트가 깨지던
문제(구 BACKLOG #8, P0)를 막는다.

---

### 1단계 — 기획자(planner), 현재는 `main` / 메인 체크아웃

#### 1-1. 세션 시작 시 자동 로드

| 문서 | 로드 조건 |
|---|---|
| `.claude/CLAUDE.md` | 항상 — 개발자 프로토콜 전문 |
| `.claude/rules/*.md` | `paths:` frontmatter 가 매칭되는 파일을 **읽을 때만**. `test-git.md` 는 `**/*.test.{ts,tsx,js,mjs}` |
| `.claude/settings.json` | 권한(`defaultMode: acceptEdits`, `allow: Bash`·`Edit(harness/**)`, `deny: rm -rf`·force push·`reset --hard`·`.env`) + 훅 등록 |

#### 1-2. 프롬프트마다 — `load-spec.mjs` (UserPromptSubmit, timeout 10s)

```
stdin JSON(cwd) → git rev-parse --abbrev-ref HEAD
                → <cwd>/harness/index.json
                → tasks[branch]
                   없음 → 소프트 경고만 주입
                   있음 → <cwd>/<specPath> 전문 + "개발자 역할" 지시문 주입
```

- **차단하지 않는다.** 모든 실패 경로가 `exit 0` (`load-spec.mjs:20,67`).
- 경로 기준이 **`cwd`** 다(`load-spec.mjs:43,58`). 하위 디렉터리에서 세션을 열면 spec 주입이 조용히 사라진다.
- **매 프롬프트마다 spec 전문이 다시 주입된다** → [논점 A](#논점-a--load-spec-의-매-턴-주입).

#### 1-3. planner 스폰

| 항목 | 값 |
|---|---|
| 정의 | `.claude/agents/planner.md` (`tools: Read, Grep, Glob, Write, Edit`, `model: sonnet`) |
| **Bash 없음** | 그래서 브랜치를 `.git/HEAD` 를 **Read** 해서 판별한다 (`planner.md:13`) |
| 읽는 것 | `.git/HEAD`, 기존 코드(Read/Grep/Glob 자유) |
| 쓰는 것 | `harness/<task>/spec.md` + `harness/index.json` 의 `tasks` 등록 |

#### 1-4. planner 의 Write 도 훅을 탄다 — `verify-branch.mjs`

`PreToolUse(Edit|Write)`. 판정 순서(`verify-branch.mjs:149-244`)와 **`main` 에서 실행했을 때의 결과**:

| # | 조건 | 결과 | `main` 에서 |
|:-:|---|---|---|
| 0 | 대상이 다른 워킹트리(같은 저장소) | **deny** | 해당 없음(`same`) |
| 0' | 대상이 다른 저장소 | ask | — |
| — | git 아님 / `index.json` 없음 | 통과 | — |
| 2 | 브랜치가 `main`/`dev`/`master` | **ask** | ← **여기서 반환** |
| 3 | 미등록 브랜치 | ask | 도달 못 함 |
| 4 | `harnessMetaPaths` 면제(루트 앵커링) | 통과 | 도달 못 함 |
| 5 | 등록 task + 메인 체크아웃 | **deny** | 도달 못 함 |

`settings.json` 에 `Edit(harness/**)` 가 allow 로 있어도 **훅의 `ask` 가 이긴다** — `main` 에서 spec 을
쓰는 동안 파일 편집마다 승인 프롬프트가 뜬다. 판정이 2에서 조기 반환되므로 면제 경로 판정(4)까지
가지도 않는다.

---

### 2단계 — worktree 생성

```sh
node scripts/worktree-add.mjs feat/<task> --launch
```

| 단계 | 동작 | 읽는 문서 |
|---|---|---|
| 인자 | `parseArgs` — `--seed` 의 값 토큰을 브랜치로 오인하지 않음. `--launch` 는 `--install` 을 함의 | — |
| 루트 | `git rev-parse --show-toplevel`, 실패 시 조용히 `exit 0` | — |
| 경로 | `worktreePathFor` → `../harness-engineering-<task>` → `assertOutsideRepo` | — |
| 설정 | `gate.mjs` 의 `loadConfig` 를 **import**(파서 사본 없음), **root 기준**으로 읽음 | `harness/config.json` → `baseBranch: "main"`, `installCommand` **미설정 → DEFAULTS `npm install`** |
| worktree | `git worktree list --porcelain` 파싱 → 같은 경로+브랜치면 **재사용**. 없으면 `resolveBaseRef`: `main` → `origin/main` 순, **둘 다 없으면 throw**(HEAD 로 물러서지 않음) | — |
| install | Windows 는 `powershell -NoProfile -Command "npm install"`(npm.cmd + MSYS native postinstall 회피). 실패해도 worktree 를 지우지 않음 | — |
| 경고 | `warnLaunchContext` — 미등록/spec 부재면 **경고만** | `harness/index.json`, spec 파일 존재 |
| launch | `cmd /c start "" powershell -NoExit -EncodedCommand <utf16le-base64>` → `Set-Location -LiteralPath '<path>'; claude '<task> 개발 진행 — 등록된 spec 대로 test-first 로 구현'` | — |

seed 는 `seedPromptFor(branch)` 로 유도하고 **spec 경로를 박지 않는다** — 새 세션의 `load-spec` 이
브랜치 기준으로 알아서 주입하기 때문이다.

---

### 3단계 — 개발자 세션 (worktree, 자율 구현)

**주입되는 것**: `.claude/CLAUDE.md` + `load-spec` 이 seed 프롬프트에 붙이는 spec 전문 +
`[하네스] 개발자 역할 … test-first 로 자율 구현하세요(기능 사이에 사용자에게 묻지 않음)`.

**개발자가 참조하는 것**

- 테스트를 어디에 쓸지 → `node scripts/gate.mjs --list` → `harness/config.json` 을 읽어
  `[gate] test  .  npx vitest run --passWithNoTests` 출력. **목록을 CLAUDE.md 에 복사하지 않는 것이
  핵심 규약**(구 BACKLOG #1: 문서 사본이 게이트보다 넓어 `apps/web` 테스트가 한 번도 안 돌았다).
- `.claude/rules/test-git.md` — `*.test.mjs` 를 읽는 순간 자동 로드.

**Edit/Write 마다 `verify-branch.mjs`** — worktree 정상 경로:

```
0. 대상 파일 nearestExistingDir → gitContext(top, common)
   세션과 common 같음 + top 같음 → "same"
2. feat/<task> — 보호 브랜치 아님
3. index.json 등록됨 → registered
4. scripts/… 는 harnessMetaPaths(harness/ .claude/ .githooks/ README.md BACKLOG.md)에 없음 → 면제 아님
5. git rev-parse --absolute-git-dir 에 "/worktrees/" 포함 → 링크드 worktree → 통과
6. exit 0 (조용히)
```

구 BACKLOG #7 에서 **`scripts/` 면제 요청은 기각됐다** — 이 저장소는 소스가 거의 전부 `scripts/` 라
면제하면 worktree 강제가 사라진다. worktree 안에서는 어차피 자유롭다.

> `PreToolUse` 매처가 `Edit|Write` 라, `Bash` 로 파일을 쓰는 경로(리다이렉션 등)는 이 게이트를 타지
> 않는다. `Bash` 는 `settings.json` 에서 통째로 allow 다.

---

### 4단계 — 객관 게이트 (자기 점검)

```sh
node scripts/gate.mjs
```

| 순서 | 동작 |
|:-:|---|
| 1 | `scrubGitEnv(process.env)` — **`GIT_` 접두어 전체 제거**. 훅 안에서 자식이 진짜 저장소의 `GIT_DIR` 을 상속해 저장소를 bare 로 재초기화하고 브랜치를 덮은 사고(구 BACKLOG #9)의 방어. denylist 가 아닌 접두어 전체인 이유는 개별 지정이 fail-open 이라서 |
| 2 | `repoRoot(env)` — cwd 의존 제거 |
| 3 | `harness/config.json` **부재 → 통과**(도입 초기 차단 방지) / **있는데 JSON 깨짐 → exit 1**(오타가 '게이트 없음' 으로 둔갑 금지) |
| 4 | `assertInsideRepo` — `dir` 이 저장소 밖이면 거부 |
| 5 | `mergeBase("main")` — `origin/main` → `main` 순 |
| 6 | `planGate` — 없는 `dir` 은 경고 후 skip, `{{BASE}}` 치환 불가 + `fallbackCmd` 없으면 skip |
| 7 | **typecheck 먼저, 하나라도 실패하면 test 는 안 돈다.** 이 저장소는 `typecheck: []`, `test: [{dir:".", cmd:"npx vitest run --passWithNoTests"}]` |
| 8 | `runOne` — `execSync(cmd, {cwd, env: scrubbed, stdio:"inherit"})`. 셸 경유는 Windows `npx.cmd` 때문 |

이 저장소의 `cmd` 에는 `{{BASE}}` 가 없어 **merge-base 는 계산만 되고 쓰이지 않는다** — 항상 전체
스위트가 돈다.

---

### 5단계 — QA (게이트 통과 후 · 커밋 전)

#### 5-1. 해시를 개발자가 먼저 계산한다

```sh
node .claude/hooks/qa-hash.mjs <현재-브랜치>   # 반드시 저장소 루트에서
```

| 읽는 것 | 용도 |
|---|---|
| `harness/config.json` | `testFilePatterns`·`skipDirs`. 없거나 깨져도 stderr 경고 후 DEFAULTS 로 진행(훅이 조용히 죽지 않게) |
| `harness/index.json` → spec 경로 → **spec 내용** | 해시 입력 |
| `.` 재귀 순회로 패턴 매칭된 **모든 테스트 파일의 경로+내용** | 해시 입력. 경로는 `\`→`/` 정규화(Windows/POSIX 해시 일치) |

stdout 에 sha256 만 나간다. **`.` 과 `harness/index.json` 이 상대경로라 cwd 에 의존한다** —
`CLAUDE.md` 가 "반드시 저장소 루트에서 실행" 을 명시적으로 경고하는 이유. 어기면 해시가 어긋나
push 가 한 번 막힌다.

#### 5-2. QA 서브에이전트 스폰

| 항목 | 값 |
|---|---|
| 정의 | `.claude/agents/qa.md` (`tools: Read, Grep, Glob, Write, Edit`, `model: haiku`) |
| **Bash 없음** | 테스트 실행 불가(자기채점 방지) + **해시 계산 불가** → 그래서 주입받는다 |
| 읽는 것 | `.git/HEAD` / `harness/index.json` / `harness/<task>/spec.md` / **`harness/config.json`**(`gate.test` 유무로 러너 판단 + `testFilePatterns`) / Glob 으로 테스트 파일 전부 |
| 쓰는 것 | `harness/<task>/qa-checklist.md` — frontmatter(`input_hash`/`generated`/`spec`) + 독립 도출 체크리스트 + 커버리지 매트릭스(`✅`/`△`/`❌`) |

QA 의 Write 도 `verify-branch` 를 탄다 → 대상이 `harness/` → 면제(4) → 통과.

**독립 도출이 이 역할의 전부다** — spec 을 베끼지 않고 *검증돼야 할 것* 을 스스로 열거해야 기획
spec 자체의 누락이 드러난다. 그래서 새 컨텍스트(서브에이전트)여야 한다. 구 BACKLOG #2 가 고친 것은
`qa.md` 에 남아 있던 "이 저장소는 테스트 러너가 없으니 커버리지를 전부 ❌ 로 적어라" 는 **동작하는
오지시**였다. 지금은 사실 주장이 아니라 **조건부 규칙**이다.

#### 5-3. 이후 금지사항

해시를 계산한 뒤 **테스트/spec 파일을 더 바꾸지 않는다.** 바꾸면 pre-push 에서 해시 불일치 →
headless QA 재생성 → 미커밋 차단 → push 가 한 번 막힌다.

---

### 6단계 — 커밋

```sh
git add -A
git commit -F <임시메시지파일>     # PowerShell here-string 이 ';' 로 깨지므로 파일 경유
```

`.githooks/pre-commit`:

| 순서 | 동작 |
|:-:|---|
| — | `say()` 헬퍼 = **서브셸**. 훅이 자기 출력 때문에 SIGPIPE 로 죽어 `exit 1` 에 도달하지 못하고 **막아야 할 커밋이 조용히 통과한 사고**가 실제로 있었다 |
| 0 | `git diff --quiet` — **부분 스테이징 거부**. 훅은 워킹트리를 검사하는데 커밋되는 건 인덱스라, 다르면 거짓 통과. stash 복원(작업 손실 위험) 대신 거부 |
| 1 | `node scripts/gate.mjs` — 실패 시 `exit 1`, 워킹트리는 보존 |
| 2 | `git write-tree` → `$(git rev-parse --absolute-git-dir)/harness-gate-tree`. 커밋 해시가 아니라 **트리** 해시인 이유: 이 시점엔 커밋이 없고, 게이트가 검증한 건 히스토리가 아니라 내용. git-dir 이 worktree 마다 달라 마커도 자동 분리 |

커밋 단위는 **spec 1개 = 1커밋**(코드 + 테스트 + `qa-checklist.md`).

---

### 7단계 — push

```sh
git push -u origin <작업브랜치>
```

`.githooks/pre-push`:

| 순서 | 동작 | 정상 경로 |
|:-:|---|---|
| 0 | `cd $ROOT` — 이 덕에 이후 `qa-hash.mjs` 의 cwd 의존이 여기선 문제가 안 된다 | |
| 1 | `HEAD^{tree}` == 마커? → **게이트 생략**. 다르면 `gate.mjs` 재실행, 실패 시 `exit 1` | ✅ 생략 |
| 2 | `node -e require('./harness/index.json').tasks[BRANCH]` → **spec 없으면 QA 생략, push 허용** | spec 있음 |
| 3 | `qa-hash.mjs` vs `qa-checklist.md` 의 `input_hash`(sed 추출) → **같으면 QA 생략, `exit 0`** | ✅ **여기서 끝** |
| 4 | `claude` CLI 없으면 QA 생략, push 허용 | 도달 안 함 |
| 5 | headless QA: `claude -p "…역할은 .claude/agents/qa.md 에 정의돼 있다. 먼저 Read 하라…" --model haiku --permission-mode acceptEdits --allowedTools "Read,Grep,Glob,Edit,Write" --disallowedTools "Bash" --output-format text < /dev/null`. `< /dev/null` 은 pre-push 가 ref 를 stdin 으로 넘기기 때문에 필수. **실패해도 push 를 막지 않는다** | 도달 안 함 |
| 6 | 패키징 게이트: `git status --porcelain "$QA"` 가 비어있지 않으면 `exit 1` | 도달 안 함 |

**게이트를 pre-push 에서 없애지 않는 이유**: rebase·자동 머지는 pre-commit 을 실행하지 않는다.
각각은 통과하지만 합치면 깨지는 semantic conflict 는 커밋 시점에 존재하지 않아 pre-commit 이
원리적으로 못 잡는다. 마커가 없거나 다르면 **안전 기본값 = 실행**.

**5단계에서 세션이 QA 를 미리 만들고 해시를 주입한 것이 정상 경로다** — 그래야 push 가 3번에서 끝나
한 번에 성공한다. 5·6 은 그 경로를 안 밟았을 때의 안전망이고, 최악의 경우 push 시도가 2회로 늘어난다.

---

### 8단계 — 세션 종료 / 사람

`SessionEnd` → `session-cost.mjs` → `transcript_path` + `<sid>/subagents/*.jsonl` 을 읽어
`message.id` 로 dedup 집계 → `systemMessage` 요약 + `~/.claude/projects/<cwd-slug>/session-costs.log`
append. **읽기 전용, 항상 `exit 0`.** worktree 세션은 slug 가 달라 로그가 그쪽에 남고,
`scripts/token-usage.mjs` 가 메인+worktree slug 를 합산한다.

이후는 전부 사람: PR 리뷰 → 머지 → `git worktree remove <path>`(비가역이라 자동화 안 함).

---

## 2. 관찰 — 사용법 기준

### 2-1. 구조적 갭

**① `main` 에서 시작하는 구간이 프로토콜의 사각지대다.**
1단계 전체(planner 실행 → spec 작성 → index 등록 → **커밋**)가 `main` 에서 일어나는데,
`CLAUDE.md` 의 개발자 프로토콜은 `main` 커밋을 금지하고 `verify-branch` 는 `ask` 로 마찰만 준다.
실제 이력은 `main` 직접 커밋으로 돌아가고 있다:

```
c40d576 docs(harness): worktree-config spec 작성 + task 등록          ← main
2ff6424 docs(harness): BACKLOG #9(P0) 등록 + gate-env-isolation spec 작성 ← main
```

`harnessMetaPaths` 면제는 **편집**에만 적용되고 커밋에는 관여하지 않으며, `pre-commit` 은 브랜치를
아예 보지 않는다(게이트만 본다). **문서·훅·운영이 세 갈래다.** → [논점 B](#논점-b--spec-작성을-worktree-로-옮길-것인가)

**② spec 커밋 → worktree 생성의 순서 의존이 어디에도 없다.**
`worktree-add.mjs` 가 `baseBranch` 에서 분기하므로 spec 이 커밋 전이면 새 worktree 에는 spec 도
index 항목도 없다. 새 세션은 spec 없이 시작하는데, `warnLaunchContext` 는 **메인 체크아웃 기준**으로
검사하므로 **경고조차 뜨지 않는다**(메인엔 파일이 있으니까). README §2 플로우 다이어그램에도 이
커밋 단계가 없다. 실패가 조용한 종류다.

**③ planner 의 `<task>` 유도 규칙이 정규 흐름에서 성립하지 않는다.**
`planner.md:12` 는 "`<task>` 는 현재 git 브랜치에서 유도한다(`feat/oauth-fix` → `harness/oauth-fix/`)"
인데, 정규 흐름에서 planner 는 **작업 브랜치가 아직 없는 `main`** 에서 돈다. `main` 은 detached 도
아니고 불명확하지도 않아 `planner.md:13` 의 "물어본다" 분기에도 안 걸린다 — 규칙대로면
`harness/main/spec.md` 를 만들고 `index.json` 에 `"main": …` 을 등록한다. 그러면 `load-spec` 이 main
세션에 spec 을 주입하고 `verify-branch` 가 `main` 을 registered 로 취급하기 시작한다.
지금은 사람이 이름을 말해줘서 우회되고 있고, **그 절차가 문서에 없다.**

**④ 두 QA 경로가 비대칭이다.**
세션 스폰(Agent 도구, `qa.md` 가 시스템 프롬프트로 주입)과 pre-push headless(`claude -p`, 프롬프트에서
`qa.md` 를 **Read 하도록 지시**)는 역할 정의 전달 방식이 다르다. 후자는 `claude` PATH + 인증 토큰이
필요하고, 없으면 **비차단으로 조용히 건너뛴다**. 설계 의도(비차단)와 일치하지만 "QA 가 돌았는지" 는
push 출력을 봐야만 안다.

**⑤ cwd 기준이 파일마다 다르다.**

| 파일 | 기준 | 하위 디렉터리에서 실행하면 |
|---|---|---|
| `load-spec.mjs` | **cwd** | spec 주입이 조용히 사라짐 |
| `qa-hash.mjs` | **cwd**(상대경로) | 해시 불일치 → push 1회 차단 |
| `verify-branch.mjs` | `session.top` | 영향 없음 |
| `gate.mjs` | `repoRoot()` | 영향 없음 |
| `worktree-add.mjs` | `repoRoot` | 영향 없음 |

`CLAUDE.md` 는 `qa-hash` 에 대해서만 경고한다.

**⑥ `verify-branch` 는 `Edit|Write` 만 매칭한다.**
`Bash` 는 통째로 allow 라, 셸 리다이렉션으로 파일을 쓰면 worktree 강제·보호 브랜치 판정을 전부
우회한다. 도구를 정상적으로 쓰면 안 부딪히는 종류의 구멍이다.

**⑦ 게이트가 항상 전체 스위트를 돈다.**
`config.json` 의 `cmd` 에 `{{BASE}}` 가 없어 `mergeBase` 는 계산만 되고 버려진다. 지금 규모에선
무해하지만 `--changed` 최적화 경로가 비활성이라는 건 알고 쓰는 게 낫다.

**⑧ 문서 링크가 끊겼다.**
`BACKLOG.md` 삭제(`7b4b47e`) 후에도 `README.md` 서두와 §알려진 제약이 `./BACKLOG.md` 를 가리키고,
`harness/config.json` 의 `harnessMetaPaths` 에도 `BACKLOG.md` 가 남아 있다.

### 2-2. 잘 작동하는 것

| 장치 | 막는 실패 |
|---|---|
| 게이트 대상의 단일 출처(`config.json` 하나를 세션·pre-commit·pre-push·QA 가 참조) | 문서 사본이 게이트보다 넓어 테스트가 한 번도 안 도는 상태 |
| 트리 해시 마커 | push 시 게이트 중복 실행 |
| 입력 해시 스킵 | LLM 비결정성으로 인한 "재생성 → 차단 → 재push" 무한 루프 |
| `say()` 서브셸 | 훅이 SIGPIPE 로 죽어 막아야 할 커밋이 통과 |
| `scrubGitEnv` 접두어 전체 제거 | 테스트가 진짜 저장소를 조작 |
| `pre-commit` 의 부분 스테이징 거부 | 검사한 트리 ≠ 커밋되는 트리 |

다섯 개 모두 **실제로 터진 사고를 겪고 난 뒤** 들어갔고, 각각이 막는 실패 모드가 근거와 함께 코드
주석에 남아 있다. 이 점이 이 하네스의 가장 큰 자산이다.

---

## 3. 열린 논점 (결정 필요)

### 논점 A — `load-spec` 의 매 턴 주입

**현상**: `UserPromptSubmit` 은 매 프롬프트마다 돌고, 그때마다 spec **전문**을 주입한다.

**캐시 영향은 우려만큼 크지 않다.** 주입된 컨텍스트는 *새 사용자 턴의 끝*에 덧붙는다. 프롬프트
캐시는 안정된 접두부(system + `CLAUDE.md` + 기존 히스토리)에 걸리므로 **접두부가 무효화되지는
않는다** — "매번 캐싱을 새로 한다" 는 아니다.

**실제 비용은 두 가지다.**

1. **누적 중복.** spec 이 턴마다 히스토리에 한 벌씩 쌓인다. 40턴이면 40벌이고, 캐시 read 단가가 싸도
   **컨텍스트 윈도우는 실제로 채워진다.**
2. **버전 혼재(이쪽이 더 위험).** 세션 도중 spec 을 고치면 히스토리에 **옛 spec 과 새 spec 이 함께
   남는다.** 모델이 어느 쪽을 유효한 것으로 볼지 보장이 없다. spec 개정이 잦은 워크플로에서는
   조용한 오작동이 된다.

**선택지**

| 안 | 내용 | 비용 |
|---|---|---|
| A1 | 현행 유지 | 위 두 비용 감수 |
| A2 | 첫 턴만 전문 주입, 이후는 "spec: `<경로>`" 한 줄 | 세션이 spec 을 잊으면 Read 필요 |
| A3 | 내용 해시를 비교해 **변경됐을 때만** 전문 재주입 | 훅이 세션별 상태를 들고 있어야 함(파일/캐시) |
| A4 | 항상 한 줄 포인터 + `CLAUDE.md` 가 "먼저 spec 을 Read 하라" 지시 | 주입 보장이 사라짐(개발자가 안 읽을 수 있음) |

A3 가 두 비용을 모두 없애지만 훅에 상태가 생긴다. A2 는 단순하고 (1)을 거의 없애지만 (2)는 남는다.

---

### 논점 B — spec 작성을 worktree 로 옮길 것인가

**제안**: 논의가 끝나면 먼저 `node scripts/worktree-add.mjs feat/<task>` 로 worktree 를 만들고,
**그 worktree 에서** planner 를 돌려 spec 을 쓰고 커밋한다.

#### 얻는 것

1. **관찰 ① 이 소멸한다.** spec 커밋이 `main` 이 아니라 task 브랜치에 떨어진다 — `CLAUDE.md` 의
   "`main` 직접 커밋 금지" 와 운영이 처음으로 일치한다.
2. **관찰 ② 가 소멸한다.** spec·index·코드·테스트·qa-checklist 가 **같은 브랜치 위에** 쌓이므로
   "spec 을 먼저 커밋해야 worktree 가 본다" 는 순서 의존 자체가 사라진다. README §2 가 약속한
   "브랜치마다 산출물 4종" 이 비로소 문자 그대로 성립한다.
3. **관찰 ③ 이 소멸한다.** worktree 는 브랜치명을 먼저 정하고 만들어지므로, planner 가 `feat/<task>`
   위에서 돌게 되고 `planner.md:12` 의 "브랜치에서 유도" 규칙이 **문서 그대로 맞아떨어진다.**
4. **`index.json` 병렬 편집 규약이 느슨해진다.** 각 브랜치가 자기 항목만 추가하고 머지 때 합쳐지므로,
   "한 시점에 한 세션만 등록" 이라는 수동 규약의 압력이 줄어든다(같은 파일이라 충돌 가능성은 남는다).

#### 부딪히는 것

1. **spec 작성 시점에는 아직 미등록 브랜치다.** `verify-branch` 판정 3에서 **`ask`** 가 뜬다.
   `main` 에서의 `ask`(판정 2)와 횟수는 비슷하지만 성격이 다르다 — 등록이 끝나면 이후 편집은 완전
   무마찰이 된다(판정 5 통과). `main` 쪽은 끝까지 `ask` 다.
2. **`worktree-add.mjs` 가 경고를 낸다.** `warnLaunchContext` 가 "`<branch>` 는 index.json 에 등록돼
   있지 않습니다" 를 출력한다. 이 흐름에선 **정상**인데 경고가 뜬다 → 노이즈.
3. **spec 만 커밋한 상태로 push 하면 pre-push 가 막는다(가장 실질적).**

   ```
   1. 트리 마커 일치 → 게이트 생략 ✅
   2. spec 있음 → 계속
   3. qa-checklist.md 없음 → OLD_HASH="" → 해시 스킵 조건 불성립
   4. claude CLI 있음
   5. headless QA 실행 — 테스트가 아직 없으니 커버리지 전부 ❌ 인 매트릭스 생성
   6. 패키징 게이트: 그 파일이 미커밋 → exit 1 (push 차단)
   ```

   즉 **spec 리뷰용 push 를 하려면 push 2회 + 쓸모없는 초기 QA 매트릭스 커밋**을 감수해야 한다.
   현행 `main` 커밋 방식에는 이 문제가 없다(`main` 은 `index.json` 에 없으므로 pre-push 2번에서
   "등록된 spec 없음 → QA 생략" 으로 빠진다).

   → 해결하려면 pre-push 가 "구현 전(spec 만 있는 커밋)" 을 구분해야 하는데, 그 판단 기준을 무엇으로
   둘지가 새 설계 문제다. 아니면 **spec 커밋을 push 하지 않고 로컬/worktree 에서 검토**하는 운영으로
   피한다 → [논점 C](#논점-c--사람-검토-게이트의-위치) 와 직결된다.

#### 판단

**방향은 B 가 맞다** — 관찰 ①②③ 세 개를 동시에 없애고, 문서가 이미 약속한 모델("브랜치마다 산출물
4종")에 코드를 맞춘다. 걸림돌 1·2 는 사소하고, **3만이 실제 결정 사항**이다. 3의 답은 논점 C 에서
"사람 검토를 어디서 하느냐" 를 정하면 따라 나온다.

---

### 논점 C — 사람 검토 게이트의 위치

**현행**: planner 가 spec 을 `main` 에 커밋·push → 사람이 원격에서 검토 → 개발자(AI)에게 작업 요청.

이 구조에는 명시되지 않은 성질이 둘 있다.

- **검토가 비공식이다.** spec 이 `main` 에 직접 들어가므로 PR 이 없다. 검토는 "사람이 봤다" 는
  사실로만 존재하고 산출물에 흔적이 남지 않는다.
- **검토 게이트가 파이프라인 밖에 있다.** 하네스는 "사람의 머지 결정이 유일한 권위 게이트" 라고
  선언하는데, 실제로는 **머지 전에 사람 게이트가 하나 더 있다**(spec 검토). 설계 문서에 이 게이트가
  없다.

**선택지**

| 안 | 흐름 | 사람 검토 지점 | 산출물 |
|---|---|---|---|
| C1 (현행) | main 에서 spec 작성·커밋·push → 검토 → worktree → 개발 → PR | spec push 후(비공식) + 최종 PR | spec 은 main 에, 나머지는 브랜치에 |
| C2 | worktree 에서 spec 작성·커밋(**push 안 함**) → 사람이 로컬 검토 → 같은 세션이 개발 → 한 번에 push → PR | spec 커밋 직후(로컬) + 최종 PR | 4종 전부 한 브랜치 |
| C3 | worktree 에서 spec 작성·커밋·push → **spec PR** → 사람 승인 → 개발 → 같은 PR 에 이어 붙임 | spec PR(공식) + 최종 PR | 4종 전부 한 브랜치, 검토가 기록됨 |
| C4 | spec 전용 브랜치(`spec/<task>`) → main 머지 → `feat/<task>` worktree | spec PR(공식) | spec 은 main, 나머지는 브랜치 |

- **C2** 는 논점 B 의 걸림돌 3을 **운영으로 회피**한다(push 를 안 하니 pre-push 가 안 돈다).
  가장 가볍고, 지금 구조에 코드 변경 없이 바로 적용 가능하다. 대신 검토가 여전히 비공식이고,
  사람이 그 worktree 디렉터리를 직접 열어야 한다.
- **C3** 은 검토를 공식화하지만 걸림돌 3을 정면으로 만난다 — pre-push 에 "구현 전 push" 개념을
  넣거나, 초기 QA 매트릭스 커밋을 감수해야 한다.
- **C4** 는 검토가 깔끔하지만 브랜치·worktree 를 두 번 만들어 무겁고, 관찰 ② (순서 의존)가 되살아난다.

**결정에 필요한 질문**: spec 검토 기록이 **남아야 하는가**?
- 남지 않아도 된다 → **C2**. 지금 당장 채택 가능하고 관찰 ①②③이 사라진다.
- 남아야 한다 → **C3**, 그리고 pre-push 의 "구현 전" 판단을 설계해야 한다.

---

### 논점 D — 머지 게이트가 **거부**했을 때의 경로가 없다

하네스는 "사람의 머지 결정이 유일한 권위 게이트" 라고 선언한다. 그런데 파이프라인은 spec → 구현 →
QA → push → 머지의 **일방향**이고, 그 게이트가 *통과시키지 않았을 때* 무슨 일이 일어나는지가
설계 어디에도 없다. 실제로 가장 흔한 사건인데도 그렇다.

사람이 PR 에서 "이 기능이 빠졌다" 고 했을 때 필요한 것들:

| 필요한 것 | 현재 상태 |
|---|---|
| 지적 내용이 개발자 세션에 들어오는 경로 | **없다.** `load-spec` 은 spec 만 주입한다. PR 코멘트를 읽는 장치가 없다 |
| 원래 세션의 컨텍스트 | **소실됐다.** push 후 세션이 끝났으면 새 세션은 "무엇을 왜 그렇게 했는지" 를 모른다 |
| worktree | 사람이 `git worktree remove` 했으면 재생성해야 한다. 안 지웠으면 남아 있다 |
| spec 갱신 여부 | `CLAUDE.md` 의 doc-before-code 는 "리비전·후속 수정도 코드보다 spec 을 먼저 확정" 이라고 한다 → planner 를 다시 돌려야 하는가? |
| QA 재실행 | spec 이나 테스트를 고치면 `input_hash` 가 바뀌므로 QA 재생성이 **자동으로 걸린다**(pre-push 5·6). 이건 잘 작동한다 |

**결정할 것**: 리비전을 ① spec 을 고쳐 같은 브랜치에서 이어가는가, ② 새 spec/새 브랜치로 분리하는가,
③ 지적 내용을 무엇으로 세션에 전달하는가(사람이 붙여넣기 / PR 코멘트를 읽는 장치 / spec 에 추가 기능으로 기술).

세 번째가 핵심이다. ①/②는 규약으로 정하면 되지만, **지적 내용의 전달 경로만은 장치가 필요하다** —
지금은 사람이 새 세션에 수동으로 설명하는 것이 유일한 방법이고, 그 순간 "문서 주도" 가 끊긴다.

---

### 논점 E — QA 산출물이 실제로 읽힌다는 보장이 없다

2층(주관) 검증의 출력은 `qa-checklist.md` 의 `❌`/`△` 행이고, 설계는 그것을 "사람에게 올라가는
결정 큐" 라고 부른다. **그런데 큐가 어디에도 올라가지 않는다.** 파일이 브랜치에 커밋될 뿐이고,
PR 본문에 자동으로 붙지도, 알림이 가지도 않는다. 사람이 그 파일을 열어야만 존재한다.

소비되지 않는 출력을 내는 층은 실질적으로 존재하지 않는 것과 같다. 비용(headless haiku 호출 + 커밋
1개)은 매번 든다.

**선택지**: ① 현행 유지(사람이 PR 에서 파일을 연다는 규율에 의존) / ② push 후 PR 생성 시 `❌`·`△`
행만 뽑아 PR 본문에 자동 삽입 / ③ 세션의 최종 보고에 QA 갭을 반드시 요약(지금도 `CLAUDE.md` 가
"QA 결과" 보고를 요구하지만 형식이 없다).

---

### 논점 F — 모든 강제가 로컬 훅이다

`pre-commit`·`pre-push` 는 전부 로컬 git 훅이고 `core.hooksPath` 설정에 의존한다.

- `git commit --no-verify` / `git push --no-verify` 로 **전부 우회된다.**
- `npm install` 을 안 한 클론에는 훅이 아예 없다(0단계 참고 — 경고도 없다).
- 원격에는 아무 검증이 없다. **"사람 머지가 유일한 권위 게이트" 인데 머지 시점의 CI 가 없다.**

`pre-push` 의 트리 마커 불일치 → 게이트 재실행이 이 공백을 부분적으로 메우지만, push 자체를
우회하면 끝이다.

**결정할 것**: 하네스가 *신뢰 기반* 을 유지할 것인가(현행 — 우회는 사람의 책임), 아니면 CI 를 붙여
원격에서도 게이트를 돌릴 것인가. 후자면 `gate.mjs` 하나만 부르면 되므로 비용은 낮다.

---

### 논점 G — `index.json` 은 브랜치:spec 1:1 인데 문서는 다중 spec 을 말한다

`harness/index.json` 의 `tasks` 는 `"<branch>": "<spec 경로 문자열>"` — **브랜치당 spec 하나**다.
그런데 `CLAUDE.md` 는 "여러 spec 을 한 세션에서 진행하면 spec 마다 커밋한다" 고 한다. 자료구조상
한 브랜치에 spec 은 하나뿐이므로, 이 문장이 성립하려면 한 세션이 브랜치를 갈아타야 한다 —
worktree 1개 = 세션 1개 = 브랜치 1개 규약과 정면으로 어긋난다.

**결정할 것**: 이 문장이 ① 낡은 잔재라 지울 것인지, ② `tasks` 를 배열로 넓혀 실제로 지원할 것인지.
①이면 한 줄 삭제로 끝난다. 관련해서 **커밋 단위가 spec 1개(= 기능 여러 개)** 라 리뷰 단위가 커지는
문제도 같이 볼 만하다 — 기능마다 커밋하지 않는 이유가 문서에 없다.

---

### 논점 H — 보호 브랜치 목록이 `config.json` 과 이중 출처다

`verify-branch.mjs:30` 은 `["main", "dev", "master"]` 를 **하드코딩**한다. 한편 분기 기준은
`config.json` 의 `baseBranch` 다. 이 저장소는 `baseBranch: "main"` 이라 우연히 겹치지만, 도입
프로젝트가 `baseBranch: "develop"` 으로 두면 **`develop` 은 보호되지 않는다** — 훅이 그 이름을 모른다.
반대로 이 저장소는 쓰지도 않는 `dev`·`master` 를 보호하고 있다.

이 저장소의 원칙("낡은 사본은 없는 것보다 나쁘다", 게이트 대상을 단일 출처로 모은 구 BACKLOG #1)에
그대로 걸리는 패턴이다. 같은 결로 **QA 모델도 두 곳에 적혀 있다** — `agents/qa.md` 의
`model: haiku` 와 `pre-push` 의 `--model haiku`. 한쪽만 바꾸면 두 QA 경로가 다른 모델로 돈다.

**결정할 것**: 보호 브랜치를 `config.json` 으로 뺄 것인가(`baseBranch` 를 자동 포함 + 추가 목록).
QA 모델을 어느 한 곳으로 모을 것인가.

---

### 논점 I — QA 모델이 haiku 로 고정돼 있다

"기능 체크리스트를 spec 으로부터 **독립 도출**한다" 는 것은 이 하네스에서 판단력이 가장 많이 필요한
작업이다(기획 spec 의 누락까지 잡아내는 것이 목적이므로). 그 일을 가장 작은 모델이 한다.

비용 대 품질의 의도적 선택일 수 있으나, 근거가 문서에 없다. **QA 가 얕으면 `✅ covered` 가 늘어나고,
그건 사람에게 "덮여 있다" 는 틀린 신호가 된다** — 구 BACKLOG #2 가 고친 실패 방향과 같은 종류다
(없는 것을 없다고 적는 것과, 확인하지 않고 있다고 적는 것은 다르다).

**결정할 것**: 현행 유지 / spec 규모에 따라 모델을 올릴 것인가 / 최소한 근거를 문서에 남길 것인가.

---

### 논점 J — 잔여 작업 목록의 자리가 비었다

`BACKLOG.md` 삭제로 "다음에 무엇을 할지" 를 담던 문서가 사라졌다. README §12 는 완료된 spec 목록만
있고, 미해결 항목(구 #6 doggy rules)이 갈 곳이 없다. 이 문서(`pipeline-review.md`)가 그 자리를
대신할 것인지, BACKLOG 를 되살릴 것인지, 아니면 논점을 spec 으로 바로 승격시킬 것인지를 정해야
README 의 끊긴 링크(관찰 ⑧)도 함께 해소된다.

---

## 4. 부록 — 파일별 책임

| 파일 | 트리거 | 읽는 것 | 차단 |
|---|---|---|:-:|
| `.claude/hooks/load-spec.mjs` | UserPromptSubmit | `index.json`, spec | ❌ |
| `.claude/hooks/verify-branch.mjs` | PreToolUse(Edit\|Write) | `index.json`, `config.json`, git 컨텍스트 | ✅ deny/ask |
| `.claude/hooks/qa-hash.mjs` | 수동 / pre-push | `config.json`, `index.json`, spec, 테스트 파일 | ❌ |
| `.claude/hooks/session-cost.mjs` | SessionEnd | transcript jsonl | ❌ |
| `scripts/gate.mjs` | 수동 / pre-commit / pre-push | `config.json` | ✅ exit 1 |
| `scripts/worktree-add.mjs` | 수동 | `config.json`, `index.json` | ❌ (경고만) |
| `scripts/setup-githooks.mjs` | `npm install` | — | ❌ |
| `scripts/token-usage.mjs` | 수동 | transcript jsonl | ❌ |
| `.githooks/pre-commit` | `git commit` | — (gate.mjs 위임) | ✅ |
| `.githooks/pre-push` | `git push` | `index.json`, `qa-checklist.md` | ✅ |
| `.claude/agents/planner.md` | 수동 스폰 | `.git/HEAD`, 코드 | — |
| `.claude/agents/qa.md` | 세션 스폰 / pre-push headless | `.git/HEAD`, `index.json`, spec, `config.json`, 테스트 | ❌ |

# 하네스 파이프라인 해부 (2026-08-06)

**이 문서의 기준: 코드.** `README.md` 는 설계 의도와 근거를, `harness/pipeline-review.md` 는
사용 흐름과 미결 논점을 담는다. 이 문서는 세 번째 축이다 — **각 프로세스가 어떤 훅을 부르고,
어떤 값을 읽고, 어느 분기점에서 무엇을 선택하는가**를 실제 구현에서 그대로 옮긴다.

검토 시점 상태: 브랜치 `main`(`cb74dd8`), `core.hooksPath=.githooks` 활성, worktree 2개
(`-base-branch-single-source`, `-spec-in-worktree`), `gate --list` = `test . npx vitest run --passWithNoTests`.

> 모든 서술은 파일:줄 로 근거를 단다. 근거 없는 문장은 이 문서에 넣지 않는다 —
> 이 저장소가 반복해 겪은 실패 모드가 "강제되지 않는 사본"이기 때문이다.

---

## 0. 구성요소 한눈에

| # | 장치 | 트리거 | 종류 | 차단력 |
|:-:|---|---|---|:-:|
| 1 | `.claude/hooks/load-spec.mjs` | `UserPromptSubmit` (timeout 10s) | Claude 훅 | ❌ 주입만 |
| 2 | `.claude/hooks/verify-branch.mjs` | `PreToolUse` matcher `Edit\|Write` (10s) | Claude 훅 | ✅ deny / ⚠ ask |
| 3 | `.claude/hooks/session-cost.mjs` | `SessionEnd` (15s) | Claude 훅 | ❌ 기록만 |
| 4 | `.githooks/pre-commit` | `git commit` | git 훅 | ✅ exit 1 ×3 |
| 5 | `.githooks/pre-push` | `git push` | git 훅 | ✅ exit 1 ×2 |
| 6 | `scripts/gate.mjs` | 수동 / 4 / 5 | 스크립트 | ✅ exit 1 |
| 7 | `.claude/hooks/spec-lock.mjs` | 4 가 파이프로 호출 | 판정 CLI | ✅ exit 1 |
| 8 | `.claude/hooks/qa-hash.mjs` | 수동 / 5 | 산출 CLI | ❌ |
| 9 | `scripts/worktree-add.mjs` | 수동 | 스크립트 | ❌ (경고만) |
| 10 | `scripts/setup-githooks.mjs` | `npm install` (`prepare`) | 스크립트 | ❌ |
| 11 | `.claude/agents/planner.md` | 세션이 Agent 도구로 스폰 | 서브에이전트 | — |
| 12 | `.claude/agents/qa.md` | 세션 스폰 / 5 의 headless | 서브에이전트 | ❌ |

**설정 파일은 둘, 파서는 하나.** `harness/config.json` 과 `harness/index.json` 이고,
파싱은 `gate.mjs` 의 `loadConfig` 하나뿐이다 — `verify-branch.mjs:27`, `worktree-add.mjs:14`,
`qa-hash.mjs:16` 이 전부 그것을 import 한다(사본 없음).

---

## P0 — 도입 (`npm install`)

| 항목 | 값 |
|---|---|
| 트리거 | `package.json:8` `"prepare": "node scripts/setup-githooks.mjs"` |
| 읽는 값 | `git config --get core.hooksPath` |
| 쓰는 값 | `git config core.hooksPath .githooks` |

**분기 (`setup-githooks.mjs:14-40`)**

```
git rev-parse --is-inside-work-tree
   실패 ─▶ exit 0                        (tarball 설치 등 — 설치를 절대 막지 않는다)
   성공
     │
   현재 core.hooksPath == ".githooks" ?
     예 ─▶ exit 0 (멱등, 무출력)
     아니오 ─▶ git config core.hooksPath .githooks
                 실패 ─▶ console.warn 후 계속 (설치를 막지 않는다)
```

> **이 단계를 건너뛰면 pre-commit·pre-push 가 통째로 존재하지 않고, 아무 경고도 없다.**
> 게이트와 QA가 함께 사라지는데 세션은 그 사실을 알 수 없다.

`.gitattributes` 의 `eol=lf` 가 함께 필요하다 — 셰뱅(`#!/bin/sh`) + CRLF 조합이면 훅이 실행되지 않는다.

---

## P1 — 디스패처 (`main` 체크아웃 세션)

여기서 하는 일은 셋뿐이다: **요구사항 논의 → 브랜치명 확정 → `worktree-add --launch`**.

세션 시작 시 자동 로드되는 것:

| 문서 | 로드 조건 |
|---|---|
| `.claude/CLAUDE.md` | 항상 |
| `.claude/rules/test-git.md` | `paths:` 가 `**/*.test.{ts,tsx,js,mjs}`·`**/*.spec.…` → **그 파일을 읽을 때만** |
| `.claude/settings.json` | 권한(`defaultMode: acceptEdits`, allow `Bash`·`Edit(harness/**)`, deny `rm -rf*`·`git push --force*`·`git push -f*`·`git reset --hard*`·`.env` 읽기) + 훅 등록 |

**main 에서 파일을 편집하면 무슨 일이 일어나는가** → P3(verify-branch) 판정 2 에서 `ask`.
`settings.json` 의 `allow: Edit(harness/**)` 이 있어도 **훅의 ask 가 이긴다.**

---

## P2 — worktree 생성 (`scripts/worktree-add.mjs`)

```sh
node scripts/worktree-add.mjs <branch> [--from <b>] [--install] [--launch] [--seed "…"]
```

### 값의 흐름

| 값 | 출처 | 쓰이는 곳 |
|---|---|---|
| `branch` | argv 첫 비플래그 토큰 (`parseArgs:250`) | 브랜치 생성 · 경로 · seed |
| `from` | `--from <v>` / `--from=<v>` | `baseForNewBranch` — **`baseBranch` 를 이긴다** |
| `seed` | `--seed <v>` / `--seed=<v>` | 있으면 `seedPromptFor` 를 **항상 이긴다** (`:518`) |
| `root` | `git rev-parse --show-toplevel` | 설정·경로 기준 (cwd 비의존) |
| `config.baseBranch` | `harness/config.json` → `"main"` | 분기 기준 |
| `config.installCommand` | 미설정 → `DEFAULTS` `"npm install"` | 설치 |
| 등록 여부 | **생성된 worktree** 의 `harness/index.json` (`registeredInWorktree:337`) | seed 2분기 |

### 분기 트리

```
parseArgs → branch 없음 ─▶ usage() + exit 1
   │
   ├─ --launch 지정 ─▶ doInstall = true (--install 을 함의, :383)
   │
   ├─ --from 지정 ─▶ assertBranchName(from)  ── 형식 위반 ─▶ exit 1
   │     ↑ worktree 를 만들기 **전에** 검증한다(중간 상태 방지, :390-399)
   │
   ├─ git rev-parse --show-toplevel 실패 ─▶ exit 0 (조용히)
   │
   ├─ worktreePathFor(root, branch) = <부모>/<repo>-<브랜치 마지막 세그먼트>
   │     assertOutsideRepo 위반(저장소 내부) ─▶ exit 1
   │     ※ 경로에는 리비전 접미사를 **뗀 적 없다** — `-a` 와 `-a-1` 이 충돌하지 않게(:28-30)
   │
   ├─ config.json 부재 ─▶ DEFAULTS / 있는데 깨짐 ─▶ exit 1 (:427-434)
   │
   ├─ ensureWorktree(branch, path, baseForNewBranch({from, configBaseBranch}))
   │     ├ 그 경로에 이미 worktree
   │     │    같은 브랜치 ─▶ 재사용 { created:false, baseRef:null }
   │     │    다른 브랜치 ─▶ throw ─▶ exit 1
   │     ├ 경로가 일반 디렉터리로 점유 ─▶ throw ─▶ exit 1
   │     ├ 브랜치가 이미 존재 ─▶ attach: `worktree add <path> <branch>`  (baseRef=null)
   │     └ 신규 ─▶ resolveBaseRef(base): `<base>` → `origin/<base>` 순
   │                 둘 다 없음 ─▶ **throw** (HEAD 로 물러서지 않는다, :111-119)
   │                 `worktree add -b <branch> <path> <baseRef>`
   │
   ├─ --from 을 줬는데 baseRef === null ─▶ ℹ "attach 라 --from 은 쓰이지 않았다" (:463)
   │
   ├─ --from 없음 → baseMismatchWarning(:190)
   │     from 지정 / baseRef null / currentBranch 없음(detached) / currentBranch == baseBranch
   │        → null (경고 안 함)
   │     그 외 ─▶ ⚠ "현재 '<X>' 인데 '<baseBranch>' 에서 분기했다"  — **차단 아님**
   │
   ├─ install
   │     재사용 + node_modules 존재 ─▶ 건너뜀 (:483)
   │     doInstall ─▶ win32: powershell -NoProfile -Command "<installCommand>"
   │                  그 외 : execSync(installCommand)
   │                  실패 ─▶ ⚠ 경고만. **worktree 를 지우지 않는다**(삭제는 비가역)
   │     doInstall 아님 ─▶ 수동 설치 명령 출력
   │
   └─ --launch
         seed = seedArg ?? seedPromptFor(branch, { registered: registeredInWorktree(path, branch) })
              registered=false ─▶ "<task> 기획부터 진행 — planner 를 스폰해 …"
              registered=true  ─▶ "<task> 개발 진행 — 등록된 spec 의 진행 상태를 확인하고 …"
         tryLaunchTerminal
              darwin ─▶ osascript + Terminal.app
              win32  ─▶ cmd /c start "" powershell -NoExit -EncodedCommand <utf16le-base64>
              그 외 / 실패 ─▶ 붙여넣기용 명령 출력 폴백
```

### seed 2분기가 존재하는 이유는 하나다

| 시나리오 | worktree 의 `index.json` | seed |
|---|---|---|
| 신규 task (`feat/a`, baseBranch 분기) | main 것 → `feat/a` 없음 | 기획부터 |
| 리비전 (`feat/a-1`, `--from feat/a`) | `feat/a` 것 → `feat/a-1` 없음 | 기획부터(planner 리비전 모드) |
| **중단 재개** (`feat/a` attach) | `feat/a` 것 → **있음** | **이어서 작업** |

판정을 **root 가 아니라 worktree** 에서 하는 것이 핵심이다(`:333-345`). root 기준이면
살아 있는 모든 task 가 항상 '미등록' 이 되어(등록은 작업 브랜치 위에서만 일어나므로) 재개 세션에
"이미 확정된 spec 을 다시 쓰라"고 지시하게 된다.

`isTaskRegistered` 는 **파싱 실패·부재를 미등록으로 기운다**(`:209-215`). 두 오판의 위험이 비대칭이라서다 —
미등록 오판은 planner 리비전 모드나 `pre-commit` 소유권 검사가 흡수하지만(대가=유한한 재작업),
등록됨 오판은 spec 없이 "이어서 구현하라"를 지시해 doc-before-code 를 건너뛰게 하고 사후 장치가 없다.

---

## P3 — 매 프롬프트: `load-spec.mjs` (UserPromptSubmit)

**차단하지 않는다. 모든 경로가 `exit 0`.**

| 읽는 값 | 출처 |
|---|---|
| `cwd` | stdin JSON `input.cwd` (없으면 `process.cwd()`) |
| `branch` | `git rev-parse --abbrev-ref HEAD` (cwd 기준), 실패 시 `""` |
| index | `<cwd>/harness/index.json` |
| spec | `<cwd>/<index.tasks[branch]>` |

```
stdin JSON 파싱 실패 ─────────────▶ exit 0 (아무것도 주입 안 함)
index.json 없음/깨짐 ─────────────▶ emit("") = 무주입, exit 0
index.tasks[branch] 없음 ─────────▶ "[하네스] 현재 브랜치 '<b>'에 등록된 기능 목록(spec)이 없습니다…"
spec 파일 읽기 실패 ──────────────▶ "[하네스] 기능 목록 경로(<p>)를 읽을 수 없습니다…"
정상 ─────────────────────────────▶ "[하네스] 개발자 역할. … test-first로 자율 구현하세요
                                       (기능 사이에 사용자에게 묻지 않음). (<경로>)" + **spec 전문**
```

출력 형식은 `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`.

**주의점 2개**

1. **경로 기준이 `cwd` 다**(`:43,58`). 하위 디렉터리에서 세션을 열면 spec 주입이 **조용히 사라진다**.
2. **매 프롬프트마다 spec 전문이 다시 붙는다.** 캐시 접두부는 무효화되지 않지만 컨텍스트 윈도우는
   실제로 채워진다(`pipeline-review.md` 논점 A — **미결**). 다만 규칙 2(spec 은 브랜치당 한 번 확정)
   덕에 "옛 spec 과 새 spec 이 히스토리에 공존" 하는 더 위험한 쪽은 구조적으로 소멸했다.

---

## P4 — 기획 (`planner` 서브에이전트)

| 항목 | 값 |
|---|---|
| 스폰 | **worktree 세션**이 Agent 도구로 (`subagent_type: "planner"`) |
| 도구 | `Read, Grep, Glob, Write, Edit` — **Bash ❌** |
| 모델 | `sonnet` |

**Bash 가 없어서 브랜치를 파일로 판별한다**(`planner.md:15-20`):

```
.git 을 Read
   내용이 "gitdir: <경로>" ─▶ 링크드 worktree ─▶ <경로>/HEAD 를 Read
   Read 실패(디렉터리)     ─▶ 일반 체크아웃 ─▶ .git/HEAD 를 Read
HEAD 내용 "ref: refs/heads/<branch>" ─▶ <branch>
   그 형식이 아님(detached) ─▶ 사용자에게 <task> 이름을 묻는다
```

**`<task>` 유도** — 브랜치 마지막 세그먼트에서 리비전 접미사 `-<숫자>`(연쇄 포함)를 제거:

| 브랜치 | spec 디렉터리 | worktree 경로 |
|---|---|---|
| `feat/oauth-fix` | `harness/oauth-fix/` | `…-oauth-fix` |
| `feat/a-1` | `harness/a/` (원본과 **같은** spec) | `…-a-1` |
| `feat/a-1-2` | `harness/a/` | `…-a-1-2` |
| `feat/oauth2` | `harness/oauth2/` (하이픈 없음 = 리비전 아님) | `…-oauth2` |

> 순수 문자열 패턴이라 `feat/sprint-3` 은 **오판된다**. 리비전이 아닌 브랜치는 숫자 접미사를 피한다.

**신규/리비전 분기**: `harness/<task>/spec.md` 를 먼저 Read →
없으면 신규 작성, 있으면 **리비전 모드**(해당 기능만 수정 + `branch:` 만 갱신 + `## 개정 이력` 한 줄 추가).

**산출물**: `harness/<task>/spec.md` (frontmatter `branch:` **필수** — 이 값이 P8 의 소유권 검사 입력이다)
\+ `harness/index.json` 의 `tasks` 에 `"<branch>": "harness/<task>/spec.md"` 추가.

planner 의 Write 도 P5 를 탄다 → 대상이 `harness/` → 면제(판정 4) → 통과.

---

## P5 — 편집마다: `verify-branch.mjs` (PreToolUse `Edit|Write`)

**순서가 곧 설계다.** 앞선 판정이 조기 반환하면 뒤의 판정은 도달하지 않는다.

### 입력값

| 값 | 출처 |
|---|---|
| `cwd` | stdin JSON `input.cwd` |
| `file` | `input.tool_input.file_path` |
| `session` | `gitContext(cwd)` = `{ top: --show-toplevel, common: --git-common-dir }` |
| `target` | `gitContext(nearestExistingDir(file))` — **신규 파일에도 동작해야 하므로** 상위로 올라간다 |
| `index` | `<session.top>/harness/index.json` (**root 기준** — cwd 무관) |
| `configText` | `<session.top>/harness/config.json` — 판정 2 **앞에서 한 번만** 읽어 2·4 가 공유 |

`gitContext` 는 `--path-format=absolute --git-common-dir` 를 쓰고, git 2.31 미만이면
`--absolute-git-dir` 로 폴백한 뒤 `stripWorktreeSuffix` 로 `/worktrees/<name>` 을 떼어낸다
(`:138-146`). 이게 없으면 **모든 worktree 가 '다른 저장소' 로 오분류된다.**

### 판정 트리 (`main:161-269`)

```
0. classifyLocation(session, target)
     other-worktree (같은 저장소, 다른 워킹트리) ─▶ **deny**
          "그 worktree 에서 세션을 열어 편집하세요"
     other-repo (다른 저장소)                   ─▶ ask   (다중 저장소 작업일 수 있다)
     outside (target 이 git 밖 / 비교 불가)      ─▶ 계속 (아래에서 다시 걸러짐)
     same                                       ─▶ 계속
   ↑ 0 이 맨 앞인 것은 **의도적**이다. 뒤로 밀면 판정 2(ask)가 먼저 반환해
     교차 워킹트리 편집이 deny 가 아니라 ask 로 샌다(실제로 그랬다 — :16-17)

1. session.top 없음(git 아님) ─▶ exit 0
   branch 조회 실패          ─▶ exit 0
   index.json 없음/깨짐      ─▶ exit 0        (하네스 미설정 → 간섭 안 함)

2. branch ∈ resolveProtectedBranches(configText) ─▶ **ask**
        = { config.baseBranch } ∪ config.protectedBranches
          설정 없음/깨짐 ─▶ DEFAULTS( baseBranch "dev", protectedBranches [] )

3. index.tasks[branch] 없음(미등록) ─▶ **ask**
        "애드혹 수정이면 승인하세요"

4. file 없음 또는 location === "outside" ─▶ exit 0
        ↑ 스크래치패드 등은 worktree 강제 대상이 아니다
        ※ 이 통과가 2·3 **뒤에** 있으므로, 보호/미등록 브랜치에서는
          git 밖 파일을 써도 ask 가 먼저 뜬다

5. isHarnessMeta(relative(session.top, file), metaPaths) ─▶ exit 0
        정확 일치 또는 '<entry>/' 접두어 — **저장소 루트 앵커링**
        'harness/' 는 'harness/x' 를 면제하지만 'apps/web/harness/x' 는 면제하지 않는다
        'BACKLOG.md' 는 'BACKLOG.md.bak' 을 면제하지 않는다

6. --absolute-git-dir 에 "/worktrees/" 포함? (링크드 worktree 판별)
        아니오(= 메인 체크아웃) ─▶ **deny**
             "'<branch>'는 spec이 등록된 task입니다. … worktree 를 만들고 그 디렉터리에서 세션을"
        판별 실패 ─▶ inLinkedWorktree = true (오탐 deny 방지, :252-258)

7. exit 0 — 정상 흐름에 간섭하지 않음
```

**출력 형식**: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny|ask","permissionDecisionReason":"…"}}`.
자체 오류는 전부 `exit 0` (`:274-278`) — 훅이 작업을 깨지 않는다.

### 이 저장소에서의 실제 결과

| 세션 위치 | 대상 | 결과 |
|---|---|---|
| main 체크아웃, `main` | `harness/x.md` | **ask** (판정 2에서 반환 — 면제 판정까지 안 간다) |
| main 체크아웃, `main` | 다른 worktree 의 파일 | **deny** (판정 0) |
| worktree, `feat/x`(등록) | `scripts/y.mjs` | 통과 (판정 6 = 링크드) |
| main 체크아웃, `feat/x`(등록) | `scripts/y.mjs` | **deny** (판정 6) |
| main 체크아웃, `feat/x`(등록) | `.claude/settings.json` | 통과 (판정 5 면제) |

---

## P6 — 객관 게이트 (`scripts/gate.mjs`)

**1층 게이트의 유일한 실행 진입점.** 세션·pre-commit·pre-push 가 전부 이것을 부른다.

### 실행 순서 (`main:295-365`)

| # | 동작 | 실패 시 |
|:-:|---|---|
| 1 | `env = scrubGitEnv(process.env)` — **`GIT_` 접두어 전체 제거** | — |
| 2 | `root = repoRoot(env)` (`git rev-parse --show-toplevel`) | `exit 1` "git 저장소가 아닙니다" |
| 3 | `harness/config.json` 존재? | **부재 → `exit 0` 통과** (도입 초기 차단 방지) |
| 4 | `loadConfig(text)` | **throw → `exit 1`** (오타가 '게이트 없음' 으로 둔갑 금지) |
| 5 | 모든 entry 에 `assertInsideRepo(root, dir)` | `exit 1` "gate 대상이 저장소 밖" |
| 6 | `base = mergeBase(config.baseBranch, root, env)` — `origin/<base>` → `<base>` 순 | 둘 다 실패 → `null` |
| 7 | `planGate(config, {dirExists, base})` | 아래 skip 규칙 |
| 8 | `--list` 면 계획만 출력하고 `exit 0` | — |
| 9 | `typecheck` 전부 → 실패 있으면 **`test` 는 안 돈다** | `exit 1` |
| 10 | 없으면 `[gate] ✅ 통과` `exit 0` | — |

> **9의 정확한 의미**: `break` 는 *kind 루프*에만 걸린다(`:349-356`). 같은 kind 안의 항목은
> 앞이 실패해도 **끝까지 다 돈다**. "typecheck 하나라도 깨지면 test 는 안 돈다"가 맞고,
> "첫 실패에서 멈춘다"는 아니다.

### `scrubGitEnv` 가 접두어 전체를 지우는 이유 (`:182-198`)

게이트가 git 훅 안에서 돌면 자식이 진짜 저장소의 `GIT_DIR`·`GIT_INDEX_FILE` 을 상속한다.
**`GIT_DIR` 이 있으면 git 은 저장소 탐색 자체를 건너뛰므로 `git -C` 도 `{cwd}` 도 대상을 바꾸지 못한다.**
실제로 이 저장소가 bare 로 재초기화되고 `main` 이 픽스처 커밋으로 덮였다(구 BACKLOG #9).
denylist 는 fail-open 이라(`GIT_WORK_TREE`·`GIT_COMMON_DIR`·`GIT_OBJECT_DIRECTORY`·`GIT_NAMESPACE`·
`GIT_CEILING_DIRECTORIES` … 하나만 빠져도 구멍) 접두어 전체를 지운다.
게이트 **밖**(직접 실행·CI)의 이중 방어는 `.claude/rules/test-git.md`.

### skip 규칙 (`planGate:217-239`)

```
dirExists(entry.dir) 거짓 ──────────▶ skip "디렉터리가 없습니다"        (⚠ 한 줄)
cmd 에 {{BASE}} 있고 base=null
   fallbackCmd 있음 ────────────────▶ fallbackCmd 로 실행
   fallbackCmd 없음 ────────────────▶ skip "merge-base 산출 실패"      (⚠ 한 줄)
그 외 ──────────────────────────────▶ {{BASE}} 를 base 로 치환해 실행
```

**이 skip 이 `baseBranch` 타입 검증의 근거다** — 오타 난 `baseBranch` 는 merge-base 를 `null` 로 만들고,
`{{BASE}}` 항목이 통째로 건너뛰어진다. **검사가 사라지는데 게이트는 `exit 0` 으로 통과한다**(⚠ 한 줄만 남는다).
그래서 `loadConfig` 가 값이 있는데 타입이 틀리면 throw 한다.

`runOne` 은 `execSync(cmd, {cwd: join(root,dir), env: scrubbed, stdio:"inherit"})` —
셸 경유는 Windows 의 `npx.cmd` 때문이고, 출력을 그대로 흘려보내는 것은 세션이 실패 원인을 봐야 하기 때문이다.

---

## P7 — QA (게이트 통과 후 · 커밋 전)

### P7-1. 해시를 개발자가 먼저 계산한다

```sh
node .claude/hooks/qa-hash.mjs <현재-브랜치>     # 반드시 저장소 루트에서
```

| 해시 입력(순서 그대로) | 출처 |
|---|---|
| spec 내용 | `harness/index.json` → `tasks[branch]` → 그 파일 |
| 모든 테스트 파일의 **경로 + 내용** | `.` 재귀 순회, `config.testFilePatterns` 매칭, `config.skipDirs` 제외 |

- 경로는 `\` → `/` 로 정규화해 해시에 넣는다(`:66`) — Windows/POSIX 에서 같은 값이 나오도록.
- 파일 목록은 `.sort()` 한 뒤 순회한다(`:65`).
- 설정이 없거나 깨져도 **stderr 경고 후 DEFAULTS 로 계속한다**(`:28-35`) — 여기서 중단하면 훅이 조용히 깨진다.
- stdout 에는 **해시 문자열만** 나간다(pre-push 가 그대로 받는다).

> **cwd 의존이다.** `CONFIG_PATH`·`harness/index.json`·`collectTests(".")` 가 전부 상대경로다.
> 하위 디렉터리에서 돌리면 값이 어긋나 push 가 한 번 막힌다. `pre-push` 는 `cd $ROOT` 를 하므로
> 훅 경로에서는 문제가 없다.

### P7-2. QA 서브에이전트 스폰

| 항목 | 값 |
|---|---|
| 도구 | `Read, Grep, Glob, Write, Edit` — **Bash ❌** |
| 모델 | `haiku` |
| 브랜치 판별 | `.git/HEAD` Read |
| 러너 판별 | **`harness/config.json` 의 `gate.test`** — Bash 가 없어 `gate --list` 를 못 돌리므로 설정을 직접 읽는다 |
| 산출물 | `harness/<task>/qa-checklist.md` |

```
gate.test 에 항목 있음 ─▶ testFilePatterns 로 Glob → 테스트를 **실제로 읽고** 커버리지 대조
gate.test 비어 있음    ─▶ "❌ 누락(테스트 러너 없음)" + 그 근거를 적는다
어느 쪽이든            ─▶ 기능 체크리스트 **독립 도출**은 정상 수행
```

**독립 도출이 이 역할의 전부다.** spec 을 베끼면 기획 spec 자체의 누락이 드러나지 않는다.
그래서 새 컨텍스트(서브에이전트)여야 한다.

`input_hash` 는 **주입받은 값을 그대로 기록**한다(`qa.md:51`) — QA 는 Bash 가 없어 계산할 수 없다.

> **해시 계산 뒤에는 테스트/spec 을 더 바꾸지 않는다.** 바꾸면 P9 의 3번에서 불일치가 나
> headless QA 가 재생성 → 미커밋 차단 → push 가 한 번 막힌다.

---

## P8 — 커밋 (`.githooks/pre-commit`)

**모든 진단 출력은 `say()` 서브셸로 낸다**(`:25`). 훅의 차단 여부가 '출력을 끝까지 쓰는 데
성공했는가' 에 의존하면 안 되기 때문이다 — `git commit | head -6` 처럼 소비자가 파이프를 일찍 닫으면
훅이 SIGPIPE 로 죽어 `exit 1` 에 도달하지 못하고 **막아야 할 커밋이 조용히 통과한다**(실제 재현됨).

### 4단계

```
cd $(git rev-parse --show-toplevel)

① 부분 스테이징 거부  ── git diff --quiet 실패 ─▶ exit 1
     "훅은 워킹트리를 검사하므로 … git add -A && git commit"
     ※ stash 후 복원(작업 손실 위험) 대신 **거부**한다

② spec 소유권 (규칙 2) ─ O(1) 검사라 게이트보다 **앞**에 둔다
     BRANCH = git rev-parse --abbrev-ref HEAD
     SPEC   = node -e "require('./harness/index.json').tasks['$BRANCH']"
     SPEC 이 있고 && git diff --cached --name-only | grep -qxF "$SPEC"
        ↑ -F 필수: 경로의 '.' 이 정규식으로 해석되면 오매칭한다
        git show "HEAD:$SPEC" | node .claude/hooks/spec-lock.mjs "$BRANCH"
             exit 1 ─▶ 차단 + **탈출 명령을 그대로 출력**
                       node scripts/worktree-add.mjs <새 브랜치> --from $BRANCH --launch \
                         --seed "spec 개정 — <요청 내용>"

③ 객관 게이트 ──────── node scripts/gate.mjs 실패 ─▶ exit 1 (워킹트리 보존)

④ 통과 트리 기록 ───── TREE = git write-tree
     성공 ─▶ printf '%s' "$TREE" > $(git rev-parse --absolute-git-dir)/harness-gate-tree
     실패(머지 중 등) ─▶ rm -f 마커  → pre-push 가 게이트를 다시 돌게 한다
```

### `spec-lock.mjs` 의 판정 (`:21-43`)

**판정 근거는 워킹트리가 아니라 `HEAD` 시점의 spec 이다.** 워킹트리는 이미 새 브랜치 이름으로
바뀌어 있으므로 그것을 보면 리비전 브랜치의 첫 개정까지 막힌다.

| 상황 | `HEAD:spec` 의 `branch:` | 결과 |
|---|---|---|
| `feat/a` 최초 작성 | 파일 없음 → `frontmatterBranch` = null | 통과 |
| `feat/a` 에서 재수정 | `feat/a` = 현재 | **차단** |
| `feat/a-1` 첫 개정 | `feat/a` ≠ 현재 | 통과 |
| `feat/a-1` 에서 재수정 | `feat/a-1` = 현재 | **차단** |

`frontmatterBranch` 는 **첫 줄이 `---` 이고 닫는 `---` 가 있을 때만** 그 사이를 본다(`:25-34`).
`sed -n 's/^branch:.*//p'` 로 하면 spec **본문**에 줄 시작이 `branch:` 인 문장이 있을 때 그것을
소유자로 읽는다. CRLF 도 `trimEol` 로 같은 판정이 나오게 고정했고, 그 판정을 vitest 가 지킨다.

`spec-lock.mjs` 는 **아무것도 출력하지 않는다**(`:47`) — 사람에게 보여줄 문구는 훅의 `say()` 가 낸다
(출력하다 SIGPIPE 로 죽으면 종료코드가 사라진다). 브랜치 인자를 못 받으면 `exit 0`(차단하지 않음).

---

## P9 — push (`.githooks/pre-push`)

```
cd $ROOT                              ← 이 덕에 qa-hash 의 cwd 의존이 여기선 문제가 안 된다
BRANCH = git rev-parse --abbrev-ref HEAD
```

```
① 트리 마커 비교
     HEAD_TREE = git rev-parse HEAD^{tree}
     GATE_TREE = cat $(git rev-parse --absolute-git-dir)/harness-gate-tree
     같음 ─▶ "pre-commit 에서 검증된 트리 — 생략"
     다름/없음 ─▶ node scripts/gate.mjs   실패 ─▶ **exit 1**
        ↑ 없애지 않는 이유: rebase·자동 머지는 pre-commit 을 실행하지 않는다.
          각각은 통과하지만 합치면 깨지는 semantic conflict 는 커밋 시점에 존재하지 않아
          pre-commit 이 원리적으로 못 잡는다. 마커 부재/불일치 → 안전 기본값 = 실행

② SPEC = node -e "…tasks['$BRANCH']"
     비어 있음 ─▶ "등록된 spec 없음 — QA 생략, push 허용" **exit 0**
     QA = $(dirname "$SPEC")/qa-checklist.md

③ NEW_HASH = node .claude/hooks/qa-hash.mjs "$BRANCH"
   OLD_HASH = sed -n 's/^input_hash:[[:space:]]*//p' "$QA" | head -1
     OLD 비어있지 않음 && NEW == OLD ─▶ "QA 입력 불변 — 생략" **exit 0**
        ↑ **재생성 무한루프를 끊는 지점.** LLM 은 매번 결과가 달라 이게 없으면 재push 가 수렴 안 한다

④ command -v claude 없음 ─▶ "⚠ claude CLI 없음 — QA 생략" **exit 0** (비차단)

⑤ headless QA
     claude -p "당신의 역할은 .claude/agents/qa.md에 정의돼 있다. 먼저 그 파일을 Read 하라. …
                frontmatter의 input_hash를 정확히 '$NEW_HASH' 로 기록하라."
       --model haiku --permission-mode acceptEdits
       --allowedTools "Read,Grep,Glob,Edit,Write" --disallowedTools "Bash"
       --output-format text
       < /dev/null            ← **필수**: pre-push 는 ref 목록을 stdin 으로 넘긴다
     실패 ─▶ "⚠ QA 실행 실패 — push 허용" **exit 0** (비차단)

⑥ 패키징 게이트
     git status --porcelain "$QA" 가 비어있지 않음 ─▶ **exit 1**
        "커밋하고 다시 push 하세요"
```

**정상 경로는 ③에서 끝난다** — P7 에서 세션이 QA 를 미리 만들고 해시를 주입했으므로 push 가 한 번에 끝난다.
⑤·⑥ 은 그 경로를 밟지 않았을 때의 안전망이고, 그때 push 시도는 2회가 된다.

**⑥은 품질 게이트가 아니라 패키징 게이트다.** "QA 산출물이 미커밋" 만 막고,
커버리지의 `❌`/`△` 는 **push 를 막지 않는다** — "사람 머지가 유일한 품질 게이트" 를 유지하기 위해서다.

> **한계(코드에 명시됨, `pre-push:30-32`)**: 게이트를 *실행하는* 경로에서 `gate.mjs` 는 워킹트리를
> 검사하지 `HEAD` 의 트리를 체크아웃해 검사하지 않는다. 워킹트리가 dirty 하면 push 되는 내용과
> 검사 대상이 다르다. 스킵 경로에는 이 문제가 없다.

---

## P10 — 세션 종료 (`session-cost.mjs`, SessionEnd)

| 읽는 값 | 출처 |
|---|---|
| `transcript_path` | stdin JSON. 없으면 `session_id` + `cwd` 로 유도 (slug = 절대경로의 `/`·`.` → `-`) |
| 서브에이전트 | `<dirname(tp)>/<sid>/subagents/*.jsonl` |

```
transcript 없음 ─▶ exit 0
records 0건     ─▶ exit 0
그 외 ─▶ parseUsageLine → **message.id 로 dedup** → aggregate
         · systemMessage 로 요약 출력 (SessionEnd 라 안 보일 수 있음)
         · ~/.claude/projects/<cwd-slug>/session-costs.log 에 한 줄 append  ← 보증 경로
```

**읽기 전용, 항상 `exit 0`.** 단가·집계는 `scripts/token-usage.mjs` 재사용(단일 소스).
worktree 세션은 cwd 가 달라 slug 도 다르므로 로그가 그쪽에 남고, `token-usage.mjs` 가 합산한다.

---

## 상태 — 훅과 훅 사이에 남는 것은 둘뿐이다

| # | 이름 | 만드는 곳 | 읽는 곳 | 성질 |
|:-:|---|---|---|---|
| 1 | `<git-dir>/harness-gate-tree` | `pre-commit ④` | `pre-push ①` | **트리** 해시(커밋 해시 아님). 이 시점엔 커밋이 없고, 게이트가 검증한 건 히스토리가 아니라 내용 → 메시지만 고친 amend 는 유효 유지. git-dir 이 worktree 마다 달라 마커도 자동 분리. `.git/` 안이라 절대 추적되지 않는다 |
| 2 | `qa-checklist.md` frontmatter 의 `input_hash` | 세션(P7) 또는 `pre-push ⑤` | `pre-push ③` | `sha256(spec + 모든 테스트 파일 경로·내용)`. '무엇이 테스트인가' 는 `config.testFilePatterns` 단일 출처 |

그 외에 세션 간·훅 간에 전달되는 상태는 없다. 나머지는 전부 파일(커밋된 산출물)과 git 자체다.

---

## 설정값 참조표 — `harness/config.json`

| 필드 | 소비자 | 이 저장소의 값 | 필드 **부재** | 타입 **오타** |
|---|---|---|---|---|
| `baseBranch` | `gate.mjs`(merge-base) · `worktree-add`(분기) · `verify-branch`(보호) | `"main"` | `DEFAULTS "dev"` | **throw** |
| `protectedBranches` | `verify-branch` | (미설정) | `[]` | **throw** |
| `installCommand` | `worktree-add` | (미설정) | `"npm install"` | **throw** |
| `harnessMetaPaths` | `verify-branch` | `harness/ .claude/ .githooks/ README.md` | `["harness/", ".claude/"]` | **throw** |
| `gate.typecheck` / `gate.test` | `gate.mjs` · `qa.md`(러너 판별) | `[]` / `[{".", "npx vitest run --passWithNoTests"}]` | `[]` | **throw** (`dir`·`cmd` 없으면) |
| `testFilePatterns` | `qa-hash.mjs` | `**/*.test.{ts,tsx,js,mjs}` | `["**/*.test.{ts,tsx}"]` | ⚠ **검증 없음** (아래 갭 ①) |
| `skipDirs` | `qa-hash.mjs` | (미설정) | `node_modules .git .next dist .turbo` | ⚠ **검증 없음** (갭 ①) |

**파일 자체의 부재·오류를 다루는 방향은 소비자마다 다르다** — 이건 일관성 결여가 아니라 설계다:

```
파일 없음   → gate.mjs      : 통과(exit 0)      도입 초기에 부당한 차단 금지
              worktree-add  : DEFAULTS
              verify-branch : DEFAULTS          훅은 설정 때문에 죽지 않는다
              qa-hash       : DEFAULTS
JSON 깨짐   → gate.mjs      : **exit 1**        오류를 '알리는' 것은 게이트의 몫
              worktree-add  : **exit 1**
              verify-branch : DEFAULTS (조용히)  ← 갭 ② 참고
              qa-hash       : stderr 경고 + DEFAULTS
```

## 설정값 참조표 — `harness/index.json`

`{ "tasks": { "<브랜치>": "<spec 경로>" } }` — **브랜치당 spec 하나(1:1)**.

| 소비자 | 용도 | 미등록일 때 |
|---|---|---|
| `load-spec.mjs` | 주입할 spec 선택 | 소프트 경고만 |
| `verify-branch.mjs` | 판정 3 | `ask` |
| `qa-hash.mjs` | 해시에 넣을 spec | spec 없이 테스트만 해시 |
| `worktree-add.mjs` | seed 2분기 (**worktree 기준**) | "기획부터" |
| `pre-commit ②` | 소유권 검사 대상 | 검사 생략 |
| `pre-push ②` | QA 대상 | **QA 생략, push 허용** |
| `qa.md` | spec 경로 | "등록된 spec 없음" 만 적고 종료 |

현재 등록: 7개(`refactor/worktree-config`, `fix/verify-branch-guard`, `chore/index-sync-removal`,
`docs/drop-phase1`, `fix/gate-env-isolation`, `refactor/spec-in-worktree`, `feat/base-branch-single-source`).

---

## 분기점 전체 요약

| 프로세스 | 분기점 | 판단 근거 | 갈래 |
|---|---|---|---|
| P0 | 훅 활성화 | `core.hooksPath` | 이미 설정=무동작 / 아님=설정 / git 아님=스킵 |
| P2 | 경로 점유 | `worktree list --porcelain` | 같은 브랜치=재사용 / 다른 브랜치=에러 / 일반 디렉터리=에러 |
| P2 | 분기 기준 | `--from` > `config.baseBranch` | 로컬 → `origin/` → **throw** |
| P2 | 브랜치 존재 | `show-ref --verify` | 존재=attach / 없음=`-b` 분기 |
| P2 | seed | **worktree** 의 `index.json` | 미등록=기획부터 / 등록=이어서 |
| P2 | 기준 불일치 경고 | `from`·`baseRef`·`currentBranch`·`baseBranch` | 4개 조건 중 하나라도 걸리면 침묵 |
| P3 | 주입 내용 | `index.tasks[branch]` + spec 읽기 | 무주입 / 소프트경고 / 경로오류 / 전문주입 |
| P4 | 신규/리비전 | `harness/<task>/spec.md` 존재 | 신규작성 / 리비전 모드 |
| P4 | `<task>` | 브랜치 마지막 세그먼트 − `-<숫자>` | (연쇄 제거) |
| P5 | 7단 판정 | 위치 → 브랜치 → 등록 → 면제 → worktree | deny / ask / 통과 |
| P6 | 실행 대상 | `dirExists` + `{{BASE}}` 치환 가능 여부 | 실행 / fallbackCmd / skip(⚠) |
| P6 | 종료 | typecheck 결과 | 실패=test 생략 후 exit 1 / 성공=test 실행 |
| P7 | 러너 유무 | `config.gate.test` 배열 | 실제 대조 / "러너 없음" 기록 |
| P8 | 소유권 | **HEAD 시점** spec 의 `branch:` | 같음=차단 / 다름·없음=통과 |
| P9 | 게이트 | `HEAD^{tree}` == 마커 | 생략 / 재실행 |
| P9 | QA | spec 유무 → 해시 일치 → CLI 유무 | 생략×3 / 실행 |
| P9 | 최종 | `git status --porcelain "$QA"` | 비어있음=통과 / 아니면 exit 1 |

---

## 강제력 위계 — 무엇이 실제로 막는가

```
하드 (훅이 막는다)
  pre-commit  ① 부분 스테이징  ② spec 소유권  ③ 객관 게이트
  pre-push    ① 객관 게이트(조건부)  ⑥ QA 산출물 미커밋
  verify-branch  판정 0(교차 워킹트리)  판정 6(메인 체크아웃의 등록 task)

반강제 (사람 승인)
  verify-branch  판정 0'(다른 저장소)  판정 2(보호 브랜치)  판정 3(미등록 브랜치)

주입 (문맥만)
  load-spec

문서 (강제 없음)
  .claude/CLAUDE.md · README.md · .claude/rules/*.md
```

**문서에 아무리 강하게 적어도 그것은 컨텍스트일 뿐 강제가 아니다.**

---

## 검토에서 확인된 갭

기존 문서(`README.md` '열린 구멍', `pipeline-review.md` §3)에 이미 기록된 것과, 이번 코드 대조에서
새로 확인된 것을 함께 둔다. **새로 확인된 것은 ①②③⑪⑫** 이고, 그중 ⑪ 이 가장 영향이 크다.

### ① `testFilePatterns`·`skipDirs` 만 타입 검증이 없다 (신규 확인)

`loadConfig` 는 `baseBranch`·`protectedBranches`·`installCommand`·`harnessMetaPaths`·`gate.*` 를
전부 오타 시 throw 하지만(`gate.mjs:77-116`), **`testFilePatterns` 와 `skipDirs` 는 `raw.X ?? DEFAULTS.X`
로 그대로 통과시킨다**(`:121-122`). 결과:

- `testFilePatterns` 를 배열이 아닌 문자열로 쓰면 → `matchesAnyGlob` 의 `patterns.some` 이 TypeError →
  `qa-hash.mjs` 가 죽고 stdout 이 빈다 → `pre-push ③` 의 `NEW_HASH=""` 는 `OLD_HASH` 와 절대 같지 않아
  **매 push 마다 headless QA 가 돌고**, 재생성된 산출물이 미커밋이면 ⑥에서 막힌다.
- `skipDirs` 를 문자열로 쓰면 → `new Set("node_modules")` 가 **문자 단위 집합**이 되어
  `node_modules` 를 순회한다. 해시가 폭주하고 조용히 느려진다.

이 저장소가 `baseBranch` 검증을 뒤늦게 붙이며 세운 원칙("오타가 조용히 '검사 없음' 으로 둔갑하면 안 된다")이
정확히 이 두 필드에만 적용되지 않았다. 고치는 비용은 `loadConfig` 에 검증 블록 2개 추가로 낮다.

### ② `config.json` 이 깨지면 보호 브랜치가 조용히 바뀐다 (신규 확인)

`verify-branch.mjs` 의 `resolveProtectedBranches` 는 `loadConfig` 가 throw 하면 `DEFAULTS` 로 물러선다
(`:90-103`). `DEFAULTS.baseBranch` 는 `"dev"` 다(`gate.mjs:21`). 즉 이 저장소에서 `config.json` 이
깨지면 **보호 목록이 `{main}` 에서 `{dev}` 로 바뀐다** — `main` 이 보호 대상에서 빠진다.

훅이 설정 오류로 죽지 않는다는 방침 자체는 옳고(오류를 알리는 것은 `gate.mjs` 의 몫),
`harnessMetaPaths` 쪽 폴백은 **막는 방향**으로 기운다(면제가 줄어 deny 가 늘어난다).
그런데 보호 브랜치 폴백만 **푸는 방향**이다. 실패 방향이 다른 폴백이 같은 함수 관례로 묶여 있다.

실질 노출은 제한적이다 — `main` 은 `index.json` 에 미등록이라 판정 3의 `ask` 는 여전히 뜬다.
다만 등록된 브랜치가 `baseBranch` 이기도 한 구성에서는 보호가 완전히 사라진다.

### ③ 부분 스테이징 거부는 untracked 파일을 보지 않는다 (신규 확인)

`pre-commit ①` 은 `git diff --quiet` 다(`:36`). 이것은 **추적된 파일의 미스테이징 변경**만 본다 —
`git add` 되지 않은 **새 파일은 잡히지 않는다.**

결과: 새 테스트 파일을 만들고 `git add` 하지 않은 채 커밋하면

```
gate.mjs   → 워킹트리를 검사한다 → 그 테스트를 포함해 실행 → ✅ 통과
git write-tree → **인덱스** 기준 → 그 테스트가 없는 트리 해시가 마커에 기록
pre-push ① → HEAD^{tree} == 마커 → 게이트 생략
```

즉 훅이 막겠다고 선언한 "검사한 트리 ≠ 커밋되는 트리"가 **untracked 경로로 그대로 재발한다.**
`CLAUDE.md` 의 `git add -A` 규약이 정상 경로에서 이를 덮지만, 규약은 강제가 아니다
(이 저장소 자신의 표현대로 "문서는 컨텍스트일 뿐 강제가 아니다").
`git status --porcelain` 이 비어 있는지로 바꾸면 닫힌다.

### ④ git 훅에 브랜치 보호 검사가 없다 *(README '열린 구멍' #3 — 확인)*

`pre-commit`·`pre-push` 어디에도 브랜치 이름 검사가 없다. 게다가 `pre-push` 는
**stdin 으로 들어오는 ref 목록을 읽지 않는다** — `HEAD` 의 브랜치명만 본다. 따라서
`git push origin feat/x:main` 같은 형태는 훅이 인지조차 하지 못한다.
"`main`/`dev` 에 커밋·push 금지"는 `CLAUDE.md` 문장 + `verify-branch` 의 `ask` 뿐이다 —
**가장 강하게 말하는 규칙이 가장 약하게 강제돼 있다.**

### ⑤ `CLAUDE.md` 가 `main`/`dev` 를 리터럴로 적는다 *(README #4 — 확인)*

같은 파일이 `baseBranch`·`harnessMetaPaths` 에 대해서는 "값 사본을 적지 마라"고 못 박는다.
보호 목록이 `config.json` 단일 출처가 되면서 **차이가 실제로 생겼다**: 훅은 `main` 만 보호하는데
문서는 `dev` 도 금지라고 적는다.

### ⑥ QA 모델이 두 곳에 있다 *(README #5 · 논점 H — 미결)*

`agents/qa.md:5` 의 `model: haiku` 와 `pre-push:71` 의 `--model haiku`. 한쪽만 바꾸면
두 QA 경로가 다른 모델로 돈다. 모을 자리가 자명하지 않아 미결이다 — 서브에이전트 frontmatter 는
`config.json` 을 읽지 못하고, 반대로 `pre-push` 가 frontmatter 를 파싱하게 하면 훅이 마크다운 파서를 갖는다.

### ⑦ `verify-branch` 는 `Edit|Write` 만 매칭한다 *(pipeline-review ⑥ — 확인)*

`settings.json` 은 `Bash` 를 통째로 allow 한다. 셸 리다이렉션으로 파일을 쓰면 worktree 강제도
보호 브랜치 판정도 전부 우회된다. 도구를 정상적으로 쓰면 부딪히지 않는 종류의 구멍이다.

### ⑧ cwd 기준이 파일마다 다르다 *(pipeline-review ⑤ — 확인)*

| 파일 | 기준 | 하위 디렉터리에서 실행하면 |
|---|---|---|
| `load-spec.mjs` | **cwd** | spec 주입이 **조용히** 사라짐 |
| `qa-hash.mjs` | **cwd**(상대경로) | 해시 불일치 → push 1회 차단 |
| `verify-branch.mjs` | `session.top` | 영향 없음 |
| `gate.mjs` | `repoRoot()` | 영향 없음 |
| `worktree-add.mjs` | `root` | 영향 없음 |

`CLAUDE.md` 는 `qa-hash` 에 대해서만 경고한다. 실패가 조용한 쪽은 `load-spec` 이다.

### ⑨ 게이트가 항상 전체 스위트를 돈다 *(pipeline-review ⑦ — 확인)*

`config.json` 의 `cmd` 에 `{{BASE}}` 가 없어 `mergeBase` 는 **계산만 되고 버려진다**.
지금 규모에선 무해하지만 `--changed` 최적화 경로가 비활성이라는 사실은 알고 쓰는 편이 낫다.

### ⑩ `index.json` 등록 규약이 균일하지 않다 (관찰)

`harness/` 에 spec 디렉터리는 11개인데 `index.json` 의 `tasks` 는 7개다.
`gate-pipeline`·`token-usage`·`worktree-workflow`·`worktree-enforce` 는 등록돼 있지 않고,
`gate-pipeline` 은 `qa-checklist.md` 도 없다. 하네스 도입 이전에 만들어진 초기 task 들이다.
`tasks` 가 append-only 인지(머지된 항목도 남기는지) 규약이 문서에 없다 — 지금은 사실상 append-only 로 운영된다.

### ⑪ 리비전의 시작 지점이 코드와 문서에서 갈린다 (신규 확인, **영향 큼**)

> **정의(2026-08-06 교정)**: **리비전은 그 task 의 worktree 세션에서 시작된다.** 신규냐 리비전이냐는
> **세션이 어디에 있느냐**로 갈린다 — `main` 에서 시작 = 신규, 등록된 task worktree 에서 시작 = 리비전.
> git 이 이미 아는 사실이므로 추론이 필요 없다.

**코드는 이미 이 전제로 짜여 있다:**

| 장치 | 근거 |
|---|---|
| `pre-commit` 차단 메시지 | `--from $BRANCH` 를 **채워서** 출력한다(`:69`). 오직 worktree 세션에서만 발동한다 |
| `spec-lock` + `pre-commit ②` | `feat/a` 에서 spec 재수정을 시도하는 순간 막고 새 브랜치를 지시한다 — **하네스가 리비전을 지시하는 유일한 지점이 worktree 안이다** |
| `registeredInWorktree` (§4-4-1) | 등록 판정을 root 가 아니라 **worktree** 의 `index.json` 으로 한다 |
| `load-spec` | 그 브랜치의 spec 을 주입하므로 세션은 자기가 무엇을 개정하는지 안다 |
| `verify-branch` 판정 0 | 세션은 자기 worktree 밖을 못 고친다 → 리비전 논의는 그 worktree 세션에서만 성립한다 |

**문서만 `main` 을 가리킨다.** `pipeline-review.md §4-1` 은 리비전 줄을 `[사람]` 으로 라벨하고,
`.claude/CLAUDE.md` 의 디스패처 규약은 **`--from` 을 아예 언급하지 않는다**:

> 거기서 하는 일은 요구사항 논의와 브랜치명 확정, 그리고 `node scripts/worktree-add.mjs <branch> --launch` 실행뿐이다.

그래서 `main` 세션이 리비전을 열려고 시도하게 되는데, **거기엔 판단 근거가 없다.**
세션1(main)이 `feat/a` worktree/세션2 를 만들고 → 세션2 가 작업 중 → 세션1 에서 대화가 이어져
`feat/a` 의 리비전이 필요해졌다고 하자. 세션1이 가진 신호:

| 신호 | 보이는가 | 이유 |
|---|---|---|
| `index.json` 의 `feat/a` | ❌ | 등록 커밋은 task 브랜치 위에서 일어난다(§4-4-1). 확인: `6744519` 는 `refs/heads/feat/base-branch-single-source` 에서 만들어졌고 main 엔 머지로 들어왔다 |
| `load-spec` 주입 | ❌ | main 은 미등록 → 소프트 경고만 |
| `harness/a/spec.md` | ❌ | 미머지 |
| 대화 컨텍스트 | △ | 같은 세션이면 있지만 컴팩션·재시작이면 소멸. 강제가 아니다 |
| `git worktree list` · `git branch --no-merged` | ✅ | **유일하게 실재하는 신호인데, 어떤 문서도 이것을 보라고 하지 않는다** |

**`--from` 을 빠뜨렸을 때의 추적 — 전 구간이 조용하다:**

```
worktree-add feat/a-1 --launch          (--from 없음)
 ├ baseMismatchWarning → currentBranch("main") === configBaseBranch("main") → **null**
 │    main 에 서 있으면 이 경고는 **원리적으로 뜨지 않는다** — 잘못된 자리에서
 │    리비전을 여는 이 경우를 잡아줄 장치가 없다
 ├ worktree 가 main 에서 잘림 → feat/a 의 spec·코드 없음
 ├ registeredInWorktree → 미등록 → seed "기획부터"
 └ planner: feat/a-1 → harness/a/spec.md Read → 없음 → **신규 작성 모드**
      · 원본을 못 본 채 처음부터 새로 쓴다   · `## 개정 이력` 미생성(계보 소실)
      · feat/a 와 feat/a-1 이 같은 경로의 spec 을 서로 모른 채 각자 만든다
```

**더 근본적으로 — 판별 입력이 둘인데 일치 검사가 없다.** 하네스 전체에서 리비전을 구분하는 신호는
**브랜치명의 `-<숫자>` 접미사** 하나뿐이고, 그것과 `--from` 이 어긋나도 아무도 보지 않는다
(`worktree-add` 는 구분하지 않고 `taskFromBranch` 는 접미사를 일부러 떼지 않는다. 떼는 것은
planner 의 산문 규칙뿐이다).

| 브랜치명 | `--from` | planner 판정 | 실제 계보 | 결과 |
|---|---|:-:|---|---|
| `feat/a-1` | `feat/a` | 리비전 | feat/a | ✅ 의도대로 |
| `feat/a-1` | 없음 | **신규**(spec 부재) | main | ❌ 이름은 리비전, 결과는 신규 (위 추적) |
| `feat/a-fix` | `feat/a` | **신규**(`task=a-fix`) | feat/a | ❌ 코드는 상속, spec 만 새로 → 한 브랜치에 spec 둘 |
| `feat/sprint-3` | 없음 | **리비전**(`harness/sprint/` 실재 시) | main | ❌ 신규인데 남의 spec 을 개정 |

네 번째는 `planner.md:31` 이 스스로 경고하는 오판이다 — "리비전이 아닌 작업 브랜치는 숫자로 끝나는
접미사를 피한다". **대응이 규약 한 줄뿐이고 강제가 없다.** 이 저장소에도 근접 사례가 있다:
`docs/drop-phase1` 은 `1` 앞이 `e` 라 접미사에 안 걸려 `harness/drop-phase1/` 로 간다 —
`drop-phase-1` 이었으면 `harness/drop-phase/` 를 개정하려 들었을 것이다.

**다만 원리적으로 알 수 없는 것은 아니다.** `verify-branch` 는 `Edit|Write` 만 매칭하므로 **Read 는
막지 않는다.** 디스패처가 `git worktree list --porcelain` 으로 살아있는 worktree 를 찾고
`<경로>/harness/index.json`·spec 을 읽으면 판단 근거가 생긴다. **그렇게 하라는 규약도, 강제하는 훅도
없을 뿐이다.**

**`pre-commit` 의 소유권 검사도 잡지 못한다**: `git show HEAD:harness/a/spec.md` 가 main 기준으로
파일 없음 → `frontmatterBranch("")` = `null` → `isRevisionAttempt` = false → **통과**.
즉 **`--from` 누락은 규칙 2 의 유일한 강제 장치를 무력화한다** — spec-lock 은 브랜치 계보가
이어져 있을 때만 작동하는데, `--from` 을 빼먹는 행위가 정확히 그 계보를 끊기 때문이다.

**그런데 올바른 경로(worktree 에서 시작)도 지금은 실행이 깨져 있다.** `worktreePathFor` 가
`basename(root)` 를 쓰는데(`worktree-add.mjs:38-42`), worktree 안에서 실행하면 `root` 가 그 worktree 다:

| 실행 위치 | 인자 | 산출 경로 |
|---|---|---|
| 메인 체크아웃 | `feat/a-1` | `…/harness-engineering-a-1` ✅ |
| `feat/a` worktree | `feat/a-1` | `…/harness-engineering-a-a-1` ❌ task 가 겹쳐 붙는다 |
| `feat/a` worktree | `feat/b` | `…/harness-engineering-a-b` ❌ |

`assertOutsideRepo` 는 상대경로가 `..` 로 시작하므로 **통과한다** — 에러 없이 조용히 잘못된 이름의
디렉터리가 생긴다. 즉 교정된 정의대로 worktree 에서 리비전을 열면 지금은 **경로부터 어긋난다.**

**`baseMismatchWarning` 은 뒤집혀 있지 않다 — 교정된 정의 아래서는 양쪽 다 옳다.**

| 실행 위치 | 교정된 모델에서 | 경고 | 판정 |
|---|---|---|---|
| `main` (신규 task) | 정규 | 안 뜸 | ✅ `baseBranch` 분기가 맞다 |
| task worktree (리비전) | 정규 | `--from` 없으면 뜸 | ✅ **정확히 옳은 경고** |

남는 문제는 경고의 방향이 아니라 **`--from` 을 자동으로 정하는 코드가 없다**는 것이다.

> `baseBranch` 기능 전체의 문제는 아니다. 소비자 3개 중 `worktree-add` 의 분기 기준과
> `verify-branch` 의 보호 브랜치는 정상 작동한다(후자는 이 문서를 쓰는 세션에서 `main` 편집마다
> `ask` 가 떠 실증됐다). `mergeBase` 는 이 저장소에서만 무용하다(갭 ⑨ — `{{BASE}}` 미사용).
> README '열린 구멍' #7 도 그 정의("**다른 브랜치에 선 채** 실행")대로는 닫혔다 —
> 이 갭은 그 정의가 커버하지 않는 별개의 구멍이다.

**고쳐야 할 것**

| 파일 | 변경 |
|---|---|
| `worktree-add.mjs` | `worktreePathFor` 를 **메인 체크아웃 기준으로 앵커링**(`--git-common-dir` 에서 `/.git` 제거, 또는 `worktree list` 첫 항목) |
| `worktree-add.mjs` | `--from` 기본값 = 등록된 task worktree 에서 실행하면 **현재 브랜치**(지금은 항상 `baseBranch`) |
| `worktree-add.mjs` | 리비전 브랜치명(현재 브랜치 + 다음 번호) 유도 — 지금은 사람이 손으로 친다 |
| `.claude/CLAUDE.md` | 디스패처 절에 "리비전은 그 worktree 세션에서 시작한다" 명시 |
| `pipeline-review.md §4-1` | 리비전 줄의 `[사람]` → `[세션]` |

`--from` 이 현재 브랜치에서 유도되면 **판별 입력 둘이 하나로 합쳐져 위 4조합 표가 두 행으로 붕괴한다.**
남는 것은 4행(`feat/sprint-3` 오판)뿐이고, 그건 신규 경로에서 planner 가 남의 spec 을 리비전 모드로
집어드는 것을 막으면 닫힌다.

> **진행 중**: 이 항목은 `fix/revision-from-worktree` 브랜치에서 spec 부터 다루고 있다
> (인수기준이 바뀌는 변경이라 doc-before-code 대상).

### ⑫ `qa-hash` 의 파일 정렬은 OS 구분자에 노출된다 (신규 확인, 낮은 영향)

`collectTests` 는 플랫폼 구분자가 들어간 원시 경로로 `.sort()` 하고(`:65`), 정규화는
`h.update()` **직전**에만 한다(`:66`). `/`(0x2F)와 `\`(0x5C)는 정렬 위치가 달라,
디렉터리명과 파일명이 `0-9`·`A-Z`·`:`~`@` 범위 문자에서 갈리는 경우(예: `src/` vs `src2…`)
**Windows 와 POSIX 에서 정렬 순서가 뒤바뀌어 같은 트리인데 해시가 달라진다.**
현재 트리에는 해당 조합이 없어 드러나지 않는다. 정규화를 `sort` 전으로 옮기면 닫힌다.

---

## 잘 작동하는 것 — 각각이 막는 실제 사고

여섯 개 모두 **실제로 터진 사고를 겪고 난 뒤** 들어갔고, 근거가 코드 주석에 남아 있다.
이 점이 이 하네스의 가장 큰 자산이다.

| 장치 | 막는 실패 | 근거 |
|---|---|---|
| 게이트 대상 단일 출처 | 문서 사본이 게이트보다 넓어 **테스트가 한 번도 안 도는** 상태 | 구 BACKLOG #1 |
| `scrubGitEnv` 접두어 전체 제거 | 테스트가 진짜 저장소를 bare 로 재초기화하고 `main` 을 덮음 | 구 BACKLOG #9 |
| `say()` 서브셸 | 훅이 SIGPIPE 로 죽어 **막아야 할 커밋이 조용히 통과** | `pre-commit:13-24` |
| 트리 해시 마커 | push 시 게이트 중복 실행 | `pre-commit:87-99` |
| 입력 해시 스킵 | LLM 비결정성으로 "재생성 → 차단 → 재push" 무한 루프 | `qa-hash.mjs:3-4` |
| 면제 경로 루트 앵커링 | `apps/web/harness/foo.ts` 가 면제돼 제품 코드가 뚫림 | 구 BACKLOG #7 |
| `verify-branch` 판정 0 이 맨 앞 | 교차 워킹트리 편집이 deny 가 아니라 **ask 로 샘** | `verify-branch.mjs:16-17` |
| `.gitattributes` `eol=lf` | 셰뱅+CRLF 로 worktree 의 훅이 실행 안 됨 | 구 BACKLOG #8 |

---

## 부록 — 파일별 책임

| 파일 | 트리거 | 읽는 것 | 쓰는 것 | 차단 |
|---|---|---|---|:-:|
| `.claude/hooks/load-spec.mjs` | UserPromptSubmit | `index.json`, spec | stdout(additionalContext) | ❌ |
| `.claude/hooks/verify-branch.mjs` | PreToolUse(Edit\|Write) | git 컨텍스트, `index.json`, `config.json` | stdout(permissionDecision) | ✅ deny/ask |
| `.claude/hooks/spec-lock.mjs` | pre-commit 이 파이프 호출 | stdin(HEAD 시점 spec), argv(브랜치) | — (무출력) | ✅ exit 1 |
| `.claude/hooks/qa-hash.mjs` | 수동 / pre-push | `config.json`, `index.json`, spec, 테스트 파일 | stdout(sha256) | ❌ |
| `.claude/hooks/session-cost.mjs` | SessionEnd | transcript jsonl | `session-costs.log`, systemMessage | ❌ |
| `scripts/gate.mjs` | 수동 / pre-commit / pre-push | `config.json` | 자식 프로세스 스폰 | ✅ exit 1 |
| `scripts/worktree-add.mjs` | 수동 | `config.json`, worktree 의 `index.json` | worktree, 새 터미널 세션 | ❌ 경고만 |
| `scripts/setup-githooks.mjs` | `npm install` | `core.hooksPath` | `core.hooksPath` | ❌ |
| `scripts/token-usage.mjs` | 수동 / session-cost 가 import | transcript jsonl | stdout | ❌ |
| `.githooks/pre-commit` | `git commit` | 인덱스, `index.json`, HEAD 의 spec | `<git-dir>/harness-gate-tree` | ✅ ×3 |
| `.githooks/pre-push` | `git push` | 마커, `index.json`, `qa-checklist.md` | `qa-checklist.md`(headless 경로) | ✅ ×2 |
| `.claude/agents/planner.md` | 세션 스폰 | `.git`/`HEAD`, 코드 | `spec.md`, `index.json` | — |
| `.claude/agents/qa.md` | 세션 스폰 / pre-push headless | `.git/HEAD`, `index.json`, spec, `config.json`, 테스트 | `qa-checklist.md` | ❌ |

**모든 스크립트는 같은 관례를 따른다** — 순수 함수를 `export` 하고 직접 실행일 때만 `main()` 을 돈다.
import 시 부수효과가 없으므로 git·파일시스템 없이 단위 테스트할 수 있고, **훅이 그 순수 함수를 실제로
호출하므로 테스트되는 것과 실행되는 것이 같다**(사본이 아니다).

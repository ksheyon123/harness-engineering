# worktree-config

## 목적

`scripts/worktree-add.mjs` 가 **분기 기준 브랜치를 `dev` 로, 패키지 매니저를 `npm` 으로 하드코딩**하고 있어, 그 둘이 다른 저장소에서는 worktree 생성이 실패하거나 설치 단계가 헛돈다.

이것은 가설이 아니라 **지금 이 저장소에서 재현되는 문제**다. 이 저장소엔 `dev` 브랜치가 없고 `harness/config.json` 은 이미 `"baseBranch": "main"` 을 선언하고 있지만, `worktree-add.mjs` 는 그 설정을 읽지 않는다. 그래서 BACKLOG #1 이 끝나 파이프라인 의식을 적용하기로 한 직후, **정규 흐름의 첫 단계인 worktree 생성부터 막힌다.**

이 작업은 `#1` 이 만든 단일 출처(`harness/config.json`)에서 `baseBranch` 와 `installCommand` 를 읽게 해서, 하네스가 자기 설정을 실제로 사용하도록 만든다.

## 배경 — `#1` 이 만든 경계를 그대로 따른다

`#1` 은 "게이트 대상의 정의는 `harness/config.json` 한 곳, 그것을 해석하는 코드도 한 곳"이라는 경계를 세웠다. `scripts/gate.mjs` 가 `loadConfig`·`DEFAULTS`·`CONFIG_PATH` 를 export 하고 `.claude/hooks/qa-hash.mjs` 가 그것을 import 해 쓴다.

이 작업도 같은 경계를 따른다 — **`worktree-add.mjs` 는 JSON 을 스스로 파싱하지 않고 `gate.mjs` 의 `loadConfig` 를 import 한다.** 파서를 하나 더 만들면 "같은 설정을 다르게 해석"하는 문제가 세 번째 사본으로 돌아온다.

## 범위 밖 (명시)

- `verify-branch.mjs` 의 면제 경로에 `scripts/`·`.githooks/` 추가(BACKLOG #7). 이 작업은 **그 문제를 우회하지 않고 그대로 겪는다** — `scripts/worktree-add.mjs` 는 제품 소스로 취급되므로 worktree 에서 작업한다. 그것이 규약대로다.
- `index-sync` 훅 존폐 판단(BACKLOG #5).
- `.claude/agents/qa.md` 의 'Phase 1' 서술 제거(BACKLOG #2).
- `dev` 브랜치 생성. 이 저장소는 `main` 단일 브랜치를 유지하고, 설정으로 그 사실을 표현한다.
- 패키지 매니저 **자동 감지**(lockfile 스니핑). 설정에 없으면 기본값 `npm install` 이다. 감지는 추측이고, 추측이 틀리면 조용히 잘못된 매니저로 설치한다 — 하네스의 다른 부분과 마찬가지로 **명시적 설정**을 택한다.

---

## 기능 목록

### 기능: `loadConfig` 에 `installCommand` 추가

- **의도**: 설치 명령의 단일 출처를 만든다. `baseBranch` 는 이미 `loadConfig` 가 반환하고 있으므로 추가 작업이 없고, 빠진 것은 `installCommand` 뿐이다.
- **방식**:
  - `scripts/gate.mjs` 의 `DEFAULTS` 에 `installCommand: "npm install"` 을 추가한다.
  - `loadConfig` 의 반환에 `installCommand: raw.installCommand ?? DEFAULTS.installCommand` 를 추가한다.
  - 타입 검사: 값이 있는데 문자열이 아니거나 빈 문자열이면 **throw** 한다. `gate` 항목의 `dir`/`cmd` 검사와 같은 결이다 — 설정 오타가 조용히 기본값으로 둔갑하면 안 된다.
- **주의**:
  - `loadConfig` 는 `qa-hash.mjs` 도 쓴다. 필드 추가는 그쪽 동작에 영향이 없어야 한다(구조 분해로 `testFilePatterns`·`skipDirs` 만 꺼내 쓰고 있으므로 영향 없음을 확인한다).
  - `gate.test.mjs` 에 이미 `loadConfig` 테스트가 있다. 기본값·오류 케이스를 그 파일에 잇는다(새 파일로 분리하지 않는다).
- **인수기준**:
  - `installCommand` 가 없는 설정에서 `loadConfig(...).installCommand === "npm install"` 이다.
  - `installCommand: "pnpm install"` 인 설정에서 그 값이 그대로 반환된다.
  - `installCommand: 42` 또는 `installCommand: ""` 인 설정에서 `loadConfig` 가 throw 한다.

### 기능: 분기 기준 브랜치를 설정에서 읽기

- **의도**: `worktree-add.mjs:112` 의 `dev` 하드코딩을 없앤다. 지금은 `dev` 가 없는 저장소에서 `git worktree add` 가 git 의 원문 에러(`invalid reference: dev`)로 실패하고, 사용자는 그것이 **설정으로 고칠 수 있는 문제**임을 알 수 없다.
- **방식**:
  - `main()` 이 `join(root, CONFIG_PATH)` 를 읽어 `loadConfig` 로 파싱한다. `root` 는 이미 `git rev-parse --show-toplevel` 로 구해 두었으므로 **cwd 에 의존하지 않는다**(`qa-hash.mjs` 가 상대경로를 써서 하위 디렉터리에서 해시가 어긋났던 전례를 반복하지 않는다).
  - 설정 파일이 **없으면** `DEFAULTS` 로 물러선다(= 현재 동작인 `dev`). 새 저장소에서 worktree 생성이 설정 부재만으로 막히면 안 된다.
  - 설정 파일이 **있는데 깨졌으면** 명확한 에러로 중단한다(`gate.mjs` 와 같은 판단).
  - 기준 ref 해석에 순수 함수 `resolveBaseRef(base, { refExists })` 를 둔다. `<base>` → `origin/<base>` 순으로 찾고, 둘 다 없으면 throw 한다. 로컬 우선인 이유는 사람이 방금 로컬에서 만든 기준 브랜치를 쓸 수 있어야 하기 때문이고, `origin/` 폴백을 두는 이유는 갓 클론한 저장소에 로컬 추적 브랜치가 없을 수 있기 때문이다(`gate.mjs` 의 `mergeBase` 가 이미 같은 2단 탐색을 한다 — 다만 그쪽은 `origin/` 우선이다. 방향이 다른 이유를 주석에 남긴다).
  - `git worktree add` 인자 조립도 순수 함수 `worktreeAddArgs({ branch, path, baseRef, branchExists })` 로 뺀다. 브랜치가 이미 있으면 `["worktree","add",path,branch]`, 없으면 `["worktree","add","-b",branch,path,baseRef]`.
- **주의**:
  - **기준 브랜치가 없을 때 조용히 `HEAD` 로 물러서지 않는다.** 그러면 사용자가 의도하지 않은 커밋에서 분기되고, 그 사실이 드러나는 시점은 한참 뒤(머지할 때)다. 실패 방향이 나쁘므로 **명확한 에러**를 낸다: 어떤 ref 를 찾았는지와 `harness/config.json` 의 `baseBranch` 를 고치라는 안내를 함께 출력한다.
  - 브랜치가 **이미 존재하는** 경우엔 기준 ref 가 아예 필요 없다. 이 경로에서는 `resolveBaseRef` 를 호출하지 않는다 — 그러지 않으면 `dev` 가 없는 저장소에서 **기존 브랜치 attach 마저 막힌다**(현재는 되는 동작이다. 회귀를 만들면 안 된다).
  - 성공 로그(`worktree-add.mjs:298`)와 usage(`:245`), 파일 상단 주석(`:3`)에 박힌 `dev` 문자열도 함께 고친다. 로그는 실제로 쓴 기준 ref 를 출력한다.
- **인수기준**:
  - `resolveBaseRef` 는 로컬 ref 가 있으면 그 이름을, 없고 `origin/<base>` 만 있으면 `origin/<base>` 를 반환한다.
  - `resolveBaseRef` 는 둘 다 없으면 throw 하고, 메시지에 기준 브랜치명과 `harness/config.json` 이 포함된다.
  - `worktreeAddArgs` 는 `branchExists=true` 일 때 `-b` 와 기준 ref 를 넣지 않는다.
  - `baseBranch: "main"` 인 이 저장소에서 `node scripts/worktree-add.mjs <새-브랜치>` 가 성공하고, 생성된 worktree 의 HEAD 가 `main` 의 커밋이다.
  - 설정 파일이 없을 때 기준 브랜치는 `dev` 다(기존 동작 유지).

### 기능: 설치 명령을 설정에서 읽기

- **의도**: `worktree-add.mjs` 의 `npm install` 하드코딩(실행 1곳, 안내 문구 1곳)을 없앤다. pnpm/yarn/bun 저장소에서 설치 단계가 헛돌면, `pre-push` 가 그 worktree에서 게이트를 돌릴 때 의존성이 없어 실패한다.
- **방식**:
  - `installCommandFor(path, installCommand)` — 안내 문구 생성 함수에 명령을 인자로 받는다(현재는 `npm install` 이 문자열에 박혀 있다). 플랫폼별 인용 규칙(win32=PowerShell `Set-Location`, 그 외=POSIX `cd &&`)은 그대로 유지한다.
  - 실제 실행도 설정 명령을 쓴다. **플랫폼 분기는 유지한다** — win32 에서 PowerShell 을 경유하는 것은 취향이 아니라 두 가지 회피책이다(코드 주석에 이미 근거가 있다: `npm` 은 `npm.cmd` 라 셸 없이 스폰되지 않고, Git Bash(MSYS) 하위에서는 native postinstall 바이너리가 `0xC0000142` 로 깨진다). 그 자리에 들어가는 **명령 문자열만** 설정에서 온다.
  - `node_modules` 존재 시 설치를 건너뛰는 기존 최적화는 그대로 둔다.
- **주의**:
  - 설치 명령은 셸을 거쳐 실행된다. 이것은 이미 `gate.mjs` 의 `cmd` 와 같은 신뢰 모델이다 — `harness/config.json` 은 저장소에 커밋된 파일이고, 그것을 고칠 수 있는 사람은 이미 코드를 고칠 수 있다. **새로운 신뢰 경계를 만들지 않는다**는 점을 주석에 남긴다(브랜치명 등 사용자 입력은 여전히 인자 배열로 넘겨 인젝션을 막는다 — 그 구분을 흐리지 않는다).
  - 설치 실패 시 worktree 를 지우지 않는 현재 동작(경고 후 유지)을 지킨다. 삭제는 비가역이다.
- **인수기준**:
  - `installCommandFor("/x", "pnpm install")` 의 반환에 `pnpm install` 이 포함되고 `npm install` 은 포함되지 않는다.
  - 설정에 `installCommand` 가 없으면 안내 문구가 `npm install` 이다(기존 동작 유지).
  - 설치가 실패해도 worktree 는 남고, 종료 코드는 실패로 바뀌지 않는다(현재 동작 유지).

### 기능: `worktree-add.mjs` 의 순수 함수에 테스트를 붙인다

- **의도**: 이 파일은 `taskFromBranch`·`worktreePathFor`·`assertOutsideRepo`·`parseWorktreeList`·`parseArgs`·`shellSingleQuote` 등 순수 함수를 이미 export 하고 있지만 **테스트가 하나도 없다**. `#1` 이 러너를 도입했으므로 이제 붙일 수 있고, 이 작업이 그 함수들 주변을 고치므로 지금이 붙일 시점이다.
- **방식**: `scripts/worktree-add.test.mjs` 를 만든다. 이번에 추가하는 함수(`resolveBaseRef`·`worktreeAddArgs`·`installCommandFor`)는 **test-first** 로 쓰고, 기존 함수는 현재 동작을 고정하는 특성 테스트(characterization test)로 덮는다.
- **주의**:
  - `main()` 과 `git`/`npm` 을 실제로 부르는 함수는 테스트하지 않는다. 부수효과가 있는 함수는 순수 함수를 주입받는 형태(`resolveBaseRef(base, { refExists })`)로 갈라 둔다 — `gate.mjs` 의 `planGate(config, { dirExists })` 와 같은 관례다.
  - 경로 관련 테스트는 Windows/POSIX 구분자 차이에 걸리기 쉽다. `worktreePathFor` 는 `path.join` 을 쓰므로 기대값도 `join` 으로 만들어 플랫폼 독립적으로 쓴다.
- **인수기준**:
  - `npx vitest run` 이 `scripts/worktree-add.test.mjs` 를 실행하고 통과한다.
  - 위 세 기능의 인수기준에 나열된 순수 함수 동작이 테스트로 덮인다.

### 기능: `CLAUDE.md`·README 에서 `dev`/npm 하드코딩 제거

- **의도**: `#1` 의 교훈을 그대로 적용한다 — **강제되는 사실을 소프트 문서에 복사해두면 강제력은 안 늘고 드리프트 위험만 는다.** 지금 `CLAUDE.md` 는 "작업 브랜치는 `dev`에서 분기한다", "수동이면 `git worktree add -b <branch> ../<repo>-<task> dev`" 라고 **값을 박아** 놓았는데, 그 값은 이제 설정에서 온다.
- **방식**: `.claude/CLAUDE.md` 의 '분기 기준'·'worktree 동시작업 규약' 에서 `dev` 리터럴과 `npm install` 리터럴을 **행동 규칙 + 설정 포인터**로 바꾼다.
  - "작업 브랜치는 `harness/config.json` 의 `baseBranch` 에서 분기한다(항상 최신 기준)."
  - 수동 생성 예시는 `git worktree add -b <branch> ../<repo>-<task> <baseBranch>` 로 둔다.
  - 의존성 설치 문장은 매니저명을 빼고 "각 worktree 에서 설치가 필요하다"로 남긴다.
- **주의**:
  - `main`/`dev` **직접 커밋·push 금지**는 값이 아니라 **안전 규칙**이므로 그대로 남긴다. 설정으로 빼지 않는다 — 이것은 "어디서 분기하나"가 아니라 "어디에 쓰면 안 되나"의 문제다.
  - README 에 설치/브랜치 관련 서술이 있으면 함께 맞춘다.
- **인수기준**:
  - `.claude/CLAUDE.md` 의 worktree 관련 서술에 `dev` 가 분기 기준 값으로 등장하지 않는다(`main`/`dev` 보호 규칙의 등장은 유지).
  - 분기 기준을 바꾸려는 사람이 `CLAUDE.md` 를 읽으면 `harness/config.json` 으로 안내받는다.

---

## 완료 후 상태

```
harness/config.json ─────── 단일 출처
  ├ baseBranch        → gate.mjs (merge-base)   ✔ 이미 사용 중
  │                   → worktree-add.mjs (분기) ← 이 작업
  ├ installCommand    → worktree-add.mjs (설치) ← 이 작업
  ├ testFilePatterns  → qa-hash.mjs             ✔ 이미 사용 중
  └ gate.{typecheck,test} → gate.mjs            ✔ 이미 사용 중
```

이 작업이 끝나면 `dev` 가 없는 이 저장소에서도 `node scripts/worktree-add.mjs <branch> --launch` 가 동작하므로, 이후 항목(#7 → #2 → #5)은 **정규 파이프라인 의식을 온전히** 밟을 수 있다.

## 사람 확인 필요

- 이 task 자체는 `scripts/worktree-add.mjs` 를 고치는데, 그 스크립트가 아직 고쳐지지 않았으므로 **자기 자신으로 worktree 를 만들 수 없다.** 최초 worktree 는 수동 생성한다: `git worktree add -b refactor/worktree-config ../harness-engineering-worktree-config main`. (부트스트랩 문제이며 1회성이다.)
- `resolveBaseRef` 의 탐색 순서를 **로컬 우선**으로 정했다. `gate.mjs` 의 `mergeBase` 는 `origin/` 우선이라 방향이 반대다. 의도적 차이지만(분기는 로컬 작업, merge-base 는 원격 기준선), 하나로 통일하는 편이 낫다고 판단하면 알려달라.

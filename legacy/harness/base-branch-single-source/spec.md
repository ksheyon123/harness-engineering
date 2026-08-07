---
branch: feat/base-branch-single-source
---

# base-branch-single-source

## 목적

`harness/config.json` 의 `baseBranch` 를 하네스 전체의 **단일 출처**로 만든다. 지금은 (a) `loadConfig` 의 타입 검증에서만 빠져 있고, (b) `verify-branch.mjs` 의 보호 브랜치 목록과 이중 출처이며, (c) `worktree-add.mjs` 의 분기 기준이 현재 체크아웃 브랜치와 어긋나도 조용하다. 이 세 구멍을 closes 하고, `--from` 과 게이트 merge-base 기준선의 관계(의도된 비대칭)를 문서에 명시한다. 근거: `harness/pipeline-review.md` 논점 H, `README.md` '열린 구멍' #1·#2·#7.

## 기능 목록

### 기능: `loadConfig` 의 `baseBranch` 타입 검증

- **의도**: `scripts/gate.mjs` 의 `installCommand`(:67-71)·`harnessMetaPaths`(:75-84)·`gate.*`(:50-62) 는 오타에 throw 하는데 `baseBranch: raw.baseBranch ?? DEFAULTS.baseBranch`(:87) 만 침묵한다. 침묵의 결과: 잘못된 `baseBranch` → `mergeBase()` 가 `origin/<x>`·`<x>` 둘 다 실패 → `null` → `planGate` 가 `{{BASE}}` 를 쓰는 항목을 `skipped` 로 밀고, **그 검사는 사라지는데 게이트는 exit 0 으로 통과**한다(⚠ 한 줄만 찍힘). 이 비대칭을 없앤다.
- **방식**: `installCommand` 검증(:67-71)과 **정확히 같은 결**로 추가한다 — `raw.baseBranch !== undefined` 인데 `typeof !== "string"` 이거나 빈 문자열이면 throw. `raw.baseBranch === undefined`(필드 자체가 없음)는 **기존대로 `DEFAULTS.baseBranch` 로 물러선다** — 바꾸지 않는다.
  - **결정: `DEFAULTS.baseBranch` 값(`"dev"`)도 바꾸지 않는다.** 근거: ① 이 저장소가 이미 `harness/config.json` 에 `baseBranch: "main"` 을 명시하고 있어 실질적 위험이 없다. ② `installCommand`·`harnessMetaPaths` 도 필드 부재 시 조용히 DEFAULTS 로 물러서는 것이 이 저장소가 세운 기존 방침("파일 부재 = DEFAULTS")이고, `baseBranch` 만 예외로 부재 시에도 경고를 내면 새로운 불일치를 만든다(오타=throw / 부재=DEFAULTS 라는 축을 필드마다 다르게 적용하지 않는다). ③ 기본값을 `"dev"`→`"main"` 등으로 바꾸는 것은 임의적이다 — 도입 프로젝트마다 관례(`main`/`master`/`develop`)가 달라 "정답"이 없다. 열린 구멍 #1 이 지적한 문제의 본질은 **타입 오타가 조용히 통과하는 것**이지 부재 시 폴백 자체가 아니므로, 타입 검증만 추가하면 그 절반이 닫힌다.
- **주의**: `raw.baseBranch` 가 `null` 이면 `typeof null === "object"` 라 `!== "string"` 분기로 throw 된다 — 의도한 동작이다(명시적으로 null 을 준 것은 오타에 가깝다). 기존 회귀(정상 문자열 값·필드 부재)가 깨지지 않아야 한다.
- **인수기준**:
  - `loadConfig(JSON.stringify({ baseBranch: 42 }))` 가 `/baseBranch/` 를 포함하는 메시지로 throw 한다.
  - `loadConfig(JSON.stringify({ baseBranch: "" }))` 가 throw 한다.
  - `loadConfig("{}").baseBranch === DEFAULTS.baseBranch` (필드 부재는 기존대로 DEFAULTS 로 물러선다 — 회귀 없음).
  - `loadConfig(JSON.stringify({ baseBranch: "develop" })).baseBranch === "develop"` (정상 값은 그대로 보존).
  - `DEFAULTS.baseBranch === "dev"` (값 자체는 이번 기능에서 바꾸지 않는다 — 회귀 테스트로 고정).

### 기능: `verify-branch.mjs` 보호 브랜치 목록을 config 단일 출처로

- **의도**: `.claude/hooks/verify-branch.mjs:30` 의 `PROTECTED = new Set(["main","dev","master"])` 하드코딩을 없앤다. `config.baseBranch` 와 이중 출처라 `baseBranch: "develop"` 인 프로젝트에서 `develop` 은 보호되지 않고, 이 저장소는 쓰지도 않는 `dev`·`master` 를 보호한다(`harness/pipeline-review.md` 논점 H, README '열린 구멍' #2).
- **방식**:
  - `scripts/gate.mjs` 의 `loadConfig`/`DEFAULTS` 에 `protectedBranches`(선택, 문자열 배열, 기본값 `[]`) 필드를 추가한다. 타입 검증은 `harnessMetaPaths`(:75-84) 와 **같은 결**로 한다 — 값이 있는데 배열이 아니거나 원소가 비어있지 않은 문자열이 아니면 throw. 이 결정도 앞 기능(1)의 결과 — "오타는 throw, 부재는 DEFAULTS" 축을 새 필드에도 그대로 적용한다.
  - `.claude/hooks/verify-branch.mjs` 에 `resolveMetaPaths(configText)`(:77-84) 와 **같은 관례**의 순수 함수 `resolveProtectedBranches(configText)` 를 추가한다: `loadConfig(configText)` 가 성공하면 `baseBranch` + `protectedBranches` 의 합집합을, 설정이 없거나 깨졌으면 `DEFAULTS.baseBranch` + `DEFAULTS.protectedBranches` 의 합집합을 반환한다(훅은 설정 오류로 죽지 않고 DEFAULTS 로 물러선다 — 설정 오류를 알리는 것은 `gate.mjs` 의 몫이라는 기존 방침 그대로).
  - 하드코딩 `PROTECTED` Set 을 제거하고, 판정 2(:198-203)를 `resolveProtectedBranches(configText).has(branch)` 로 바꾼다.
  - **판정 순서를 그대로 유지한다.** 현재 코드는 config 텍스트를 판정 4(면제 경로, :216-222)에서야 읽는다. 이 기능에서는 **그 읽기를 판정 2 앞으로 옮기고**(index.json 을 읽어 `registered` 를 구한 직후), 판정 2 와 판정 4 양쪽에서 같은 `configText` 를 재사용한다. `configText` 읽기 자체는 `file`/`location` 에 의존하지 않는 순수한 파일 읽기라 위치를 옮겨도 다른 판정에 부작용이 없다. 그 결과 **판정 0→1→2→3→4→5→6 순서가 전혀 바뀌지 않는다** — README 가 우려한 "순서가 뒤집혀 3(미등록 ask) 과 상대 순서가 달라지고 메시지가 바뀐다"는 문제 자체가 발생하지 않도록 설계한다. 판정 0(다른 워킹트리/저장소) 이 맨 앞이어야 하는 이유(파일 상단 주석 :16-17)는 건드리지 않는다.
  - 이 저장소에서의 실제 변화: `main` 은 `baseBranch` 로 계속 보호되고, `dev`·`master` 는(`protectedBranches` 를 별도로 채우지 않는 한) 더 이상 보호되지 않는다. **이것은 의도다** — 논점 H 가 지적한 "쓰지도 않는 브랜치를 보호한다" 문제를 없앤다.
- **주의**:
  - `CLAUDE.md` 의 "브랜치 안전: `main`/`dev` 에는 직접 커밋하지 않는다" 문구(자동 커밋 절)는 이번 변경 후에도 `dev` 를 리터럴로 언급한다. `dev`·`master` 보호가 사라지면 이 문구가 `verify-branch` 의 실제 동작(이 저장소는 이제 `main` 만 보호)과 다시 어긋난다. **이 문구 자체를 고치는 것은 이번 범위 밖이다**(README '열린 구멍' #4, CLAUDE.md 의 `main`/`dev` 하드코딩 문제는 별도 결정 필요) — 다만 이 어긋남이 존재한다는 사실은 여기 '주의'로 남긴다.
  - `resolveProtectedBranches` 가 `Set` 을 반환하든 배열을 반환하든 `resolveMetaPaths` 와 타입을 맞출 필요는 없다(호출부가 `.has`/`.includes` 중 하나로 통일해서 쓰면 된다) — 다만 호출부가 하나뿐이므로 어느 쪽이든 무방하다.
- **인수기준**:
  - `loadConfig(JSON.stringify({ protectedBranches: ["a", "b"] })).protectedBranches` 가 `["a","b"]` 를 그대로 보존한다.
  - `loadConfig("{}").protectedBranches` 가 `[]`(DEFAULTS) 다.
  - `loadConfig(JSON.stringify({ protectedBranches: "main" }))` 가 throw 한다(배열이 아님).
  - `loadConfig(JSON.stringify({ protectedBranches: [1, 2] }))` 가 throw 한다(원소가 문자열이 아님).
  - `resolveProtectedBranches(JSON.stringify({ baseBranch: "develop" }))` 가 `"develop"` 을 포함하고(자동 포함), 다른 값은 포함하지 않는다.
  - `resolveProtectedBranches(JSON.stringify({ baseBranch: "develop", protectedBranches: ["main","master"] }))` 가 `"develop"`·`"main"`·`"master"` 모두를 포함한다.
  - `resolveProtectedBranches(null)` 과 `resolveProtectedBranches("{ not json")` 가 `DEFAULTS.baseBranch`(`"dev"`) 를 포함한다(설정 없음/깨짐 → DEFAULTS 로 물러선다, `resolveMetaPaths` 와 동일 결).
  - `.claude/hooks/verify-branch.mjs` 소스에 `PROTECTED = new Set(` 하드코딩 리터럴이 더 이상 존재하지 않는다.
  - **순서 보존(회귀)**: `harness/config.json` 의 `baseBranch`(`"main"`) 인 브랜치이면서 동시에 `harness/index.json` 에 미등록인 시나리오(이 저장소에서 `main` 자체로 재현 가능)에서, 훅의 `permissionDecisionReason` 이 "보호 브랜치" 문구를 담고 "등록된 작업 브랜치가 아닙니다"(미등록) 문구를 담지 않는다 — 기존 `verify-branch.test.mjs` 의 "훅 실행(end-to-end)" 블록 패턴을 따라 검증한다.
  - **config 오버라이드 e2e**: 임시 `harness/config.json` 을 `baseBranch: "develop"` 으로 주입한 환경에서 `develop` 브랜치로 Edit 를 시도하면 보호 브랜치 `ask` 가 발생한다(현재는 발생하지 않는 회귀를 잡는다).
  - **dev/master 보호 해제(회귀)**: 이 저장소의 실제 `harness/config.json`(`baseBranch: "main"`, `protectedBranches` 없음) 기준으로, `dev` 브랜치에서의 Edit 시도는 더 이상 "보호 브랜치" 사유로 `ask` 되지 않는다(등록 여부에 따라 미등록 `ask` 이거나 통과).

### 기능: `worktree-add.mjs` — 분기 기준 불일치 경고

- **의도**: `--from` 없이 실행됐는데 **현재 체크아웃된 브랜치가 `baseBranch` 와 다르면** 조용히 `baseBranch` 에서 분기돼 버린다. 리비전 worktree 안에서 실행했거나 디스패처가 다른 브랜치를 체크아웃해 둔 채 실행했을 때 의도와 다른 기준에서 잘리는 것을 경고로 드러낸다(README '열린 구멍' #7). **차단이 아니다** — 정보 제공이다.
- **방식**:
  - 이 저장소의 관례대로 **순수 함수 + 주입**으로 판정한다. `scripts/worktree-add.mjs` 에 `baseMismatchWarning({ from, baseRef, currentBranch, configBaseBranch })` 를 추가한다(`resolveBaseRef`/`baseForNewBranch`/`isTaskRegistered` 와 같은 관례 — git 호출은 하지 않고 이미 계산된 값을 받는다). 경고 문자열 또는 `null` 을 반환한다:
    - `from !== undefined` → `null`(사용자가 명시적으로 기준을 지정했다 — 경고 대상이 아니다).
    - `baseRef === null` → `null`(브랜치가 이미 존재해 attach 하는 경로 — `ensureWorktree` 가 분기 기준을 아예 쓰지 않는다, :158-165. 이때 경고하면 거짓 경고다).
    - `currentBranch` 가 falsy(판별 실패 또는 detached HEAD) → `null`(훅/스크립트가 자기 오류로 흐름을 깨지 않는다는 기존 방침 — README 8.2 "판별 실패는 전부 '간섭 안 함' 쪽으로 기운다"와 같은 결).
    - `currentBranch === configBaseBranch` → `null`(불일치가 없다).
    - 그 외 → `currentBranch`·`configBaseBranch` 값을 모두 담은 경고 메시지 문자열.
  - `main()` 에서 `ensureWorktree` 호출 후, `from === undefined` 일 때만(불필요한 git 호출을 피하려는 최적화 — 인수기준 대상 아님) `git rev-parse --abbrev-ref HEAD` 로 현재 브랜치를 구한다. **detached HEAD 는 문자열 `"HEAD"` 를 돌려주는데, 이는 브랜치명이 아니므로 `currentBranch` 를 `null` 로 취급한다.** `execFileSync` 실패도 `null` 로 취급한다.
  - 경고는 `console.warn` 으로 출력하고(기존 install 실패 경고 :454-456 과 같은 결 — `⚠` 접두어), `process.exit` 코드에 영향을 주지 않는다. 기존 `--from` 무시 안내(:423-427, `ℹ` 접두어)와 나란히 두되 그것과는 다른 조건이므로 별개 블록으로 둔다.
- **주의**: 이미 존재하는 worktree 를 재사용(멱등 경로, `created=false`)하는 경우도 `ensureWorktree` 가 `baseRef: null` 을 돌려주므로(:145-151) 자동으로 경고 대상에서 빠진다 — 별도 분기가 필요 없다.
- **인수기준**:
  - `baseMismatchWarning({ from: "feat/x", baseRef: "origin/main", currentBranch: "feat/y", configBaseBranch: "main" })` 이 `null` 이다(`--from` 지정 시 경고 안 함).
  - `baseMismatchWarning({ from: undefined, baseRef: null, currentBranch: "feat/y", configBaseBranch: "main" })` 이 `null` 이다(attach 경로).
  - `baseMismatchWarning({ from: undefined, baseRef: "origin/main", currentBranch: null, configBaseBranch: "main" })` 이 `null` 이다(판별 실패/detached).
  - `baseMismatchWarning({ from: undefined, baseRef: "origin/main", currentBranch: "main", configBaseBranch: "main" })` 이 `null` 이다(일치).
  - `baseMismatchWarning({ from: undefined, baseRef: "origin/main", currentBranch: "feat/other", configBaseBranch: "main" })` 이 문자열을 반환하고, 그 문자열이 `"feat/other"` 와 `"main"` 을 모두 포함한다(불일치 — 경고).
  - `baseMismatchWarning` 은 위 다섯 케이스를 포함한 모든 입력 조합에서 throw 하지 않는다(순수 함수, 항상 문자열 또는 `null` 반환).
  - **차단하지 않는다**: 경고가 발생하는 시나리오(`main()` 통합 경로)에서도 `worktree-add.mjs` 의 종료 코드는 `0` 이고 worktree 는 정상 생성된다 — 이 사실을 `worktree-add.mjs` 의 `main()` 구현에서 경고 로직이 `try/catch` 나 `process.exit` 분기 밖(성공 경로의 순수 로그 출력)에 있는 것으로 보장한다(리뷰 시점 코드 검토로 확인 가능한 단언 — 실제 git 프로세스를 스폰하는 e2e 테스트는 기존 `worktree-add.test.mjs` 관례에 없으므로 강제하지 않는다).

### 기능: 문서 — `--from` 과 게이트 merge-base 기준선의 관계, 그리고 위 세 기능이 바꾼 서술 갱신

- **의도**: `--from` 은 worktree 의 분기 기준만 바꾸고, 게이트의 merge-base 기준선은 `baseBranch` 그대로다. 이것은 버그가 아니라 의도다 — `git merge-base` 는 공통 조상까지 거슬러 올라가므로 `feat/a-1`(= `feat/a` 에서 분기)에서도 기준선이 `feat/a` 의 분기점으로 수렴하고, 검사 범위가 PR 이 실제로 `baseBranch` 에 얹을 diff 와 일치한다. 그래서 `baseBranch` 를 브랜치마다 갱신할 필요가 없다(갱신하면 커밋된 공유 설정이 오염되고, 다른 worktree 세션까지 그 값을 본다). 이 관계가 현재 `README.md` 어디에도 명시돼 있지 않다.
- **방식**: 이 기능은 코드가 아니라 문서만 바꾼다. 인수기준은 "README 의 어느 절에 무엇이 서술돼 있는가"로 검증 가능하게 쓴다.
- **주의**: 위 세 기능이 코드를 바꾸므로, `README.md`·`harness/pipeline-review.md` 의 다음 서술들이 새 동작과 어긋난 채 남아있지 않아야 한다. QA 모델 이중 출처(`agents/qa.md` 의 `model:` vs `pre-push` 의 `--model`, README '열린 구멍' #5, 논점 H 후반부)는 **이번 범위가 아니므로 미결로 남긴다** — 논점 H 의 결정 기록에 "보호 브랜치는 결정, QA 모델은 미결"이 명시적으로 드러나야 한다.
- **인수기준**:
  - `README.md` 에 `--from` 과 `baseBranch`(merge-base 기준선)의 관계를 설명하는 절/문단이 새로 존재한다. 최소한 다음 두 문장의 취지를 담는다: (1) `--from` 은 worktree 의 분기 기준만 바꾸고 게이트의 merge-base 기준선(`baseBranch`)은 바뀌지 않는다, (2) `merge-base` 가 공통 조상까지 거슬러 올라가므로 리비전 브랜치에서도 검사 범위가 PR 이 실제로 `baseBranch` 에 얹을 diff 와 일치하며, 그래서 `baseBranch` 를 브랜치마다 갱신할 필요가 없다.
  - `README.md` §6 "부재·오류를 다루는 방향이 소비자마다 다르다" 표(:229-239)에서 `baseBranch 만 조용히 DEFAULTS 로 물러선다 ← 결이 다르다 (열린 구멍 #1)`(:236) 줄이, 타입 오타는 이제 `installCommand`·`harnessMetaPaths` 와 함께 throw 한다는 사실을 반영하도록 갱신된다(부재 시 DEFAULTS 로 물러서는 것은 여전히 별도로 명시돼 남는다).
  - `README.md` '열린 구멍' 표(:638-651)의 #1·#2·#7 행이, 각각 타입 검증 추가·config 단일 출처화·불일치 경고 추가로 결과가 바뀌었음을 반영한다(행 삭제든 "해결됨" 표기든 형식은 자유이나, 더 이상 사실과 다른 내용으로 남아있으면 안 된다).
  - `README.md` §8.2 판정 흐름도(:378-400)의 `※ 하드코딩 (열린 구멍 #2)` 주석(:389)이 제거되고, 보호 브랜치 목록이 `config.json` 의 `baseBranch` + `protectedBranches` 에서 온다는 서술로 바뀐다.
  - `harness/pipeline-review.md` 논점 H(:563-577)에 결정 기록 절(다른 논점들의 `#### 결정 (날짜)` 형식을 따른다)이 추가되어, 보호 브랜치를 `config.json` 단일 출처로 옮기기로 한 결정과 근거(`baseBranch` 자동 포함 + `protectedBranches` 선택 필드)를 기록한다. 같은 절 안에 QA 모델 이중 출처는 **이번에 다루지 않고 미결로 남긴다**는 문장이 명시적으로 남는다.

## 범위 밖

- git 훅(`.githooks/pre-commit`·`pre-push`)에 브랜치 보호를 하드로 넣는 것 — README '열린 구멍' #3. 이번엔 손대지 않는다.
- QA 모델 이중 출처(`.claude/agents/qa.md` 의 `model:` vs `pre-push` 의 `--model`) — README '열린 구멍' #5, 논점 H 후반부. 문서 기능(4)의 인수기준에도 명시했듯 미결로 남긴다.
- `worktree-add.mjs` 에 `git fetch` 를 도입하는 것.
- `CLAUDE.md` 가 `main`/`dev` 리터럴을 3곳에 적는 문제(README '열린 구멍' #4)를 고치는 것. 다만 기능(2)의 '주의'에 dev/master 보호 해제로 인해 이 서술이 실제 동작과 다시 어긋난다는 관찰을 남겼다 — 해결은 별도 결정 사항이다.

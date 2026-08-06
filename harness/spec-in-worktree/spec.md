---
branch: refactor/spec-in-worktree
---

# spec-in-worktree

## 목적

`harness/pipeline-review.md` §4(결정 기록, 2026-08-06)가 확정한 새 파이프라인 — **"기획도 worktree 에서 한다"(규칙 1) + "spec 은 브랜치당 한 번만 확정된다"(규칙 2)** — 을 실제 코드·훅·문서에 반영한다. 지금은 planner 가 `main` 체크아웃에서 돌고, spec 이 `main` 에 직접 커밋되며, `warnLaunchContext`/`seedPromptFor` 의 등록 판정이 메인 체크아웃 기준이라 실제 흐름(worktree 에서 planner 를 스폰)과 어긋난다. 이 spec 은 그 어긋남을 없애 **문서가 선언한 모델과 코드가 처음으로 일치**하게 만든다.

이 spec 자신이 규칙 2·규칙 1 의 첫 적용 사례다(frontmatter 의 `branch:`, worktree 안에서 작성됨).

## 범위 밖

`harness/pipeline-review.md` §3 의 미결 논점(A·E·F·G·H·I·J)은 이 spec 의 범위 밖이다. 다만 이 spec 의 구현이 두 논점에 부수 효과를 낸다 — 새 기능으로 만들지 않고 사실만 기록한다:

- **논점 A(load-spec 매 턴 주입의 버전 혼재 위험)** — 규칙 2(기능 1)로 "한 세션 안에서 spec 이 절대 안 바뀐다"가 구조적으로 보장되므로, 논점 A 가 지목한 두 비용 중 **"버전 혼재"** 는 소멸한다. "누적 중복"(컨텍스트 낭비)은 그대로 남는다 — 여전히 미결.
- **논점 G(index.json 의 브랜치:spec 1:1 vs CLAUDE.md 의 "spec 마다 커밋" 문구)** — 규칙 2 로 "한 브랜치=spec 하나"가 훅으로 강제되므로 그 문구가 서술하던 상황(한 세션이 여러 spec 을 갈아타며 커밋)은 애초에 일어날 수 없다. 기능 7 이 그 문구를 삭제하는 것으로 이 불일치도 함께 없어진다.

## 기능 목록

### 기능: `.githooks/pre-commit` — spec 소유권 검사 (규칙 2 강제)

- **의도**: "한 브랜치는 spec 을 정확히 한 번만 확정한다"를 사람의 규율이 아니라 훅으로 강제한다. 이게 없으면 규칙 2 는 CLAUDE.md 의 문장일 뿐이고, 세션이 같은 브랜치에서 spec 을 계속 고쳐 써도 아무것도 막지 않는다.
- **방식**:
  - 판정 로직을 순수 함수로 뽑아 새 파일 `.claude/hooks/spec-lock.mjs` 에 둔다(git/fs 를 직접 부르지 않는 부분과, CLI 로 실제 훅이 호출하는 부분을 분리 — `gate.mjs`/`worktree-add.mjs` 와 같은 관례).
    - `frontmatterBranch(text)`: spec 텍스트에서 **첫 `---` 줄과 그다음 `---` 줄 사이(frontmatter 블록)만** 보고, 그 안에서 `/^branch:\s*(.+?)\s*$/` 에 매칭되는 첫 줄의 값을 반환한다. 블록이 없거나(첫 줄이 `---` 가 아님) 닫는 `---` 가 없거나 블록 안에 `branch:` 가 없으면 `null`.
    - `isRevisionAttempt(frontmatterText, branch)`: `frontmatterBranch(frontmatterText) === branch`.
    - CLI(직접 실행 시): **stdin 전체**를 텍스트로, `argv[2]` 를 브랜치로 받아 `isRevisionAttempt` 가 true 면 `exit 1`, 아니면 `exit 0`. **메시지는 출력하지 않는다** — 사람에게 보여줄 문구는 훅(`say()`)의 몫으로 남겨 SIGPIPE 방어를 한곳(shell)에 유지한다.
  - `.githooks/pre-commit` 의 기존 단계 0(부분 스테이징 거부)과 단계 1(객관 게이트) **사이**에 새 단계를 추가한다(번호는 그대로 밀어도 되고 `0.5`처럼 둬도 된다 — 인수기준에 영향 없는 선택):
    ```sh
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    SPEC="$(node -e "try{const i=require('./harness/index.json');process.stdout.write(i.tasks['$BRANCH']||'')}catch(e){}")"
    if [ -n "$SPEC" ] && git diff --cached --name-only | grep -qxF "$SPEC"; then
      if ! git show "HEAD:$SPEC" 2>/dev/null | node .claude/hooks/spec-lock.mjs "$BRANCH"; then
        say "[pre-commit] ❌ '$SPEC' 은 이미 이 브랜치('$BRANCH')에서 확정된 spec 입니다." \
            "             spec 개정은 새 브랜치에서 하세요: node scripts/worktree-add.mjs <새 브랜치> --from $BRANCH --launch"
        exit 1
      fi
    fi
    ```
    (`SPEC` 조회는 `.githooks/pre-push:46` 의 기존 `node -e` 패턴을 그대로 재사용한다 — 같은 조회를 두 번째로 다르게 구현하지 않는다.)
- **주의**:
  - **검사 위치는 게이트(`gate.mjs`) 앞이어야 한다** — 이 검사는 O(1)이고 실패를 훅 실행 초반에 값싸게 알린다. 게이트 뒤에 두면 무거운 typecheck/test 가 다 돈 뒤에야 "브랜치를 잘못 골랐다"는 사실이 드러난다.
  - `git diff --cached --name-only | grep -qxF "$SPEC"` 는 **`-F`(고정 문자열)** 를 반드시 써야 한다 — spec 경로는 `harness/<task>/spec.md` 처럼 `.` 을 포함하므로, `-F` 없는 `grep -qx` 는 정규식으로 해석돼 우연히 다른 경로와 오매칭할 여지가 남는다(`pipeline-review.md` §4-3 의 스니펫에는 `-F` 가 없다 — 이 spec 은 그것을 개선한다).
  - `HEAD:$SPEC` 이 없을 때(브랜치 최초 spec 작성, 아직 커밋된 적 없음) `git show` 는 실패해 `2>/dev/null` 로 조용해지고, 빈 stdin 이 `spec-lock.mjs` 로 들어가 `frontmatterBranch("")` → `null` → `isRevisionAttempt` → `false` → `exit 0`(통과). 별도 분기 없이 자연스럽게 "최초 작성 → 통과"가 성립한다.
  - **frontmatter 밖의 `branch:` 오인 방지**가 이 설계의 핵심 개선점이다 — 순수 `sed -n 's/^branch:.../p'` 는 파일 전체에서 줄 시작이 `branch:` 인 모든 줄을 잡으므로, spec 본문(예: "## 방식" 절에 "브랜치 전략: branch: ..." 같은 문장)에 우연히 걸릴 수 있다. `frontmatterBranch` 는 첫 `---`~다음 `---` 블록으로 범위를 좁혀 이 위험을 없앤다.
  - `$SPEC` 이 비어 있으면(현재 브랜치가 `index.json` 에 미등록) 검사 자체를 건너뛴다 — 애드혹 브랜치에서 spec 없이 하는 커밋은 이 규칙의 대상이 아니다.
  - **테스트에서 이 훅 전체(`sh .githooks/pre-commit`)를 실행하지 않는다.** `pre-commit` 은 단계 1에서 `node scripts/gate.mjs` → `npx vitest run` 을 부른다. vitest 테스트 안에서 실제 `pre-commit` 을 실행하면 **vitest 가 자기 자신을 재귀적으로 스폰**한다(중첩 실행/행 위험). 그래서 이 기능의 검증은 ① `spec-lock.mjs` 의 순수 함수 단위 테스트, ② `spec-lock.mjs` 를 **CLI 로 서브프로세스 실행**(stdin 에 문자열을 직접 파이프 — git 을 전혀 부르지 않으므로 `.claude/rules/test-git.md` 대상도 아니다)하는 두 층만으로 한다. `.githooks/pre-commit` 자체의 end-to-end 실행은 범위 밖(사람이 실제 커밋 흐름으로 1회 확인 — '사람 확인 필요' 참고).
- **인수기준**:
  - `frontmatterBranch`: 정상 frontmatter(`---\nbranch: feat/a\n---\n...`) → `"feat/a"`. 값 앞뒤 공백은 트리밍된다. CRLF(`\r\n`) 입력에서도 동일하게 동작한다.
  - `frontmatterBranch`: 첫 줄이 `---` 가 아니면(frontmatter 없음) `null`.
  - `frontmatterBranch`: 여는 `---` 는 있는데 닫는 `---` 가 없으면 `null`(본문 전체를 블록으로 오인하지 않는다).
  - `frontmatterBranch`: frontmatter 블록 **밖**의 본문에 줄 시작이 `branch:` 인 텍스트가 있어도 그 값을 반환하지 않는다(블록 안에 `branch:` 가 없으면 `null`).
  - `isRevisionAttempt(text, branch)`: `frontmatterBranch(text) === branch` 인 조합에서 `true`, 다른 브랜치 값이거나 `null` 이면 `false`.
  - CLI 서브프로세스: `echo "---\nbranch: feat/a\n---" | node .claude/hooks/spec-lock.mjs feat/a` → 종료코드 `1`. 브랜치를 `feat/a-1` 로 바꾸면 종료코드 `0`. 빈 입력이면 종료코드 `0`.
  - 코드 리뷰로 확인: `.githooks/pre-commit` 이 이 검사를 기존 단계 0 과 (기존) 단계 1(`node scripts/gate.mjs`) 사이에서 호출한다.

### 기능: `scripts/worktree-add.mjs` — `--from <branch>` 지원

- **의도**: §4-1 의 리비전 흐름(`node scripts/worktree-add.mjs <branch>-1 --from <branch> --launch`)이 성립하려면 분기 기준을 `config.baseBranch` 가 아니라 지정된 브랜치로 바꿀 수 있어야 한다.
- **방식**:
  - `parseArgs` 의 반환 타입을 `{ branch, seed, from }` 으로 확장한다. `--from <값>` / `--from=<값>` 을 `--seed` 와 동일한 패턴(다음 토큰을 소비하거나 `=` 뒤 값을 취함, 값 토큰을 브랜치로 오인하지 않음)으로 지원한다.
  - `--from` 값의 형식 검증은 브랜치명 검증(`taskFromBranch` 가 이미 쓰는 정규식)과 같은 기준을 적용한다 — worktree 를 만들기 **전에** 잘못된 값이면 에러로 멈춘다(중간 상태 방지).
  - 새로 분기해야 하는 경로(`ensureWorktree` 가 `branchExists=false` 로 판단하는 경우)에서 `resolveBaseRef` 에 넘길 기준 브랜치 이름을 고르는 순수 함수를 추가한다:
    ```js
    export function baseForNewBranch({ from, configBaseBranch }) {
      return from || configBaseBranch;
    }
    ```
    `main()` 은 `ensureWorktree(branch, path, baseForNewBranch({ from, configBaseBranch: config.baseBranch }))` 형태로 호출한다.
- **주의**:
  - 브랜치가 **이미 존재해 attach 되는 경우**(`ensureWorktree` 가 `baseRef: null` 반환, 즉 중단 재개 시나리오) `--from` 값은 애초에 쓰이지 않는다(`resolveBaseRef` 자체를 안 부른다 — attach 경로가 기준 브랜치 없이도 동작해야 한다는 기존 불변식을 유지한다). 이때 사용자가 실수로 `--from` 을 줬는지 "중단 재개라 무시된 것"인지 구분이 안 되면 혼란스러우므로, **정보성 로그 한 줄**을 남긴다(경고가 아니다 — attach 는 정상 경로다): `[worktree-add] ℹ '<branch>' 가 이미 존재해 --from '<from>' 은 쓰이지 않고 기존 브랜치를 attach 합니다.`
  - `--from` 과 `--seed` 를 함께 줄 때 인자 순서에 무관하게 각자의 값 토큰을 서로 오인하지 않아야 한다(`--seed` 하나만 있을 때 이미 처리된 함정과 같은 종류).
  - 이 기능은 `resolveBaseRef`/`ensureWorktree`/`worktreeAddArgs` 자체를 바꾸지 않는다 — `baseBranch` 자리에 넘기는 **문자열 선택**만 바뀐다(기존 순수 함수들의 계약을 유지).
- **인수기준**:
  - `parseArgs(["feat/a-1", "--from", "feat/a"])` → `{ branch: "feat/a-1", from: "feat/a", seed: undefined }`.
  - `parseArgs(["--from=feat/a", "feat/a-1"])` 도 동일한 결과.
  - `parseArgs(["--from", "feat/a", "feat/a-1"])` 에서 `"feat/a"`(from 의 값 토큰)가 `branch` 로 오인되지 않는다(`branch === "feat/a-1"`).
  - `parseArgs(["feat/a-1", "--from", "feat/a", "--seed", "go"])` → 세 값이 각각 올바르게 분리된다.
  - `baseForNewBranch({ from: "feat/a", configBaseBranch: "main" })` → `"feat/a"`. `baseForNewBranch({ from: undefined, configBaseBranch: "main" })` → `"main"`(기존 동작 유지).
  - 형식이 잘못된 `--from` 값(예: 빈 문자열, `..` 포함, 선행 `-`)은 `git worktree add` 를 시도하기 전에 에러로 종료한다.

### 기능: `scripts/worktree-add.mjs` — 등록 판정을 생성된 worktree 기준으로 분리하고 `seedPromptFor` 를 2분기한다 (§4-4-1)

- **의도**: §4-4-1 이 명시한 핵심 — seed 문구가 "기획부터"인지 "이어서 작업"인지는 **방금 확보한 worktree 경로의 `harness/index.json`** 을 봐야 옳게 갈린다. 신규 task(baseBranch 분기)와 리비전(`--from`)은 그 worktree 에 아직 해당 브랜치 키가 없어 미등록 → 기획부터. **중단 재개(같은 브랜치 attach)만 등록됨 → 이어서 작업**이다. root 기준으로 판정하면 세 번째(가장 흔한 재개 시나리오)마저 "기획부터"로 나가, 이미 확정된 spec(규칙 2 로 재작성이 막혀 있는)을 다시 쓰라고 지시하는 모순이 생긴다.
- **방식**:
  - 순수 함수 `isTaskRegistered(indexJsonText, branch)` 를 추가한다: `JSON.parse` 시도 → `Boolean(parsed?.tasks?.[branch])`. 파싱 실패/`undefined` 입력은 **`false`(미등록)** 로 판정한다(근거는 '주의' 참고). 파일을 직접 읽지 않는다 — 텍스트를 인자로 받는다(순수성 유지, git/fs 는 `main()` 의 몫).
  - `seedPromptFor` 의 시그니처를 `seedPromptFor(branch, { registered })` 로 확장한다:
    - `registered: false` → 기획부터 시작하라는 문구(예: `"<task> 기획부터 시작 — planner 를 스폰해 harness/<task>/spec.md 를 작성한 뒤 test-first 로 구현"`).
    - `registered: true` → 기존 문구와 동등한 "이어서 구현" 문구(현재의 `seedPromptFor(branch)` 출력과 의미상 동일해도 된다).
    - 두 분기 모두 spec 경로 문자열을 포함하지 않는다(기존 관례 유지 — `load-spec` 이 알아서 주입한다).
  - `main()`: `ensureWorktree` 로 `path` 를 확보한 **이후**, `readFileSync(join(path, "harness/index.json"), "utf8")`(실패하면 `undefined`)를 `isTaskRegistered` 에 넘겨 `registered` 를 얻는다. `--seed` 가 주어졌으면 이 판정 결과와 무관하게 그 값을 그대로 쓴다(기존 우선순위 유지).
- **주의**:
  - **판정은 반드시 `ensureWorktree` 이후**여야 한다 — 그 전엔 worktree 디렉터리 자체가 없어 읽을 파일이 없다.
  - **판정은 root 가 아니라 `path`(생성/확보된 worktree)의 `harness/index.json` 을 읽는다.** 신규/리비전 브랜치의 경우 그 파일은 분기 기준 브랜치(baseBranch 또는 `--from` 대상) 시점의 내용이므로 현재 브랜치 키가 없다 → 미등록이 자연스럽게 나온다. 재개(attach)의 경우 그 브랜치 자신의 커밋 이력에 이미 등록이 있으므로 등록됨이 나온다. 이 차이가 세 시나리오를 가르는 유일한 근거다.
  - **부재/파싱 실패 시 "미등록"으로 판정한다.** 근거(두 오판의 비대칭성):
    - **미등록으로 잘못 판정**(실제론 등록됨)했을 때 최악의 경우: 세션이 다시 spec 작성을 시도한다. 하지만 이미 확정된 spec 이 있으면 리비전 모드(planner 의 기능, 이 spec 의 다른 기능 참고)가 그것을 감지해 개정으로 처리하거나, 그래도 그대로 재작성을 시도하면 **기능 1(pre-commit 소유권 검사)이 커밋 단계에서 안전하게 막는다.** 대가는 유한한 재작업 시간이다.
    - **등록됨으로 잘못 판정**(실제론 미등록)했을 때: 세션이 "spec 대로 이어서 구현하라"는 지시를 받는데 spec 이 없다 → doc-before-code 를 건너뛴 채 코드부터 짜기 시작할 수 있다. 이건 훅이 사후에 잡아줄 장치가 없는 **구조적 실패**다.
    - 따라서 **덜 해로운 실패 방향인 "미등록"으로 기운다.**
- **인수기준**:
  - `isTaskRegistered('{"tasks":{"feat/a":"harness/a/spec.md"}}', "feat/a")` → `true`.
  - `isTaskRegistered('{"tasks":{}}', "feat/a")` → `false`.
  - `isTaskRegistered("not json", "feat/a")` → `false`(파싱 실패).
  - `isTaskRegistered(undefined, "feat/a")` → `false`(파일 부재를 흉내).
  - `seedPromptFor("feat/a", { registered: false })` 와 `seedPromptFor("feat/a", { registered: true })` 는 서로 다른 문자열이다.
  - 두 분기 모두 결과 문자열이 `/spec\.md/` 에 매칭되지 않는다.
  - `--seed` 인자가 주어지면(예: `parseArgs(["feat/a", "--seed", "go"]).seed`) `main()` 의 최종 seed 로 그 값이 쓰이고, `isTaskRegistered`/`seedPromptFor` 조합에서 나온 값으로 덮이지 않는다 — 기존 `--seed` 우선순위 테스트(값 토큰 오인 방지 포함)가 이 리팩터 이후에도 그대로 통과한다.

### 기능: `scripts/worktree-add.mjs` — `warnLaunchContext` 를 함수째 제거한다 (§4-4-1)

- **의도**: 이 함수는 **메인 체크아웃의** `harness/index.json` 을 읽는다(`worktree-add.mjs:265` 부근). 새 흐름에서 등록은 언제나 작업 브랜치 위에서 일어나므로, 그 정보는 머지 전까지 `main` 에 없다 — 살아 있는 모든 task 에 대해 **항상 '미등록'을 반환하는, 정보량이 0인 경고**다. 남겨두면 정상적인 신규 task 생성마다(그리고 리비전마다) 매번 오탐 경고가 뜬다.
- **방식**:
  - `warnLaunchContext` 함수 정의를 삭제한다.
  - `main()` 의 `--launch` 블록에서 `warnLaunchContext(root, branch)` 호출을 삭제한다.
  - "등록됐는데 spec 파일 부재" 를 검사하던 하위 분기도 함께 삭제한다 — planner 가 spec 과 index 등록을 **한 커밋**에 쓰므로(기존 planner.md 마무리 절차) 그 상태는 구조적으로 발생하지 않는다.
- **주의**: `root` 변수 자체는 다른 목적(설정 파일 읽기, `worktreePathFor` 계산 등)에 계속 쓰이므로 `root` 을 지우는 게 아니라 **이 함수의 정의와 호출부만** 제거한다.
- **인수기준**:
  - `scripts/worktree-add.mjs` 소스 전체에 `warnLaunchContext` 라는 식별자가 더 이상 존재하지 않는다(정의도 호출도).
  - `--launch` 실행 경로가 등록 여부 관련 `console.warn` 호출 없이(등록 판정은 이제 seed 선택에만 쓰이지 경고 출력에는 안 쓰인다) 동작한다 — 코드 리뷰로 확인 가능(제거된 코드 경로이므로 별도 스냅샷 테스트를 요구하지 않는다).

### 기능: `.claude/agents/planner.md` — spec frontmatter 기록 + 리비전 task 유도 + 리비전 모드

- **의도**: 기능 1(pre-commit 의 소유권 검사)이 읽는 `branch:` frontmatter 를 planner 가 실제로 써야 규칙 2 가 성립한다. 또 리비전 브랜치(`feat/a-1`)가 원본과 **같은** `harness/a/spec.md` 를 가리켜야 §4-1 의 흐름이 성립하고, 기존 spec 이 있으면 처음부터 다시 쓰지 않고 **개정**해야 한다.
- **방식**:
  1. **frontmatter 기록** — `spec.md` 산출 형식의 맨 앞에 아래 블록을 추가한다(기능 1 의 `frontmatterBranch` 가 파싱하는 정확한 형식과 일치해야 한다):
     ```markdown
     ---
     branch: <현재 브랜치>
     ---

     # <태스크명>
     ...
     ```
  2. **리비전 task 유도** — `<task>` 산출 규칙에 "브랜치의 마지막 세그먼트 끝에 붙은 `(-<숫자>)+` 패턴(하나 이상 연쇄된 `-숫자`)은 리비전 번호이므로 제거한 나머지를 `<task>` 로 쓴다"를 추가한다.
     - 예: `feat/a-1` → `harness/a/`. `feat/a-1-2`(리비전의 리비전) → `harness/a/`(연쇄 전부 제거, 같은 spec 경로 유지).
     - 반례: `feat/oauth2` → 세그먼트가 `oauth2` 이고 끝이 `-<숫자>` 형태가 아니므로(하이픈이 없음) 그대로 `harness/oauth2/`.
     - **주의를 명시적으로 적는다**: 이 규칙은 순전히 문자열 패턴이라, 리비전이 아닌데 이름이 우연히 `-<숫자>` 로 끝나는 브랜치(예: `feat/sprint-3`)는 오판된다. 브랜치 명명 시 리비전이 아닌 작업은 숫자로 끝나는 접미사를 피하라고 규칙에 명시한다.
     - `worktreePathFor`(worktree 경로 계산)의 `taskFromBranch` 는 건드리지 않는다 — §4-4 가 명시한 대로 **worktree 경로는 브랜치 전체**를 쓰고(`...-a` vs `...-a-1` 충돌 방지) **spec 디렉터리만** 리비전 번호를 뗀다. 두 용도가 다르므로 겸용하지 않는다.
  3. **리비전 모드** — planner 는 `Read` 로 `harness/<task>/spec.md` 존재 여부를 먼저 확인한다.
     - **없으면**: 기존 규칙대로 처음부터 작성.
     - **있으면**(리비전): 파일 전체를 처음부터 다시 쓰지 않는다. 요청된 변경(주로 `--seed "spec 개정 — <요청 내용>"` 로 전달됨, 또는 대화 맥락)에 해당하는 기능 항목만 추가/수정하고, 바뀌지 않은 기능은 그대로 보존한다. 파일 하단에 `## 개정 이력` 절(없으면 새로 만듦)에 한 줄을 추가한다: `- <YYYY-MM-DD> <이전 브랜치> → <새 브랜치>: <무엇을 왜 바꿨는지 한 줄>`.
     - **frontmatter 의 `branch:` 값만 새 브랜치로 갱신**하고 나머지는 개정 규칙(위)을 따른다.
- **주의**:
  - **규칙 2 판정과의 상호작용을 명시한다**(§4-4-1 이 확인을 요구한 부분): 리비전 브랜치(`feat/a-1`)에서 처음 커밋할 때, 작업 트리의 `harness/a/spec.md` frontmatter 는 이미 `branch: feat/a-1`(새 값)로 바뀌어 있다. 그런데 pre-commit 의 소유권 검사가 보는 것은 **`HEAD:harness/a/spec.md`**(커밋되기 *전*, 즉 `feat/a-1` 이 분기해 온 시점의 내용)이고, 그 값은 여전히 `branch: feat/a`(옛 브랜치)다. `feat/a ≠ feat/a-1` 이므로 **통과**한다 — §4-3 판정 표의 "리비전 브랜치 첫 개정 → 통과" 행이 실제로 이렇게 성립한다. 이후 같은 브랜치(`feat/a-1`)에서 같은 파일을 또 고쳐 커밋하려 하면, 그때는 `HEAD:harness/a/spec.md` 가 이미 `branch: feat/a-1` 이므로 **차단**된다 — 의도한 그대로다.
  - `## 개정 이력` 은 리비전 때만 추가되고, 최초 작성 spec 에는 없다(불필요한 절을 강제로 만들지 않는다).
  - **테스트 가능성**: 이 기능은 전부 `.claude/agents/planner.md` 의 프롬프트(자연어 지시)이고, 실행되는 것은 LLM 이지 코드가 아니다 — vitest 로 옮길 수 없다. `frontmatterBranch`/`isRevisionAttempt`(기능 1)의 단위 테스트가 **출력 형식이 훅과 어긋나면 실패로 드러나는** 간접 안전망이다. 이 기능 자체의 인수기준은 문서 검토 + 실제 planner 스폰 결과 관찰로 확인한다(아래).
- **인수기준**:
  - `planner.md` 의 산출 형식 절에 위 frontmatter 블록이 리터럴로 포함돼 있다(사람이 읽어 확인).
  - `planner.md` 에 리비전 task 유도 규칙(정규식 의도와 `feat/oauth2` 반례)이 명시돼 있다(사람이 읽어 확인).
  - `planner.md` 에 리비전 모드(기존 spec 존재 시 Read → 개정 → `## 개정 이력` 추가 → frontmatter `branch:` 만 갱신)가 명시돼 있다(사람이 읽어 확인).
  - (간접·자동) 기능 1 의 `frontmatterBranch` 단위 테스트가 이 절이 규정하는 정확한 형식(`---\nbranch: <값>\n---`)을 입력으로 성공적으로 파싱한다 — 형식이 어긋나면 이 테스트가 실패해 드러난다.

### 기능: `.claude/agents/planner.md` — worktree 에서 브랜치를 판별하는 방법

- **의도**: 현행 `planner.md:13` 은 "`.git/HEAD` 를 Read" 라고만 되어 있는데, **링크드 worktree 에서 `.git` 은 디렉터리가 아니라 파일**이다(이 worktree 자신에서 실측: `.git` 의 내용은 `gitdir: C:/Users/.../\.git/worktrees/harness-engineering-spec-in-worktree` 한 줄이다). 규칙 1(planner 도 worktree 에서 돈다)이 확정된 지금, planner 는 **항상** worktree 에서 스폰되므로 기존 지시는 **정규 흐름에서 100% 실패**한다. planner 는 Bash 가 없어 `git rev-parse` 를 못 쓰므로 Read 만으로 해결해야 한다.
- **방식**: 브랜치 판별 절차를 다음 2분기로 교체한다.
  1. `.git` 을 **Read** 한다.
  2. 내용이 `gitdir: <경로>` 패턴(한 줄, 이 접두어로 시작)이면 — 링크드 worktree 다. `<경로>/HEAD` 를 Read 한다.
  3. 그 외의 경우(Read 결과가 디렉터리라 실패하거나, 내용이 그 패턴이 아니면) — 기존 방식대로 `.git/HEAD` 를 Read 한다(일반 체크아웃/메인 저장소).
  4. 어느 경로로 얻었든 `HEAD` 파일의 내용은 `ref: refs/heads/<branch>` 형식이다 — `<branch>` 를 취한다. 이 형식이 아니면(detached HEAD 등) 기존 규칙대로 사용자에게 `<task>` 이름을 묻는다.
- **주의**:
  - 이 알고리즘은 Read 도구만으로 완결돼야 한다(Bash 없음이 전제) — `gitdir:` 파일도, 그 경로의 `HEAD` 도 둘 다 일반 텍스트 파일이라 Read 로 읽힌다.
  - 규칙 1 로 planner 가 항상 worktree 에서 도는 게 기본이 됐지만, 메인 체크아웃에서의 예외적 사용(하네스 메타작업 등)을 완전히 배제하지 않기 위해 3번(디렉터리인 `.git`) 분기를 남긴다 — 하위 호환.
- **인수기준**:
  - `planner.md` 에 위 2(3)분기 절차가 명시돼 있다(사람이 읽어 확인).
  - **실측 근거가 spec 에 남는다**: 이 worktree(`harness-engineering-spec-in-worktree`)의 `.git` 파일 내용이 실제로 `gitdir: <절대경로>` 패턴이고, 그 경로의 `HEAD` 파일이 `ref: refs/heads/<branch>` 형식이라는 사실은 이 spec 작성 과정에서 이미 확인됐다(위 '의도' 절 인용). 이 사실관계가 바뀌지 않는 한(즉 Git 의 worktree 구현이 바뀌지 않는 한) 이 절차는 유효하다.
  - planner 가 이 절차를 코드로 실행하지 않으므로(LLM 프롬프트), 이 기능에 vitest 인수기준은 없다 — 문서 검토 + 다음 실제 planner 스폰에서 브랜치를 올바르게 판별하는지 관찰로 확인한다.

### 기능: `.claude/CLAUDE.md` — 새 파이프라인 반영

- **의도**: §4-4 의 요구 변경 표가 명시한 다섯 군데를 반영해, 문서가 규칙 1·2 및 §4-5(폐기된 안)와 일치하게 한다. §4-6 의 판정 기준(①훅이 강제 ②장치가 소비 ③실제 hazard 방지) 을 넘지 못하는 새 문장은 추가하지 않는다 — 아래 항목은 모두 §4-4/§4-5 가 명시적으로 요구한 것이거나 그 직접적 결과다.
- **방식** — 다음 다섯 가지 편집만 한다(그 외 새 규약 문장을 임의로 추가하지 않는다):
  1. **`main` = 디스패처 명시**: "하네스 개발자 프로토콜" 절 또는 "worktree 동시작업 규약" 절 서두에, `main` 체크아웃 세션은 요구사항 논의와 `node scripts/worktree-add.mjs <branch> --launch` 실행만 하는 **디스패처**이고, planner 스폰을 포함한 실제 작업(기획·개발)은 전부 worktree 세션이 한다는 문장을 추가한다(규칙 1, §4-2 근거).
  2. **spec 개정은 새 브랜치(`--from`)로 한다**: "worktree 동시작업 규약"의 `--from` 관련 설명을 추가하거나, "멈추는 경우" 절 인근에 "PR 에서 spec 변경이 필요하면 같은 브랜치에서 spec 을 다시 고치지 않는다(규칙 2 가 pre-commit 으로 차단한다) — `node scripts/worktree-add.mjs <새 브랜치> --from <원본 브랜치> --launch` 로 새 worktree/세션을 연다"는 문장을 추가한다.
  3. **커밋 입도 문구 삭제**: "자동 커밋 + push" 절의 "**커밋 단위**: spec 1개당 1커밋(끝에서 한 번) — 코드 + 테스트 + `qa-checklist.md`를 한 커밋에 담는다. 여러 spec을 한 세션에서 진행하면 spec마다 커밋한다." 문장을 **삭제한다**(대체 문장을 새로 쓰지 않는다). 근거(§4-5): "한 기능"의 경계는 spec 의미를 읽어야 알 수 있어 훅으로 검증 불가하고, 어떤 하네스 장치도 커밋 입도를 소비하지 않는다 — §4-6 기준 셋 다 통과하지 못한다. 또한 규칙 2 로 "한 브랜치=spec 하나"가 이미 보장되므로 "여러 spec을 한 세션에서" 라는 전제 자체가 성립하지 않는다(논점 G 참고). 코드+테스트+qa-checklist 를 한 커밋에 담는다는 사실 자체는 "QA 체크리스트 생성" 절과 "자동 커밋" 절의 순서(QA 먼저 → 그다음 `git add -A` 커밋)로 이미 구조적으로 드러나므로 별도 문장이 없어도 정보 손실이 없다.
  4. **doc-before-code 를 인수기준 변경 여부로 조건화**: "새 기능뿐 아니라 리비전·후속 수정·하네스 자체 수정도 코드보다 spec/문서를 먼저 확정한다"는 기존 문장을, "**동작(인수기준)이 바뀌는** 변경은 코드보다 spec/문서를 먼저 확정한다. 인수기준 변경 없는 순수 리팩터·오타 수정·이미 있는 문서 문구 다듬기는 예외다"로 다듬는다. (이 조건화 자체는 §4-4 표가 명시적으로 요구한 편집이라 §4-6 필터를 별도로 통과할 필요가 없다 — 이미 있던 doc-before-code 원칙의 범위를 좁히는 것이지 새 hazard 방지 문장을 만드는 게 아니다.)
  5. **계보(리비전 브랜치) 정리 규약**: "worktree 동시작업 규약"의 "정리" 항목 근처에, 리비전이 거듭되면(`feat/a` → `feat/a-1` → `feat/a-1-2` …) 오래된 브랜치의 worktree 가 여러 개 남을 수 있고, 그 정리는 기존 규약대로(비가역이므로 자동화하지 않고) **사람이 수행**한다는 문장을 추가한다. 새로운 강제나 자동화를 만들지 않는다(§4-6 기준 ③에 해당하는 서술일 뿐 — hazard 는 "안 지우면 worktree 가 계속 쌓인다"는 사실 자체지 새 장치가 아니다).
- **주의**:
  - `harness/config.json` 의 `baseBranch`·게이트 대상 등 **설정값 사본을 CLAUDE.md 에 새로 적지 않는다** — 이 저장소의 기존 원칙(README §10 "프로젝트 규약을 CLAUDE.md 에 쓰지 않는 이유", CLAUDE.md 자신의 "검증 명령" 절)을 그대로 따른다. `--from` 설명도 옵션의 **존재와 용도**만 적지, `baseBranch` 값 자체를 재서술하지 않는다.
  - 위 다섯 항목 **외의** 새로운 규약 문장을 추가하지 않는다 — §4-6 필터를 넘지 못하는 문장을 넣지 않기 위한 의도적 제약이다.
- **인수기준**: 위 1~5 각각이 `.claude/CLAUDE.md` 에 반영돼 있고(사람이 읽어 확인), 삭제 대상으로 지목된 문장(3번)이 더 이상 존재하지 않는다(문자열 부재는 grep 으로 기계적으로 확인 가능: `"spec 1개당 1커밋"` 문자열이 파일에 없다).

### 기능: `README.md` §2 플로우 갱신 + 끊긴 `BACKLOG.md` 참조 정리

- **의도**: `BACKLOG.md` 는 `7b4b47e` 로 이미 삭제됐는데 README 는 여전히 5곳(서두, §1 인근, 본문 각주 3곳, §12 인근 — 관찰 ⑧)에서 `./BACKLOG.md` 를 링크한다. 동시에 §2 의 플로우 다이어그램은 "기획자가 spec 을 쓴다 → worktree 를 만든다" 순서로, `main` 이 디스패처가 되는 새 파이프라인(§4-1)과 순서가 어긋난다.
- **방식**:
  1. **§2 플로우 다이어그램 교체**: 현재 "사람 ──▶ 기획자(planner) → spec.md/index.json 등록 → worktree 생성 → 개발자…" 순서를, §4-1 의 확정 파이프라인과 같은 순서로 바꾼다 — `사람+AI 논의(브랜치명 확정, main=디스패처) → node scripts/worktree-add.mjs <branch> --launch → [worktree 세션] planner 스폰 → spec 작성/커밋 → 이어서 개발자가 test-first 구현 → gate → QA → commit → push → PR → 사람 리뷰(머지/거부) → 거부 시 --from 으로 리비전 브랜치`. 이후 단계(게이트/QA/커밋/push, §2 다이어그램의 후반부)는 이미 정확하므로 그대로 둔다.
  2. **끊긴 링크 정리** — `[BACKLOG #N](./BACKLOG.md)` 형태의 각주 링크(관찰들이 지목한 §5 인근 3곳: 구 #1·#7·#9)는 `pipeline-review.md` 가 이미 쓰는 관례를 따라 **일반 텍스트** `구 BACKLOG #N`(링크 아님)으로 바꾼다 — 그 사건들 자체는 역사적 사실이라 인용은 유지하되, 존재하지 않는 파일을 가리키는 링크만 없앤다.
  3. **"잔여 작업" 안내 두 곳**(문서 서두의 "잔여 작업은 [`BACKLOG.md`](./BACKLOG.md) 참고", §12 아래 "알려진 제약" 절의 같은 취지 문장)은 **BACKLOG.md 를 되살리지 않는다**(논점 J 미결 — 이 spec 의 범위 밖). 대신 존재하는 파일을 가리키도록 고친다: "BACKLOG.md 는 삭제됐고, 남은 논점은 `harness/pipeline-review.md` 를 참고한다."는 취지로 다시 쓴다.
  4. **`harness/config.json` 의 `harnessMetaPaths` 에서 `"BACKLOG.md"` 항목을 제거하는 것을 이 spec 의 결정으로 명시한다**(실제 편집은 개발자가 한다 — planner 는 `harness/` 밖... 아니, `harness/config.json` 은 `harness/` 안이라 편집 권한 자체는 있지만, **이 파일은 spec 이 아니라 설정이므로 구현 단계의 산출물**로 남긴다. planner 는 결정과 근거만 spec 에 적는다). **결정: 제거한다.** 근거: `isHarnessMeta` 는 파일 존재를 확인하지 않으므로 남겨둬도 즉시 오작동하지는 않지만(무해), 존재하지 않는 파일에 대한 면제 항목을 남겨두는 것은 이 저장소가 반복해서 경고해 온 "낡은 사본"(관찰 ⑧이 정확히 이 항목을 지목했다) 그 자체다. 나중에 논점 J 가 다른 이름으로든 같은 이름으로든 잔여 작업 문서를 부활시키면, 그때 그 결정과 함께 필요한 항목을 다시 추가하면 된다(한 줄 추가 비용은 낮다) — 지금 죽은 항목을 남겨 둘 이유가 더 적다.
- **주의**:
  - README §1(역할 모델 표)·§3(구성 트리)·§4~§11 은 이미 사실과 맞으므로 건드리지 않는다 — §2 와 BACKLOG 링크만 범위다.
  - `gate.test.mjs`/`verify-branch.test.mjs` 는 `harnessMetaPaths` 를 **자체적으로 구성한 배열**(`loadConfig(JSON.stringify({ harnessMetaPaths: [...] }))`)로 테스트하지, 저장소의 실제 `harness/config.json` 파일 내용을 읽어 단언하지 않는다 — `"BACKLOG.md"` 제거가 기존 테스트를 깨지 않는다(코드 확인 완료).
- **인수기준**:
  - `README.md` 전체에서 `./BACKLOG.md` 링크(마크다운 링크 문법)가 더 이상 존재하지 않는다(`grep -c "BACKLOG.md)" README.md` 또는 동등한 검색으로 0건 — 기계적으로 확인 가능).
  - §2 의 다이어그램 첫 단계가 "worktree 생성" 이 "기획자 spec 작성" 보다 앞선다(사람이 읽어 확인 — 다이어그램은 텍스트 아트라 정규식 단언은 취약하므로 사람 확인으로 둔다).
  - `harness/config.json` 의 `harnessMetaPaths` 배열에 `"BACKLOG.md"` 문자열이 없다(구현 완료 후 파일 내용을 기계적으로 확인 가능).

## 사람 확인 필요

- **`.githooks/pre-commit` 의 실제 셸 실행(end-to-end) 검증**: 기능 1 은 재귀 vitest 위험 때문에 `spec-lock.mjs` 를 단위·서브프로세스로만 검증하고, 셸 훅 전체(`sh .githooks/pre-commit`)를 실제 git 커밋 흐름에서 실행하는 것은 자동 테스트 범위 밖으로 뒀다. 이 worktree 든 다른 worktree 든, 실제로 spec 을 커밋하고 같은 브랜치에서 재수정 커밋을 시도해 정말 막히는지 **최소 1회 사람이(또는 다음 실제 사용에서) 확인**한다. Windows 에서 `sh` 가용성(Git Bash)은 README §11 이 "확인됨"이라고 적어 뒀지만, 그 확인이 이 새 로직에도 유효한지 재확인할 가치가 있다.
- **`harnessMetaPaths` 에서 `BACKLOG.md` 제거 결정**: 이 spec 의 판단(제거)이 맞는지 — 특히 논점 J(잔여 작업 목록의 자리)가 나중에 `BACKLOG.md` 라는 같은 이름으로 부활하기로 결정되면, 그 결정과 **함께** 이 항목을 다시 추가해야 한다는 것을 기억해야 한다. 이 spec 은 그 결정을 내리지 않는다.
- **리비전 브랜치 명명 규약(`-<숫자>` 접미사 예약)**: 기능 5 가 도입하는 이 규약이 팀의 기존 브랜치 명명 습관(숫자로 끝나는 비-리비전 브랜치가 실제로 있는지)과 충돌하는지는 사람이 판단한다. 충돌 사례가 나오면 규약을 더 정밀하게(예: 접두어 강제) 다듬어야 할 수 있다.
- **오래된 worktree/브랜치 정리**: 기능 7-5 는 규약을 문서화할 뿐 자동화하지 않는다 — 리비전 체인이 길어졌을 때의 실제 정리는 계속 사람이 `git worktree remove` 로 수행한다.
- **`harness/pipeline-review.md` §3 의 미결 논점(A·E·F·G·H·I·J)**: 이 spec 의 범위 밖이며, 착수 여부·순서는 사람이 별도로 판단한다.

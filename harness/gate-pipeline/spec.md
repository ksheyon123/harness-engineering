# gate-pipeline

## 목적

1층 객관 게이트의 **대상 정의가 `.githooks/pre-push` 와 `.claude/CLAUDE.md` 두 곳에 중복**돼 있어 실제로 드리프트가 발생했다(분리 이전 저장소에서 `apps/web` 의 테스트는 push 게이트에서 한 번도 실행되지 않았다). 동시에 CLAUDE.md 가 규정한 **"게이트 통과해야 커밋"이 어디서도 강제되지 않아**, 게이트 실패가 항상 *커밋이 만들어진 뒤* push 시점에 드러난다.

이 작업은 게이트의 **정의를 한 곳(설정 파일)** 으로, **실행을 한 곳(`scripts/gate.mjs`)** 으로 모으고, `pre-commit` 을 추가해 커밋 조건을 하드 게이트로 만든다. 그 과정에서 이 저장소에 테스트 러너를 도입해, 하네스가 **자기 자신의 객관 게이트를 갖도록** 한다(현재는 검사 대상이 없어 게이트가 항상 무동작으로 통과한다).

## 배경 — 왜 '설정 공유'만으로는 부족한가

설정 파일만 두고 pre-push(sh 에서 JSON 파싱)와 세션(직접 프로세스 스폰)이 각자 읽으면 **같은 설정을 다르게 해석**할 여지가 남는다. 실행 진입점을 하나로 두면 해석이 하나뿐이다. 그래서 이 작업은 `설정 파일` + `단일 실행 스크립트` 두 겹으로 간다.

또한 CLAUDE.md 는 **소프트**(AI 가 무시 가능)이고 훅은 **하드**다. 강제되는 사실을 소프트하게 복사해두면 강제력은 안 늘고 오정보 위험만 는다 — 낡은 목록은 세션에게 *틀린 확신*을 준다. 따라서 CLAUDE.md 는 게이트에 대해 **행동 규칙만** 갖고 **대상 정보는 0개** 갖는다.

## 범위 밖 (명시)

- `scripts/worktree-add.mjs` 의 `dev` 분기·npm 고정 해소(BACKLOG #3). 이 작업은 설정 파일에 `baseBranch` 필드를 **정의만** 하고, worktree-add 가 그것을 읽게 하는 것은 후속이다.
- `index-sync` 훅 존폐 판단(BACKLOG #5).
- `.claude/agents/qa.md` 의 'Phase 1' 서술 제거(BACKLOG #2).
- `verify-branch.mjs` 의 면제 경로에 `scripts/`·`.githooks/` 가 빠져 있는 문제 — 이 저장소에서는 하네스 자기 코드가 '제품 소스'로 취급돼 메인 체크아웃에서 차단된다. **BACKLOG 에 신규 항목으로 추가하고 여기서는 다루지 않는다.**
- `dev` 브랜치 생성. 이 task 는 `main` 에서 직접 진행한다(파이프라인 의식 생략 — 게이트·QA 가 아직 신호를 못 내므로).

---

## 기능 목록

### 기능: 테스트 러너 도입

- **의도**: 이 저장소에는 검사 대상이 없어 1층 객관 게이트가 항상 "건너뜀"으로 통과한다. 게이트를 고치는 작업 자체가 게이트의 보호를 못 받는 상태다. 러너를 넣어야 이후 항목을 test-first 로 진행할 수 있고, 하네스가 자기 파이프라인을 실제로 돌릴 수 있게 된다.
- **방식**: `vitest` 를 루트 devDependency 로 추가한다. 소스가 `.mjs`(TypeScript 아님)이므로 타입 검사 대상은 없고 **테스트만** 있는 구성이다. 테스트는 대상 파일 옆에 `<name>.test.mjs` 로 둔다(vitest 기본 include 가 `.test.mjs` 를 잡는다). 별도 tsconfig·타입 설정은 만들지 않는다.
- **주의**:
  - 이 저장소는 현재 의존성이 0개다. `npm install` 이 처음으로 실제 작업을 하게 되므로, `package.json` 에 `test` 스크립트를 추가하고 `.gitignore` 에 `node_modules` 가 이미 있음을 확인한다.
  - 기존 스크립트(`worktree-add.mjs`, `token-usage.mjs`)는 이미 순수 함수를 export 하고 `import.meta.url` 비교로 main 을 분리해 두었다 — 이 관례를 새 코드에도 유지한다.
- **인수기준**:
  - 저장소 루트에서 `npx vitest run` 이 exit 0 으로 끝나고, 최소 1개 이상의 테스트가 실행된다.
  - `npm test` 가 같은 명령을 실행한다.

### 기능: 게이트 대상 설정 파일

- **의도**: 게이트 대상(어느 디렉터리에서 무슨 명령을 돌리나)의 **단일 출처**를 만든다. 지금은 `pre-push` 의 `TSC_DIRS`/`TEST_DIR` 과 CLAUDE.md 의 '검증 명령' 절에 각각 하드코딩돼 있다.
- **방식**: `harness/config.json` 을 만든다. `harness/` 에 두는 이유가 둘 있다 — (1) QA 서브에이전트는 Bash 가 없어 게이트를 **실행할 수 없고 읽을 수만 있는데**, 이 경로는 QA 의 쓰기/읽기 영역이다. (2) `verify-branch.mjs` 의 면제 경로라 메인 체크아웃에서도 편집이 막히지 않는다.

  ```json
  {
    "baseBranch": "dev",
    "testFilePatterns": ["**/*.test.{ts,tsx,js,mjs}"],
    "gate": {
      "typecheck": [
        { "dir": "apps/web", "cmd": "npx tsc --noEmit" }
      ],
      "test": [
        {
          "dir": "packages/ui",
          "cmd": "npx vitest run --changed {{BASE}} --passWithNoTests",
          "fallbackCmd": "npx vitest run"
        }
      ]
    }
  }
  ```

  - `{{BASE}}` 는 `git merge-base origin/<baseBranch> HEAD` (실패 시 `git merge-base <baseBranch> HEAD`)로 치환한다. 산출 실패 시 `fallbackCmd` 를 쓴다 — 현재 `pre-push` 의 폴백 동작과 동일하다.
  - `baseBranch` 는 이 작업에서 `gate.mjs` 의 merge-base 산출에만 쓴다(worktree-add 적용은 범위 밖).
  - `testFilePatterns` 는 아래 'qa-hash 연동' 기능이 쓴다.
- **주의**:
  - 설정 파일이 **없으면** 게이트 대상이 없는 것으로 보고 **통과**시킨다(현재 `pre-push` 가 없는 디렉터리를 건너뛰는 동작과 같은 결). 하네스를 새로 도입한 저장소에서 push 가 부당하게 막히면 안 된다.
  - 반대로 파일이 **있는데 JSON 파싱에 실패**하면 조용히 넘기지 말고 **명확한 에러로 중단**한다. 설정 오타가 "게이트 없음"으로 조용히 둔갑하면 안 된다.
  - 이 저장소 자신의 설정은 `typecheck: []`, `test: [{ "dir": ".", "cmd": "npx vitest run" }]` 이 된다. 빈 배열이 정상 동작해야 한다.
- **인수기준**:
  - `harness/config.json` 의 게이트 대상을 한 곳만 고치면 `pre-commit`·`pre-push`·세션이 모두 같은 대상을 검사한다.
  - 설정 파일이 없을 때 게이트는 exit 0 으로 통과한다.
  - 설정 파일의 JSON 이 깨져 있을 때 게이트는 0이 아닌 코드로 종료하고, 그 사실을 stderr 에 출력한다.

### 기능: `scripts/gate.mjs` — 단일 실행 진입점

- **의도**: 게이트를 실행하는 코드가 한 곳뿐이어야 설정의 해석도 하나가 된다. `pre-commit`·`pre-push`·개발자 세션이 모두 이 스크립트를 부른다.
- **방식**:
  - 순수 함수를 export 하고, `import.meta.url` 비교로 직접 실행일 때만 `main()` 을 돌린다(기존 스크립트 관례).
    - `loadConfig(text)` — JSON 문자열 → 정규화된 설정. 파싱 실패 시 throw.
    - `resolveCommand(entry, base)` — `{{BASE}}` 치환. `base` 가 없으면 `fallbackCmd`(없으면 `cmd` 원문에서 `{{BASE}}` 를 포함한 항목은 실행 불가로 표시).
    - `planGate(config, { dirExists, base })` — 실행할 `[{ kind, dir, cmd }]` 목록과 건너뛴 항목(`{ dir, reason }`)을 반환. **부수효과 없음** → 이 함수가 테스트의 주 대상이다.
  - `main()` 은 계획을 받아 순서대로 실행한다. 하나라도 실패하면 나머지를 계속 돌리되(전체 실패 목록을 한 번에 보여주기 위해) 최종 exit code 는 1로 한다. 단 타입 검사 전체가 실패하면 테스트는 실행하지 않는다 — 현재 `pre-push` 가 tsc 실패 시 즉시 중단하는 동작을 유지한다.
  - `--list` 플래그: 실행하지 않고 계획만 출력한다(사람·세션이 대상을 확인하는 용도).
- **주의**:
  - Windows 에서 `npx` 는 `npx.cmd` 라 셸 없이 스폰하면 실패한다. `worktree-add.mjs` 가 이미 같은 문제를 겪고 우회 코드를 갖고 있으니 그 방식을 참고한다.
  - 명령 실행 시 `cwd` 를 각 `dir` 로 두되, `dir` 이 저장소 밖을 가리키지 않는지 검사한다(`worktree-add.mjs` 의 `assertOutsideRepo` 와 반대 방향의 검사).
  - 게이트 실패 출력은 **그대로 통과**시킨다(`stdio: inherit`). 세션이 Bash tool result 로 원인을 봐야 고칠 수 있다.
- **인수기준**:
  - `planGate` 는 존재하지 않는 `dir` 을 실행 목록이 아니라 건너뜀 목록에 넣고, 그 이유를 함께 반환한다.
  - `resolveCommand` 는 `base` 가 주어지면 `{{BASE}}` 를 그 값으로 치환하고, 주어지지 않으면 `fallbackCmd` 를 반환한다.
  - 게이트 명령이 하나라도 실패하면 `node scripts/gate.mjs` 의 exit code 가 0이 아니다.
  - 모든 대상이 통과하거나 건너뛰어지면 exit code 가 0이다.
  - `node scripts/gate.mjs --list` 는 아무 명령도 실행하지 않는다.

### 기능: `pre-commit` 훅 — 커밋 조건을 하드 게이트로

- **의도**: CLAUDE.md 는 "게이트 통과해야 커밋"이라고 규정하지만 `.githooks/` 에는 `pre-push` 밖에 없어 **커밋은 무조건 성공**한다. 그래서 게이트 실패가 항상 커밋 뒤에 드러나고, 깨진 커밋이 로컬 히스토리에 남아 `--amend` 나 fix 커밋이 필요해진다(수정이 테스트/spec 파일에 닿으면 QA 해시가 바뀌어 push 시도가 3회까지 늘어난다). 실패를 커밋 **전**으로 옮기면 워킹트리만 dirty 한 상태로 끝난다.
- **방식**: `.githooks/pre-commit` 을 추가한다.
  1. **부분 스테이징 거부** — `git diff --quiet` 로 스테이징 안 된 변경이 있는지 확인하고, 있으면 커밋을 거부한다.
  2. `node scripts/gate.mjs` 실행. 실패하면 exit 1.
  3. 통과하면 `git write-tree` 결과(= 지금 커밋될 내용의 트리 해시)를 `$(git rev-parse --git-dir)/harness-gate-tree` 에 기록한다.
- **주의**:
  - **왜 stash 하지 않는가**: 훅은 워킹트리를 검사하는데 커밋되는 것은 인덱스다. 둘이 다르면 "통과했다고 판정한 트리"와 "실제 커밋되는 트리"가 어긋난다. 일반적 해법은 스테이징 안 된 변경을 stash 했다가 복원하는 것이지만, **stash 실패 시 작업 손실**이라는 비가역 위험이 있다. 하네스는 spec 당 코드+테스트+qa-checklist 를 **한 커밋**에 담는 것이 규약이라 부분 스테이징을 쓸 일이 없으므로, 지원하지 않고 **거부**한다. 비가역 조작 없이 거짓 통과를 막는다.
  - 마커 경로에 `git rev-parse --git-dir` 를 쓰는 이유: 링크드 worktree 는 자기 git-dir(`<공용>/.git/worktrees/<name>`)을 가지므로 **worktree 별로 마커가 분리**된다. `.git/` 안이라 절대 추적되지 않는다.
  - **커밋 해시가 아니라 트리 해시**인 이유: pre-commit 시점에는 커밋이 아직 없어 커밋 해시를 알 수 없다. 그리고 게이트가 검증하는 것은 내용이지 히스토리가 아니라서, 메시지만 고친 amend 처럼 내용이 같은 재작성은 그대로 유효해야 한다.
  - `git commit --amend` 는 pre-commit 이 실행되므로 마커가 갱신된다. `git rebase`·자동 머지는 pre-commit 을 실행하지 않으므로 마커가 낡는다 — 그것이 아래 pre-push 조건부 게이트의 존재 이유다.
  - 훅이 없는 상태(`core.hooksPath` 미설정)에서 클론한 사람에게 이 훅이 자동 적용되려면 `scripts/setup-githooks.mjs` 가 이미 하는 일로 충분하다 — 추가 작업 없음을 확인한다.
- **인수기준**:
  - 게이트가 실패하면 `git commit` 이 실패하고, 커밋 객체가 만들어지지 않는다(`git rev-parse HEAD` 가 이전과 같다).
  - 게이트가 실패해도 워킹트리의 수정 내용은 그대로 남는다.
  - 스테이징 안 된 변경이 있는 상태에서 `git commit` 은 거부된다.
  - 게이트를 통과해 커밋이 만들어지면 `$(git rev-parse --git-dir)/harness-gate-tree` 의 내용이 `git rev-parse HEAD^{tree}` 와 같다.

### 기능: `pre-push` 개편 — `gate.mjs` 호출 + 트리 해시 조건부 스킵

- **의도**: pre-commit 이 생기면 평범한 흐름에서 pre-push 의 게이트는 **같은 트리를 두 번 검사**하는 낭비다. 그러나 `rebase`·자동 머지·`--no-verify` 로 만들어진 트리는 pre-commit 을 거치지 않으므로, 게이트를 없애면 검증되지 않은 내용이 원격으로 나간다. 특히 이 하네스는 **`dev` 재분기/rebase 를 규약으로 요구**하고, rebase 결과는 semantic conflict(각각은 통과하지만 합치면 깨지는 상태)를 만들 수 있다 — pre-commit 이 원리적으로 잡을 수 없는 조합이다.
- **방식**:
  - 게이트 부분을 `node scripts/gate.mjs` 호출로 교체한다(`TSC_DIRS`/`TEST_DIR` 및 인라인 tsc/vitest 호출 제거).
  - 게이트 실행 전에 마커를 비교한다. `$(git rev-parse --git-dir)/harness-gate-tree` 의 내용이 `git rev-parse HEAD^{tree}` 와 **같으면 게이트를 건너뛴다**. 다르거나 마커가 없으면 게이트를 실행한다.
  - QA 관련 로직(spec 조회 → 입력 해시 비교 → headless QA 재생성 → 미커밋 차단)은 **그대로 유지**한다. 이 부분은 구조상 push 시점에만 성립한다 — QA 산출물은 커밋에 포함돼야 하는 파일이라 "커밋됐나?"를 커밋 시점에 물을 수 없다.
- **주의**:
  - 마커가 없을 때(훅 도입 전 커밋, 다른 클론에서 온 커밋)는 **안전 기본값 = 게이트 실행**이다. 스킵이 기본이 되면 안 된다.
  - 게이트를 실행하는 경우, `gate.mjs` 는 워킹트리를 검사하지 HEAD 의 트리를 체크아웃해서 검사하지 않는다. 워킹트리가 dirty 하면 push 되는 내용과 검사 대상이 다를 수 있다 — 이 한계를 훅 주석에 명시한다(스킵 경로에서는 이 문제가 없다. 커밋 시점에 검증된 트리와 HEAD 트리가 같음을 확인한 것이므로).
  - `merge-base` 산출은 이제 `gate.mjs` 안에서 `baseBranch` 설정으로 한다. `pre-push` 에서 `BASE` 를 계산하던 코드는 제거한다.
- **인수기준**:
  - pre-commit 을 통과해 만든 커밋을 바로 push 하면, pre-push 가 게이트를 실행하지 않고 그 사실을 출력한다.
  - `git commit --no-verify` 로 만든 커밋을 push 하면 pre-push 가 게이트를 실행한다.
  - rebase 후 push 하면(트리가 바뀌었으므로) pre-push 가 게이트를 실행한다.
  - 마커 파일이 없는 상태에서 push 하면 pre-push 가 게이트를 실행한다.
  - QA 입력 해시 스킵과 미커밋 산출물 차단 동작은 개편 전과 동일하다.

### 기능: `qa-hash.mjs` 의 테스트 파일 패턴을 설정에서 읽기

- **의도**: `qa-hash.mjs` 는 `/\.test\.tsx?$/` 만 해시 입력으로 잡는다. 이 작업으로 이 저장소에 `.test.mjs` 테스트가 생기면 **테스트를 고쳐도 해시가 바뀌지 않아** QA 가 낡은 매트릭스인 채로 스킵된다. 실패 방향이 조용해서(막히는 게 아니라 통과됨) 발견이 늦다.
- **방식**: `harness/config.json` 의 `testFilePatterns` 를 읽어 매칭한다. 설정이 없으면 현재 기본값(`**/*.test.{ts,tsx}`)을 유지한다. `SKIP` 디렉터리 목록도 설정 가능하게 하되, 기본값은 현재 값을 유지한다.
- **주의**:
  - 이 파일은 `pre-push` 가 셸에서 직접 호출하므로(`node .claude/hooks/qa-hash.mjs "$BRANCH"`) 출력 형식(해시 문자열만 stdout)이 바뀌면 안 된다.
  - 패턴 매칭을 위해 외부 glob 의존성을 추가하지 않는다 — 이 저장소는 vitest 외 의존성을 늘리지 않는 것이 기본이다. 단순 확장자/경로 매칭으로 충분하다.
- **인수기준**:
  - `testFilePatterns` 에 `.test.mjs` 가 포함된 설정에서, `.test.mjs` 파일의 내용을 바꾸면 `node .claude/hooks/qa-hash.mjs <branch>` 의 출력이 달라진다.
  - 설정 파일이 없어도 기존과 동일하게 `.test.ts(x)` 를 잡는다.
  - stdout 에는 해시 문자열만 출력된다(경고·로그가 섞이지 않는다).

### 기능: `CLAUDE.md` 에서 게이트 대상 제거

- **의도**: 강제되는 사실을 소프트 문서에 복사해두면 강제력은 안 늘고 드리프트 위험만 는다. 세션에게 필요한 것은 게이트를 **실행하는 것**이지 게이트의 **내용을 아는 것**이 아니다.
- **방식**: `.claude/CLAUDE.md` 의 '검증 명령' 절에서 대상 목록·형식 예시를 **전부 제거**하고, 다음만 남긴다.
  - 커밋 전에 `node scripts/gate.mjs` 를 실행한다는 **행동 규칙**.
  - 대상 정의는 `harness/config.json` 이며 이 파일에는 적지 않는다는 **경계 선언**.
  - 반복 개발 중 특정 대상만 돌리려면 `node scripts/gate.mjs --list` 로 확인한다는 안내.
  - 테스트 러너가 없는 패키지 정보는 설정 파일의 `test` 항목 부재로 표현되며, QA 는 그 파일을 Read 해서 판단한다는 안내.
- **주의**: '자동 커밋 + push' 절의 *"스코프의 모든 검증 명령(타입 검사 + 해당 패키지 테스트)이 전부 통과할 때만 커밋한다"* 도 같은 이유로 `gate.mjs` 표현으로 바꾼다. 다만 **pre-commit 이 이미 하드로 막으므로 이 규약은 이제 '조기 피드백'용**이라는 점을 함께 적는다 — 규약이 강제 수단인 척하지 않게 한다.
- **인수기준**:
  - `.claude/CLAUDE.md` 에 게이트 대상 디렉터리명이나 tsc/vitest 명령이 등장하지 않는다.
  - 게이트 대상을 바꾸려는 사람이 CLAUDE.md 를 읽으면 `harness/config.json` 으로 안내받는다.

---

## 완료 후 파이프라인

```
개발자 세션: test-first 구현
 ▼
게이트 실행 (node scripts/gate.mjs) ········ 조기 피드백        ○소프트
 ▼
qa-hash → QA 서브에이전트 → qa-checklist.md
 ▼
git commit
   └─[pre-commit] ─────────────────────────────────────────── ★하드
        0. 부분 스테이징 거부
        1. node scripts/gate.mjs
        2. 통과 → git write-tree 를 .git/harness-gate-tree 에 기록
        실패 → 커밋 중단. 워킹트리 보존, 히스토리 무손상
 ▼
git push
   └─[pre-push] ────────────────────────────────────────────  ★하드
        1. HEAD^{tree} == 마커?  같음 → 게이트 스킵
                                다름/없음 → node scripts/gate.mjs
        2. QA 입력 해시 비교 → 재생성 → 미커밋 차단
 ▼
사람: PR 리뷰 → 머지                                          ★유일한 품질 게이트
```

| 상황 | pre-commit | pre-push 게이트 | pre-push QA |
|---|:--:|:--:|:--:|
| 하네스 정상 흐름 | 실행 | 스킵 | 실행 |
| rebase / 자동 머지 후 push | — | 실행 | 실행 |
| `--no-verify` 우회 | 건너뜀 | 실행 | 실행 |
| 다른 클론에서 온 커밋 | — | 실행 | 실행 |

## 사람 확인 필요

- 이 작업으로 저장소에 첫 의존성(`vitest`)과 `node_modules` 가 생긴다. 지금까지 "외부 의존성 0개"였던 성질이 바뀌므로 README 의 해당 서술을 함께 고쳐야 한다.
- `.githooks/pre-commit` 은 이 저장소에서 작업하는 **모든 커밋**에 걸린다. 사람이 WIP 커밋을 자주 하는 습관이면 마찰이 생길 수 있다. 등록된 task 브랜치에서만 발동시키는 선택지(현재 `pre-push` 가 `harness/index.json` 을 조회하는 방식과 동일)가 있으나, **기본은 전체 적용**으로 두고 마찰이 실제로 발생하면 후속으로 좁힌다.

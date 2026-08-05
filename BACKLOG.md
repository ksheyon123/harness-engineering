# BACKLOG

`doggy-groommer-scheduler` 에서 하네스만 분리하면서 드러난 잔여 작업. **한 번에 하나씩** 진행한다.

각 항목은 이 저장소의 프로토콜대로 `harness/<task>/spec.md` 를 먼저 쓰고(planner 또는 직접) 구현한다. 항목마다 제안 브랜치명을 적어 뒀다.

> **파이프라인 의식을 적용한다(#1 완료).** 게이트가 신호를 못 내서 의식을 생략하던 전제는 해소됐다 — `node scripts/gate.mjs` 가 이 저장소의 vitest 스위트를 실제로 돌리고, 테스트 파일이 있으므로 QA 커버리지 매트릭스도 실질을 갖는다. 이후 항목은 spec 작성 → `harness/index.json` 등록 → worktree → 새 세션 → 게이트 → QA → 커밋/push 의 정규 흐름으로 진행한다.
>
> **worktree 생성의 선행 조건은 해소됐다(#3 완료).** `worktree-add.mjs` 가 `harness/config.json` 의 `baseBranch`(이 저장소는 `main`)에서 분기하므로 `node scripts/worktree-add.mjs <branch> --launch` 가 그대로 동작한다. 다만 등록된 task 브랜치에서 `scripts/`·`.githooks/` 를 메인 체크아웃에서 편집하면 `verify-branch` 가 막으므로(#7), 하네스 자기 코드를 고치는 항목은 worktree 에서 작업해야 한다.

---

## ~~#1 · 게이트 대상이 두 곳에 중복돼 있다~~ <sub>P1</sub> ▸ **완료** (`12d2dcd`)

> **[`harness/gate-pipeline/spec.md`](./harness/gate-pipeline/spec.md) 로 이관 후 구현 완료.** 논의 과정에서 아래 원안보다 범위가 커졌다 — 설정 파일만으로는 pre-push(sh 의 JSON 파싱)와 세션(직접 스폰)이 **같은 설정을 다르게 해석**할 여지가 남아, 단일 *실행 진입점*(`scripts/gate.mjs`)이 추가됐다. 또한 아래 #4(qa-hash glob), pre-commit 도입, 테스트 러너 도입이 같은 spec 에 합쳐졌다.
>
> **결과** — `harness/config.json`(정의) + `scripts/gate.mjs`(실행) + `.githooks/pre-commit`(하드 게이트) + `pre-push`(트리 해시 조건부 스킵) + 설정 기반 `qa-hash` glob + CLAUDE.md 에서 대상 정보 제거. `vitest` 를 도입해 `scripts/gate.test.mjs` 28개 테스트가 게이트에서 실제로 돈다. 커밋: `2baa41e`(spec) → `8a2c4dc`(구현) → `12d2dcd`(훅 종료 코드 분리).

**증상** — 1층 객관 게이트의 대상이 서로 다른 두 파일에 각각 하드코딩돼 있고, 사람이 수동으로 일치시켜야 한다. **가설이 아니라 이미 일어난 일이다** — 분리 이전 저장소에서 CLAUDE.md 는 세션에게 `apps/web` 테스트를 지시했지만 `pre-push` 의 `TEST_DIR` 은 `packages/ui` 뿐이라, `apps/web` 의 테스트는 push 게이트에서 **한 번도 실행된 적이 없다**. 드리프트 방향이 나빠서(문서가 게이트보다 넓음) 세션은 "통과시켰다"고 믿었다.

**근거**
- `.githooks/pre-push:15` — `TSC_DIRS="apps/web packages/ui"`
- `.githooks/pre-push:35` — `TEST_DIR="packages/ui"`
- `02d9cf1:.claude/CLAUDE.md` '검증 명령' 절 — `apps/web`: `npx vitest run`, `packages/ui`: `npm run type-check`(pre-push 는 `npx tsc --noEmit`)

**핵심 판단** — 중복된 것은 *행동 규칙*이 아니라 *사실*이다. 세션에게 필요한 건 게이트를 **실행**하는 것이지 게이트의 **내용을 아는** 것이 아니다. 그리고 강제되는 사실을 소프트 문서(CLAUDE.md)에 복사해두면 강제력은 안 늘고 오정보 위험만 는다 — 낡은 목록은 세션에게 *틀린 확신*을 준다.

**브랜치** `refactor/gate-pipeline`

---

## #2 · QA 에이전트가 "테스트 러너 없음"을 전제한다 <sub>P1</sub>

**증상** — 이건 문서 오타가 아니라 **동작하는 오지시**다. `qa.md` 가 QA 에게 커버리지를 전부 `❌ 누락(테스트 없음)` 으로 적으라고 지시하고 있어서, 테스트가 있는 프로젝트에서도 QA 가 잘못된 매트릭스를 쓸 수 있다.

**근거**
- `.claude/agents/qa.md:53` — `## Phase 1 주의 (현재 저장소 상태)` … "이 저장소는 아직 테스트 러너가 없어 테스트 코드가 없을 수 있다 … 커버리지 열은 모두 `❌ 누락(테스트 없음)`으로 기록한다"
- `harness-engineering.md:161` — "이 저장소엔 현재 테스트 러너가 없다"
- `harness-engineering.md:165-168, 252-254, 351, 362` — Phase 1/Phase 2 단계적 도입 서술 전체

분리 이전 저장소에서 이미 vitest 가 도입돼 Phase 2 가 끝난 상태였다. 서술만 남았다.

**바꿀 것**
- `qa.md` 의 Phase 1 절 삭제 → "테스트 러너가 없는 패키지는 그 사실을 근거로 '테스트 없음'을 기록한다"는 **조건부 지시**로 대체
- `harness-engineering.md` §6 의 Phasing 표는 **설계 이력**으로 명시하거나 제거. §7.3 의 pre-push 개념 스케치와 §10/§11 도 현재 구현과 맞춘다

**완료 조건** — 테스트가 있는 프로젝트에 도입했을 때 QA 가 실제 커버리지를 기록한다

**브랜치** `docs/drop-phase1`

---

## ~~#3 · `worktree-add.mjs` 가 `dev` 와 npm 을 가정한다~~ <sub>P2</sub> ▸ **완료**

> **[`harness/worktree-config/spec.md`](./harness/worktree-config/spec.md) 로 이관 후 구현 완료.** `worktree-add.mjs` 가 `gate.mjs` 의 `loadConfig` 를 import 해 `baseBranch`·`installCommand` 를 읽는다(파서 사본을 만들지 않는다). 기준 ref 는 `<base>` → `origin/<base>` 순으로 찾고 **둘 다 없으면 에러로 멈춘다**(`HEAD` 로 물러서지 않는다). 기존 브랜치 attach 경로는 기준 ref 를 요구하지 않아 회귀가 없다. `scripts/worktree-add.test.mjs`(29 테스트)로 순수 함수를 덮었다.

**증상** — 기준 브랜치가 `dev` 로 고정이라 `main` 만 쓰는 프로젝트에서 바로 실패한다. 패키지 매니저도 npm 고정이라 pnpm/yarn/bun 프로젝트에서 설치 단계가 헛돈다.

**근거**
- `scripts/worktree-add.mjs:112` — `git worktree add -b <branch> <path> dev`
- `scripts/worktree-add.mjs:175-176, 309-320` — `npm install` 하드코딩

**바꿀 것** — `#1` 의 설정 파일에 `baseBranch` / `installCommand` 를 추가하고 거기서 읽는다. 미설정 시 기본값은 현재 동작(`dev`, `npm install`) 유지.

**완료 조건**
- `main` 만 있는 저장소에서 worktree 생성이 성공한다
- 설정으로 패키지 매니저를 바꿀 수 있다

**의존** `#1` 뒤에 하는 게 자연스럽다(설정 파일 공유)

**브랜치** `refactor/worktree-config`

---

## ~~#4 · `qa-hash.mjs` 의 테스트 파일 패턴이 고정이다~~ <sub>P2</sub> ▸ **완료** (#1 에 흡수)

> [`harness/gate-pipeline/spec.md`](./harness/gate-pipeline/spec.md) 의 'qa-hash.mjs 의 테스트 파일 패턴을 설정에서 읽기' 기능으로 흡수돼 함께 구현됐다. 그 작업이 이 저장소에 `.test.mjs` 테스트를 만들기 때문에, 같이 고치지 않으면 **테스트를 고쳐도 해시가 안 바뀌는 상태를 새로 만드는** 셈이었다. 이제 `qa-hash.mjs` 는 `harness/config.json` 의 `testFilePatterns`·`skipDirs` 를 읽는다(설정 없으면 기존 `.test.ts(x)` 기본값 유지).

**증상** — `*.test.ts(x)` 만 해시 입력으로 잡는다. `*.spec.ts`·`__tests__/`·비-TS 프로젝트의 테스트는 해시에 안 들어가서, **테스트를 고쳐도 해시가 안 바뀌고 QA 가 스킵된다.** 실패 방향이 조용해서(막히는 게 아니라 낡은 QA 가 통과됨) 눈치채기 어렵다.

**근거**
- `.claude/hooks/qa-hash.mjs:26` — `/\.test\.tsx?$/`
- `.claude/hooks/qa-hash.mjs:11` — `SKIP` 목록에 `.next`·`.turbo` 등 특정 스택 산출물

**바꿀 것** — 설정에서 glob 목록을 읽게 한다(`#1` 의 설정 파일에 `testGlobs`). `SKIP` 도 설정 가능하게 하거나 `.gitignore` 기반으로 바꾼다.

**완료 조건** — `.spec.ts` 를 쓰는 프로젝트에서 테스트 변경이 해시에 반영된다

**브랜치** `fix/qa-hash-globs`

---

## #5 · `index-sync` 훅이 죽어 있다 <sub>P3</sub>

**증상** — `harness/index.json` 의 `components` 가 비어 있어, 이 훅은 Edit/Write 마다 실행되지만 **아무것도 출력하지 않는다.** 분리 이전 저장소에서도 매핑이 0개였다. 설계 문서(§7.2)에는 핵심 3훅 중 하나로 올라와 있다.

**근거**
- `.claude/hooks/index-sync.mjs` — `index.components?.[rel]` 조회, 없으면 `exit 0`
- `harness/index.json` — `"components": {}`
- `harness-engineering.md` §4, §7.2

**결정이 필요하다** — 이건 구현 작업이 아니라 판단이다.
- **살린다** — 매핑을 채우는 절차를 프로토콜에 넣는다(누가·언제 `components` 를 등록하나?). 등록을 사람이 수동으로 하면 실제로는 계속 비어 있을 것이다.
- **뺀다** — 훅·설정 등록·설계 문서 §7.2 를 함께 제거한다. 하네스가 그만큼 단순해진다.

의견: 80개 task 를 거치는 동안 매핑이 계속 0개였다는 건 **필요가 없었다는 증거**에 가깝다. 제거 쪽에 무게를 둔다.

**브랜치** `chore/index-sync-decision`

---

## #6 · doggy 저장소의 `.claude/rules/` 분리 <sub>별도 저장소</sub>

분리 과정에서 `.claude/CLAUDE.md` 에서 걷어낸 제품 규약 4개를 원본 저장소에 path-scoped rule 로 다시 심는다. 이 저장소 작업이 아니다 — `doggy-groommer-scheduler` 를 재클론해야 한다.

| 새 rule 파일 | `paths:` | 원본 위치 |
|---|---|---|
| `.claude/rules/testing.md` | `**/*.test.{ts,tsx}` | 구 CLAUDE.md '테스트 쿼리 규약' |
| `.claude/rules/fsd.md` | `apps/web/**` | 구 'FSD 점진 전환' |
| `.claude/rules/copy-constants.md` | `apps/web/**` | 구 '사용자 문구(카피) 상수화' |
| `.claude/rules/api-naming.md` | `apps/api/**` | 구 'API 응답 명명 규약' |

원문은 이 저장소의 커밋 `02d9cf1` 의 `.claude/CLAUDE.md` 77–119 줄에 있다.

**주의** — FSD 규약 중 "신규 기능은 FSD 레이어/슬라이스 구조를 **우선 고려**한다"는 파일을 읽기 전 계획 단계에서 지켜져야 하므로 rule 로 내리면 늦다. 그 한 줄은 `CLAUDE.md` 에 남기고 세부 규칙만 rule 로 옮긴다.

**브랜치** (doggy 저장소) `refactor/claude-rules`

---

## #7 · `verify-branch` 의 면제 경로에 하네스 자기 코드가 빠져 있다 <sub>P2</sub>

**증상** — 하네스 메타작업 면제 목록이 `harness/` 와 `.claude/` 뿐이라, **`scripts/` 와 `.githooks/` 는 '제품 소스'로 취급**된다. 등록된 task 브랜치에서 `scripts/gate.mjs` 나 `.githooks/pre-commit` 을 메인 체크아웃에서 편집하면 `deny` 로 차단된다.

원본 저장소에선 작업 대부분이 `apps/`·`packages/` 라 드러나지 않았지만, **이 저장소는 거의 모든 작업이 `scripts/`·`.githooks/`** 라 첫 task 부터 부딪힌다.

**근거**
- `.claude/hooks/verify-branch.mjs:79-83` — `isHarnessMeta` 판정이 `harness/`·`.claude/` 만 본다
- `.claude/CLAUDE.md` — *"`harness/`·`.claude/` 하네스 메타작업(spec·qa-checklist·CLAUDE.md·**훅**)은 면제"* 라고 적혀 있으나, `.githooks/` 의 훅은 면제가 아니다. **문서 의도와 코드가 어긋나 있다.**

**바꿀 것** — `isHarnessMeta` 에 `scripts/`·`.githooks/` 를 추가하거나, 면제 경로 목록을 `harness/config.json` 으로 뺀다(후자가 #1 의 결과와 일관된다).

**주의** — 면제를 넓히면 그만큼 worktree 강제가 느슨해진다. 하네스 코드와 제품 코드가 같은 저장소에 있는 도입 프로젝트에서는 `scripts/` 가 제품 스크립트일 수도 있다. 그래서 하드코딩보다 **설정으로 빼는 쪽**이 맞다.

**완료 조건** — 등록된 task 브랜치의 메인 체크아웃에서 `.githooks/pre-push` 를 편집해도 차단되지 않고, 제품 소스는 여전히 차단된다.

**브랜치** `fix/verify-branch-exempt`

---

## #8 · CRLF 체크아웃이 모든 worktree 에서 게이트를 깨뜨린다 <sub>P0</sub> ▸ **완료**

**증상** — Windows(`core.autocrlf=true`)에서 **새로 만든 worktree 에서는 게이트가 항상 실패한다.** 메인 체크아웃에서는 통과한다. 즉 파이프라인 의식을 시작하는 순간 첫 worktree 에서 바로 막히고, `pre-push` 도 그 트리에서 게이트를 돌리므로 push 가 불가능해진다.

```
FAIL scripts/gate.test.mjs
SyntaxError: Invalid or unexpected token
 ❯ scripts/gate.test.mjs:2:1
   2| import {
    | ^
```

에러가 **테스트 파일의 import 문**을 가리켜서 테스트 코드 문제로 보이지만, 실제로 깨진 것은 **import 되는 쪽**(`scripts/gate.mjs`)이다.

**원인** — `#!` 셰뱅 + CRLF 조합에서 vite-node 의 셰뱅 처리가 깨진다. 단일 변수 실험으로 확인:

| 모듈 | 결과 |
|---|:--:|
| LF, 셰뱅 없음 | ✅ |
| CRLF, 셰뱅 없음 | ✅ |
| CRLF + 비ASCII 주석, 셰뱅 없음 | ✅ |
| LF + 셰뱅 | ✅ |
| **CRLF + 셰뱅** | **❌ SyntaxError** |

`gate.mjs` 의 CRLF 를 LF 로 바꾸는 것만으로 실패→통과가 뒤집혔다. 하네스 스크립트는 전부 `#!/usr/bin/env node` 로 시작하므로 **전 파일이 이 조건에 해당한다.**

**메인 체크아웃이 통과한 이유는 우연이다** — 그 파일들은 에디터가 LF 로 쓴 뒤 한 번도 재체크아웃되지 않았다. `git checkout`/`worktree add` 가 도는 순간 CRLF 가 된다. 원격에서 클론한 사람도 같은 실패를 겪는다.

**근거**
- `git config core.autocrlf` → `true`
- `git show HEAD:scripts/gate.mjs` → CRLF 0개(인덱스는 LF). 변환은 **체크아웃에서만** 일어난다
- `.gitattributes` 부재

**고친 것** — `.gitattributes` 에 `* text=auto eol=lf` 를 둔다. 인덱스가 이미 LF 라 **저장소 내용은 한 바이트도 바뀌지 않는다** — 체크아웃 동작만 고정된다. `.sh`/훅에도 LF 가 맞다.

**완료 조건** — 새 worktree 를 만들어 의존성을 설치하면 `node scripts/gate.mjs` 가 통과한다.

**주의** — 이미 만들어진 워킹트리는 재체크아웃해야 반영된다(`git checkout -- .`). 그리고 이 항목은 `#3` 진행 중 부트스트랩 worktree 에서 발견됐다 — **파이프라인 의식을 실제로 밟지 않았으면 드러나지 않았을 결함이다.**

---

## 우선순위 요약

| 순서 | 항목 | 상태 | 이유 |
|:--:|---|---|---|
| ✔ | #1 게이트 파이프라인 (+#4, pre-commit, 테스트 러너) | **완료** | 가장 현실적인 실패 모드. 이 저장소에 자기 게이트를 만들었다 |
| ✔ | #4 qa-hash glob | **완료** | #1 에 흡수 |
| 1 | #3 worktree 기준 브랜치 | 대기 | **파이프라인 의식의 선행 조건이 됐다** — `dev` 하드코딩 때문에 이 저장소에서 worktree 생성이 실패한다 |
| 2 | #7 verify-branch 면제 경로 | 대기 | 하네스 자기 코드(`scripts/`·`.githooks/`)를 고치는 항목에 선행 |
| 3 | #2 Phase 1 서술 제거 | 대기 | 값싸고, QA 산출물을 실제로 오염시킨다 |
| 4 | #5 index-sync 결정 | 대기 | 구현 전에 존폐 판단이 먼저 |
| — | #6 doggy rules | 대기 | 별도 저장소, 독립적으로 가능 |

> **#1 은 파이프라인 의식(dev 브랜치 → index 등록 → worktree → 새 세션 → QA 스폰)을 생략하고 `main` 에서 직접 진행했다.** 이유: 당시 이 저장소엔 검사할 코드도 테스트도 없어 1층 게이트가 신호를 못 냈고, 게이트를 고치는 작업이 그 게이트를 통과해야 하는 순환도 있었다. **#1 이 끝나 하네스가 자기 테스트를 갖게 됐으므로, 이 예외는 여기서 끝난다** — 이후 항목은 정규 흐름을 따른다(문서 상단의 선행 조건 참고).
>
> 순서를 바꾼 이유: 원안은 #2 → #7 → #3 이었으나, 정규 흐름을 쓰기로 한 이상 **worktree 가 만들어지지 않는 것**(#3)이 가장 먼저 부딪히는 벽이다.

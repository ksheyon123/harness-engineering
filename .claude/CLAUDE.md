# CLAUDE.md

강아지 미용 예약 관리(Doggy Scheduler). Turborepo — `apps/web`(Next.js), `apps/api`(Express), `packages/ui`. 하네스 설계는 `harness-engineering.md` 참고.

## 하네스 개발자 프로토콜 (메인 세션 = 개발자 역할)

이 저장소는 문서 주도 + 역할 기반 하네스(기획자 / 개발자 / QA)로 작업한다.
planner·qa는 `.claude/agents/*.md`에 정의돼 있고, **개발자는 별도 에이전트 없이 이 메인 세션**이다.
그래서 개발자의 행동 규약은 여기에 둔다.

UserPromptSubmit 로더가 현재 브랜치의 기능 목록(spec)을 컨텍스트에 주입하면, 너는 개발자로서 **자율적으로** 수행한다:

- spec의 **모든 기능**을 **test-first**로 구현한다: 실패 테스트(RED) → 구현 → 통과(GREEN).
- **이것은 자동화다. 기능 사이에서도, 한 기능을 구현하는 도중에도 "계속할까요? / 이대로 할까요?"라고 사용자에게 묻지 않는다.** spec 전체를 끝까지 진행한다. 인수기준에 영향 없는 일상적 구현 선택(테스트 mock 전략, 네이밍, 파일 배치, 보조 유틸 작성 등)은 **합리적 기본값을 택해 진행하고**, 그 선택을 사후 보고에 한 줄로 남긴다.
- 자기 코드의 테스트는 개발자가 작성한다. 테스트 러너가 있는 패키지에서 작성한다(`packages/ui` = vitest).
- 동작 변경은 각 기능의 **인수기준 범위 안에서만** 한다.
- **문서 먼저(doc-before-code)**: 새 기능뿐 아니라 **리비전·후속 수정·하네스 자체 수정도** 코드보다 spec/문서를 먼저 확정한다(planner 또는 직접). (이미 있는 문서 문구를 다듬는 순수 편집은 예외.)
- **워크플로/하네스 문제 지적 = 하네스를 고친다**: 사용자가 *일이 어떻게 진행되는가*(브랜치·worktree·세션·프로토콜·게이트)의 문제를 지적하며 구체 기능을 예로 들면, 그 **예시 기능을 구현하라는 게 아니라** 하네스(`.claude/CLAUDE.md`·`.claude/hooks/*`·`scripts/*`)를 고치라는 뜻이다. 거명된 기능은 증상 예시로 본다.
- spec 전체 구현이 끝나면 다음을 순서대로 **자동** 수행한다: **① 객관 게이트(`tsc` + 테스트) → ② 통과 시 QA 체크리스트 생성 → ③ 자동 커밋 → ④ 작업 브랜치로 자동 push**(아래 각 절 참고). 그 뒤 변경 요약 + 게이트 결과 + QA 결과 + 커밋 해시 + push 결과를 한 번에 보고한다. **체크박스 확정·PR 리뷰·머지는 사람의 몫이다.**

### QA 체크리스트 생성 (게이트 통과 후 · 커밋 전)
- 객관 게이트가 통과하면, **커밋 전에** QA 서브에이전트를 호출해 `harness/<task>/qa-checklist.md`를 생성/갱신한다.
- **호출**: `Agent` 도구로 `subagent_type: "qa"`를 스폰한다. 역할·산출물 형식은 `.claude/agents/qa.md`에 정의돼 있다(새 컨텍스트라 독립 도출이 유지된다).
- **input_hash 주입**: qa 서브에이전트는 Bash가 없어 해시를 못 구한다. **모든 테스트 파일을 다 쓴 뒤** 개발자가 `node .claude/hooks/qa-hash.mjs <현재-브랜치>`로 (반드시 **저장소 루트에서 실행** — cwd 의존이라 하위 디렉터리서 돌리면 해시 불일치로 push가 한 번 막힌다) 해시를 계산해, 스폰 프롬프트에 "frontmatter의 `input_hash`를 정확히 `<해시>`로 기록하라"고 전달한다. 이 값이 맞아야 push 시 pre-push가 QA를 스킵한다.
- 해시를 계산한 뒤에는 테스트/spec 파일을 더 바꾸지 않는다(바꾸면 해시 불일치 → pre-push가 QA를 재생성하며 push가 한 번 막힌다).
- QA는 **비차단(조언)**이다. 커버리지 갭(`❌`/`△`)이 있어도 커밋·push를 막지 않는다 — 완성도 판단·추가 개발 요청은 사람이 PR에서 한다.

### 자동 커밋 + push (게이트 통과 시)
- **커밋 조건**: 스코프의 모든 검증 명령(`tsc` + 해당 패키지 테스트)이 **전부 통과**할 때만 커밋한다. 하나라도 실패하면 커밋하지 않고 멈춰 보고한다.
- **커밋 단위**: spec 1개당 1커밋(끝에서 한 번) — **코드 + 테스트 + `qa-checklist.md`를 한 커밋에 담는다**. 여러 spec을 한 세션에서 진행하면 spec마다 커밋한다.
- **브랜치 안전**: `main`/`dev`에는 **직접 커밋하지 않는다**. 현재 브랜치가 `main`/`dev`면 멈추고 사용자에게 작업 브랜치 생성을 요청한다(`harness/index.json`에 매핑된 작업 브랜치에서만 커밋).
- **분기 기준**: 작업 브랜치는 **`dev`에서 분기한다**(`main` 아님), 항상 최신 `dev` 기준. **task 시작은 worktree 우선**: 메인 체크아웃에서 `git checkout -b` 하지 말고 `node scripts/worktree-add.mjs feat/<task> --launch` 로 worktree를 만들어 **그 디렉터리에서 새 세션을 연다**(`--launch` 가 install + 새 터미널 창에서 세션 자동 기동(macOS=Terminal.app, Windows=PowerShell), 실패/미지원 시 기동 명령 출력으로 폴백 — 아래 'worktree 동시작업 규약'). 새 세션은 `load-spec` 로더가 브랜치 기준으로 spec 을 자동 주입하므로 그 세션이 개발자로서 자율 구현한다. spec이 등록된 task의 제품 소스(`apps/`·`packages/`)를 메인 체크아웃에서 편집하면 `verify-branch` 훅이 **`deny`로 차단**한다 — 메인에서는 진행 불가, **반드시 worktree에서** 한다(단일 작업이어도 예외 없음). 등록 전 ad-hoc 수정·`harness/`·`.claude/` 메타작업은 메인에서 가능.
- **자동 push**: 커밋 후 **현재 작업 브랜치로 push 한다**(`git push -u origin <현재-브랜치>`). push 도중 pre-push 훅이 객관 게이트(tsc+vitest)를 재실행하고, 위에서 주입한 `input_hash`가 일치하면 QA를 스킵한다.
  - **push도 `main`/`dev`엔 절대 하지 않는다** — `harness/index.json`에 매핑된 작업 브랜치로만.
  - pre-push가 push를 거부하면(객관 게이트 실패, 또는 해시 불일치로 재생성된 QA 산출물이 미커밋) 멈추고 그 출력을 그대로 보고한다. 후자면 그 산출물을 커밋하고 다시 push 한다.
  - **force-push는 하지 않는다**(비가역 → 사람에게 위임).
- **메시지 규약**: `type(scope): 한 줄 요약` + 본문(무엇·왜) + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 트레일러. 기존 커밋 컨벤션(`fix(ui):`, `refactor(web):` 등)을 따른다.
- **따옴표 규약**: 커밋 메시지 안에서 인용/강조로 따옴표를 쓸 때는 큰따옴표(`""`)가 아니라 **작은따옴표(`''`)** 를 쓴다(예: `'NewFab' 로 변경`). 셸에서 `-m "..."` 로 감쌀 때 메시지 내부의 큰따옴표가 이스케이프/인용을 깨뜨리는 것을 피한다.
- **멀티라인 메시지**: PowerShell here-string은 `;`로 한 줄에 이으면 깨진다. 메시지를 임시 파일에 쓰고 `git commit -F <file>` 후 파일을 지운다.

### 멈추는 경우(예외)만 사용자에게 묻는다 — 이때는 커밋도 하지 않는다
- spec의 "사람 확인 필요" 항목, 또는 명백히 범위 밖 작업.
- 파괴적·비가역 행위(파일 삭제, force-push, 작업 브랜치 외 push 등) → 사람에게 위임. (작업 브랜치로의 일반 `git push`는 위 "자동 push"로 인가된다.)
- 인수기준이 모호/충돌해 결정 불가.
- 객관 게이트(`tsc`/테스트)가 자력으로 해결 못 하는 외부 원인으로 실패.
- 현재 브랜치가 `main`/`dev`라 안전하게 커밋할 수 없음.

**이 목록이 멈춤의 전부다(닫힌 집합).** 여기에 해당하지 않는 모든 결정은 합리적 기본값으로 진행하고 묻지 않는다.

## worktree 동시작업 규약

여러 작업을 동시에 진행할 때는 `git worktree`로 브랜치별 워킹트리를 분리한다. 사람이 worktree마다 별도 Claude Code 세션(= 각각 독립된 개발자 메인 세션)을 띄워 병렬로 작업한다. (오케스트레이터가 dev 에이전트를 조율하는 모델은 별도 설계 문서로 분리한다.)

- **세션 단위**: worktree 1개 = 개발자 세션 1개. 두 작업을 동시에 = 메인 세션 2개가 각자의 worktree에서 독립 실행된다(세션 간 컨텍스트는 공유되지 않는다).
- **생성 위치**: worktree는 **저장소 트리 밖 형제 디렉터리**(`../<repo>-<task>`)에 만든다. **저장소 내부(예: `.claude/worktrees/`)에는 두지 않는다** — tsc/vitest/turbo 글로빙과 `.gitignore`가 그 트리를 untracked/중첩 repo로 오인한다.
- **생성 방법**: `node scripts/worktree-add.mjs <branch>` 를 쓴다(형제 경로 산출 + `dev`에서 분기). 플래그:
  - `--install` : 그 worktree에서 npm install까지 한다.
  - `--launch` : `--install` 을 포함하고, 생성·설치 후 **그 worktree에서 개발 세션을 새 터미널 창에서 자동 실행**한다(macOS=Terminal.app/osascript, Windows=새 PowerShell 창/cmd start + `-EncodedCommand`). seed 는 브랜치에서 도출하며(또는 `--seed "<문구>"`로 지정), 새 세션은 `load-spec` 가 spec 을 자동 주입한다. 미지원 플랫폼/실패 시 기동 명령(`cd '<path>' && claude '<seed>'`) 출력으로 폴백한다. 미등록 브랜치/누락 spec 이면 경고만 한다(차단 안 함).
  - 수동이면 `git worktree add -b <branch> ../<repo>-<task> dev`.
- **분기 기준**: worktree는 항상 **최신 `dev`에서 분기**한다. 오래된 커밋에서 자르면 그 시점의 (stale) 훅/설정을 쓰게 됨을 유의한다. `core.hooksPath`는 공유 config라 worktree에 자동 적용된다.
- **node_modules**: 새 worktree에는 `node_modules`가 따라오지 않는다. 각 worktree에서 `npm install`이 필요하다(`pre-push`가 그 트리에서 tsc/vitest를 돌리므로 install이 없으면 게이트가 실패한다). dev 서버를 동시에 띄우면 포트(Next.js 3000)가 겹치므로 한쪽은 다른 포트를 쓴다.
- **push**: 각 worktree 세션은 **자기 작업 브랜치만** push한다(브랜치가 다르므로 서로 충돌하지 않는다). 위 "자동 커밋 + push" 규약을 그대로 따른다.
- **메인 체크아웃 금지(제품 소스, 하드)**: spec이 등록된 task 브랜치의 `apps/`·`packages/` 코드 작업은 **worktree에서만** 한다. 메인 체크아웃에서 그 코드를 편집하면 `verify-branch` 훅이 **`deny`로 차단**한다 — 단일 작업이어도 예외 없이 worktree를 쓴다. `harness/`·`.claude/` 하네스 메타작업(spec·qa-checklist·CLAUDE.md·훅)은 면제다 — 이들은 메인에서 그대로 수정한다.
- **정리**: 작업이 끝나면 `git worktree remove <path>` 로 제거한다(미커밋 잔여가 있으면 브랜치 삭제가 막힌다). 디렉터리 삭제는 비가역이므로 자동화하지 않고 사람이 수행한다.

### harness/index.json 동시 편집 규약
`harness/index.json`은 모든 작업이 공유하는 단일 파일을 브랜치별로 편집하므로, worktree 병렬 작업 시 머지 충돌이 쉽게 난다. 이를 막기 위해:

- index.json 편집(새 task 등록 등)은 **한 시점에 한 세션만** 수행한다.
- 편집은 **최신 `dev` 기준**으로 하고, 등록 후 **즉시 머지/rebase**해 다른 worktree와 벌어지지 않게 한다.
- 코드 작업 세션(또는 dev 에이전트)은 index.json을 건드리지 않는 것을 기본으로 한다 — 코드/테스트/qa-checklist만 수정한다.

## 셸 작업 규약
- **모든 작업 요청은 프로젝트 루트(working directory)에서 시작한다.** 셸 명령에서 `cd`로 디렉터리를 이동할 필요가 없다. 상대/절대 경로를 그대로 쓰고, 불필요한 `cd ... &&` 체이닝을 하지 않는다(특히 `cd`와 출력 리다이렉션을 한 컴파운드 명령에 섞으면 샌드박스가 path-resolution 우회로 보고 수동 승인을 요구한다).
- 파일 검색/읽기/편집은 `find`/`cat`/`grep` 대신 전용 도구(Glob/Read/Grep/Edit)를 쓴다.

## 검증 명령
- `packages/ui`: `npm run type-check`, `npx vitest run`
- `apps/web`: `npx tsc --noEmit`, `npx vitest run` (vitest/jsdom)
- 두 패키지 모두 vitest 러너가 있으므로, 자기 코드 테스트는 해당 패키지에서 test-first 로 작성한다(과거 `apps/web` 러너 부재로 두었던 'Phase 2 보류' 예외는 해소됨).

## 테스트 쿼리 규약 (locator vs assertion)

리팩터링으로 문구(카피)만 바뀌어도 테스트가 억울하게 깨지는 것을 막기 위해, **요소를 '찾는' 것(locator)** 과 **화면 내용을 '검증'하는 것(assertion)** 을 구분한다.

- **인터랙티브 요소(버튼·입력)를 클릭/입력하려고 '찾을' 때는 카피 텍스트로 찾지 않는다.**
  - accessible name 이 안정적이면 `getByRole('button', { name })` 우선.
  - 라벨 카피가 자주 바뀌는 요소는 `data-testid` 를 안정 훅으로 부여(`getByTestId`). testid 는 컴포넌트 API 로 노출한다(`${testId}-input` 식 — 기존 `Checkbox`/`DogDetailModal` 관례).
  - `querySelector`/클래스 셀렉터는 최후의 수단.
- **화면에 보이는 내용을 '검증'할 때는 텍스트로 확인한다.** 진짜 문구가 바뀌어 이 검증이 깨지는 것은 정상(그게 검증의 목적). 단 검증 문자열을 하드코딩하지 말고 카피 상수를 import 해 컴포넌트와 단일 출처를 공유한다(아래 '사용자 문구(카피) 상수화').
- **locator 는 DRY**: 같은 요소를 반복해 찾으면 파일 상단/헬퍼에 한 번 정의해 재사용한다(훅 이름 변경 시 blast radius 1줄).
- 이 규약은 **가이드라인(비강제)** 이다. testid 전면 강제는 하지 않는다 — 접근성 쿼리(role/label/text)를 우선하고 testid 는 볼라틸한 인터랙티브 요소에만 쓴다.

## FSD(Feature-Sliced Design) 점진 전환

이 저장소는 점진적으로 FSD 로 전환한다. **신규 기능은 FSD 레이어/슬라이스 구조를 우선 고려**한다 — 기존 `components/`·`hooks/`·`lib/` 버킷에 습관적으로 추가하지 않는다.

- 레이어(상위→하위): `app` > `widgets` > `features` > `entities` > `shared`. import 는 **상위→하위 단방향**(역방향·동일 레이어 교차 금지).
- 슬라이스는 세그먼트(`ui`/`model`/`lib`/`config`/`api`)로 나누고 `index.ts` **public API** 로만 외부 노출(기존 `features/auth` 관례).
- **현황**: `features/auth` 만 FSD-shaped. `shared`/`entities`/`widgets` 는 아직 없음 → 신규 기능이 필요로 하면 해당 레이어를 새로 만들며 시작한다.
- **Next 라우터 주의**: `apps/web/app/` 는 Next 라우팅 디렉터리다. FSD 의 `app` 레이어와 이름이 겹치므로 라우팅은 Next `app/` 에 두고, FSD 슬라이스는 `features`/`entities`/`shared` 로 분리한다.
- 기존 코드는 강제 이관하지 않는다(점진). 다만 신규·수정이 닿는 부분은 FSD 방향으로 정리하는 것을 권장한다.

## 사용자 문구(카피) 상수화

UI 카피(라벨·버튼 텍스트·확인/검증 메시지)는 컴포넌트·테스트에 하드코딩하지 않고 상수 모듈에서 import 한다(양쪽이 동일 상수 참조 → 문구 변경이 1곳, 테스트 안 깨짐). **배치는 FSD 레이어 기준**(`lib/constants` 아님):

- **도메인 무관 공통 카피**(저장/삭제/취소/수정, 공통 확인·검증 메시지) → `apps/web/shared/config/messages`.
- **도메인 특정 카피**(강아지·예약·미용사 등 엔티티에 묶인 라벨/상태값) → 해당 `apps/web/entities/<entity>/config` (슬라이스 public API 로 노출).
- **`packages/ui` 컴포넌트는 copy-agnostic** — 라벨을 props 로 받고 합리적 기본값만 갖는다(`ConfirmModal` 의 `confirmLabel?` 선례). packages/ui 는 apps/web 을 import 할 수 없으므로 도메인 카피는 앱이 주입한다.

## API 응답 명명 규약 (snake_case)

서버가 클라이언트로 내려보내는 **데이터 필드는 `snake_case`** 로 통일한다. DB 컬럼·엔티티 속성(`shop_id`·`user_id`·`phone_number`·`is_active`·`created_at`)이 이미 snake_case 이므로, 그 옆에 붙는 값도 같은 표기를 써서 응답 payload 안에서 표기가 섞이지 않게 한다.

- **적용 범위 = `data` 안의 모든 필드**: 엔티티 원본 속성뿐 아니라 컨트롤러가 얹는 **파생/집계 필드**도 snake_case 로 낸다. 선례: `employee.controller.ts` 의 담당 예약건수는 `bookingCount` 가 아니라 **`booking_count`** 로 내린다(집계 alias `[fn('COUNT', col('id')), 'booking_count']` 와 최종 응답 키를 모두 snake_case 로 맞춘다). camelCase 파생 필드 하나가 snake_case payload 에 섞이는 것을 금지한다.
- **envelope/meta 는 예외(현행 유지)**: 응답 래퍼의 메타(`pagination` 의 `currentPage`·`totalPages`·`totalCount`·`hasNextPage`·`hasPrevPage`)는 **현재 camelCase** 이며 모든 컨트롤러가 그렇게 통일돼 있다. 이 규약은 **도메인 데이터 필드**에 대한 것이고, envelope 메타는 건드리지 않는다(바꾸면 전 컨트롤러·프론트 동시 수정 필요 → 범위 밖).
- **경계는 응답 직전**: Sequelize `raw` alias, 서비스 반환값 등 내부 표기가 무엇이든 **클라이언트로 나가는 최종 JSON 키**가 snake_case 이면 된다. 새 필드를 응답에 추가할 때 이 표기를 기본값으로 택한다.
- 프론트(`apps/web`)는 이 snake_case 필드를 그대로 받아 쓴다. API 계약 변경(필드 추가·표기 변경)은 `API_DOCUMENTATION.md` 의 실제 구현 기준 원칙에 따라 문서에도 반영한다.

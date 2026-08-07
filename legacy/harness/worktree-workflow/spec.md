# worktree-workflow

## 목적
단일 워킹트리 제약 때문에 한 기능을 구현하는 도중(미커밋 WIP 상존)에는 다른 브랜치로 이동하거나 동시 작업을 할 수 없다. `git worktree`로 브랜치별 워킹트리를 분리해 이 제약을 푼다. 다만 Turborepo 모노레포 특성에서 오는 운영 마찰(worktree별 `node_modules`, 공유 `index.json` 머지 충돌, worktree 배치 위치, 단일 세션 전제의 프로토콜)을 **규약 + 자동화 스크립트**로 흡수하는 것까지가 이 작업의 범위다.

근거·원인 분석은 `docs/worktree-workflow-plan.md`에 정리돼 있다. 하네스 훅 4개와 `core.hooksPath`가 이미 cwd 기준이라(아래 기능들은 그 호환성을 전제로 한다) 훅 자체는 수정하지 않는다.

## 범위 밖 (명시)
- 훅 로직(`.claude/hooks/*`, `.githooks/pre-push`) 수정 — 이미 worktree 호환이므로 건드리지 않는다.
- 패키지 매니저 전환(npm→pnpm)은 **사람 확인 필요**(아래 참고). 기본값은 worktree별 `npm install` 유지.

## 기능 목록

### 기능: CLAUDE.md에 worktree 동시작업 규약 추가
- **의도**: 개발자 프로토콜이 "메인 세션 1개"를 전제하므로(원인 P4), worktree로 세션을 여러 개 돌릴 때의 생성·배치·정리·소유권 규약을 명문화한다.
- **방식**: `.claude/CLAUDE.md`에 새 절(예: `## worktree 동시작업 규약`)을 추가한다. 최소한 다음을 문장으로 담는다.
  - **생성 위치**: worktree는 저장소 트리 **밖 형제 디렉터리**(`../<repo>-<task>`)에 만든다. 저장소 내부(예: `.claude/worktrees/`)에 두지 않는다 — tsc/vitest/turbo 글로빙·gitignore 오인 방지.
  - **분기 기준**: worktree는 항상 최신 `dev`에서 분기한다(`git worktree add -b <branch> <path> dev`). 오래된 커밋에서 자르면 stale 훅을 쓸 수 있음을 주의로 명시.
  - **node_modules**: 새 worktree는 자체 `npm install`이 필요하다(`pre-push`가 그 트리에서 tsc/vitest 실행).
  - **index.json 소유권**: `harness/index.json` 편집은 한 시점에 한 세션만(아래 충돌 방지 규약 참조).
  - **정리**: 작업 종료 시 `git worktree remove <path>`로 제거한다(미커밋 잔여가 있으면 브랜치 삭제가 막힘).
- **주의**:
  - `.claude/CLAUDE.md`는 `harness/` 밖이라 기획자 도구 경계 밖이다 — 이 변경은 **개발자(메인 세션)가** 수행한다. 기존 절 구조·말투를 유지한다.
  - 기존 "자동 커밋 + push" 규약과 모순되지 않게, "각 worktree 세션은 자기 작업 브랜치만 push(브랜치가 다르면 충돌 없음)"를 덧붙인다.
- **인수기준**:
  - `.claude/CLAUDE.md`에 worktree **생성 위치(형제 디렉터리)**, **분기 기준(dev)**, **node_modules(worktree별 install)**, **index.json 편집 규약**, **정리 명령(`git worktree remove`)** 다섯 가지가 각각 문장으로 존재한다.
  - 추가된 절은 "저장소 내부에 worktree를 두지 않는다"는 금지 문장을 포함한다.

---

### 기능: worktree 생성 자동화 스크립트 (`scripts/worktree-add.mjs`)
- **의도**: 위 규약(형제 디렉터리 + dev 분기 + install)을 한 명령으로 수행해 P1·P3 마찰을 없앤다. `scripts/setup-githooks.mjs`와 같은 결의 1회성/멱등 node 스크립트로 둔다.
- **방식**: 인자로 작업 브랜치명(예: `feat/monthly-view`)을 받는다.
  - 저장소 루트와 repo 디렉터리명을 `git rev-parse`로 구한다.
  - worktree 경로를 **저장소의 형제**로 산출한다: `<repo-parent>/<repo-name>-<task>` (`<task>` = 브랜치명의 마지막 세그먼트).
  - 산출 경로가 저장소 트리 **내부면 거부**(에러 + exit 1).
  - worktree를 **멱등하게 확보**한다(`ensureWorktree`): 같은 경로에 해당 브랜치 worktree가 이미 있으면 생성을 건너뛰고(재사용) 다음 단계(install/launch)로 진행한다 — `--launch`가 기존 worktree 재진입에도 동작하게(반복 실행이 죽지 않도록). 없으면 생성하되 **브랜치가 이미 있으면 `-b` 없이 attach, 없으면 `dev`에서 분기**한다(`git worktree add [-b] <branch> <path> [dev]`). 같은 경로가 *다른* 브랜치 worktree거나 worktree가 아닌 일반 디렉터리로 점유돼 있으면 명확한 에러로 멈춘다(덮어쓰지 않음). 이미 있는 worktree에 `node_modules`가 있으면 install도 건너뛴다.
  - 생성 후 안내: 해당 worktree에서 `npm install` 필요(`core.hooksPath`는 공유 config라 자동 적용됨을 메시지로 알림). install 자동 실행 여부는 `--install` 플래그로 옵트인(기본은 안내만).
  - **`--seed "<문구>"`**: `--launch` 시 새 세션에 줄 초기 프롬프트(seed)를 명시적으로 지정한다. 생략하면 브랜치에서 도출한 기본 seed(`seedPromptFor`)를 쓴다 — `--launch`가 tailored 프롬프트(예: "v1은 구현됨, 기능 4~7만")를 실어 자동 기동할 수 있게 한다. 인자 파서는 `--seed`의 값 토큰을 브랜치명으로 오인하지 않는다.
  - 경로 산출/검증 로직은 **순수 함수로 분리·export**해 추후 테스트 가능하게 한다.
- **주의**:
  - `git worktree add`는 가역(되돌리려면 `git worktree remove`)이지만, 스크립트에서 **삭제(remove/prune)는 수행하지 않는다** — 비가역 정리는 사람에게 위임.
  - install 단계가 실패해도 이미 만든 worktree는 유지하고, 사용자가 수동 install 하도록 메시지를 남긴다(설치 실패가 스크립트 전체를 비정상 종료시키지 않게).
  - `.git`이 없는 환경에선 조용히 종료(`setup-githooks.mjs`와 동일한 방어).
- **인수기준**:
  - 인자 없이 실행하면 사용법(usage)을 출력하고 0이 아닌 코드로 종료한다.
  - 경로 산출 순수 함수에 브랜치명 `feat/x`를 주면 `<repo-name>-x` 형태의 **형제 경로**(저장소 루트의 부모 아래)를 돌려준다.
  - repo 트리 내부로 귀결되는 입력(예: 경로 주입 시도)에는 에러를 던지거나 0이 아닌 코드로 종료한다.
  - **멱등(재진입)**: 같은 경로·브랜치의 worktree가 이미 있을 때 `--launch`를 실행하면 생성 단계는 에러 없이 건너뛰고(재사용) 세션 기동(새 터미널 창/폴백 명령 출력)까지 도달한다. 순수 파서 `parseWorktreeList`(`git worktree list --porcelain` → `[{path,branch}]`, CRLF·detached 처리)를 export해 검증 가능하게 한다.
  - **크로스플랫폼 런치**: `--launch`는 플랫폼별로 새 터미널 창을 연다 — macOS=Terminal.app(osascript), Windows=새 PowerShell 창(`cmd start` + UTF-16LE `-EncodedCommand`). 미지원/실패 시 붙여넣기용 명령 출력으로 폴백하며, 그 명령·install 안내도 플랫폼별(POSIX `cd &&` / PowerShell `Set-Location;`)로 생성한다.
  - **seed 지정**: `--seed "X"`를 주면 출력/자동 기동되는 세션 기동 명령의 프롬프트가 기본값이 아니라 `X`가 된다. 인자 파서(순수 함수 `parseArgs`)는 `--seed`의 값 토큰을 브랜치명으로 오인하지 않는다.
  - `node --check scripts/worktree-add.mjs`가 통과한다(구문 유효).

---

### 기능: worktree 배치 위치 정책 정리 (`.gitignore` / `.claude/worktrees/`)
- **의도**: 현재 저장소 안에 빈 `.claude/worktrees/` 디렉터리가 있어, worktree를 그 안에 두도록 오인할 여지가 있다(원인 P3). 위치 정책을 코드/설정 수준에서 못박는다.
- **방식**:
  - 정책상 worktree는 저장소 밖에 두므로 `.claude/worktrees/`는 불필요하다 → **제거**하거나, 굳이 내부 배치를 허용할 거면 `.gitignore`에 그 경로를 추가한다.
  - 방어적으로 `.gitignore`에 worktree 산출물 누락분(`.next` 등 빌드 캐시)이 있으면 함께 정리한다.
- **주의**:
  - 디렉터리/파일 **삭제는 비가역**이므로 `.claude/worktrees/` 제거는 **사람 확인 필요**로 둔다(기본 제안: 제거). 확인 전에는 `.gitignore` 보강만 수행한다.
  - `.gitignore`는 `harness/` 밖이라 개발자가 수정한다.
- **인수기준**:
  - worktree를 저장소 밖에 둔다는 정책이 문서(CLAUDE.md 절)와 일치한다.
  - 저장소 내부 배치를 허용하지 않기로 하면 `.claude/worktrees/`가 더 이상 존재하지 않거나(확인 후 제거), 존재한다면 `.gitignore`로 무시 처리돼 추적되지 않는다.

---

### 기능: harness/index.json 동시 편집 충돌 방지 규약
- **의도**: `index.json`은 모든 작업이 공유하는 단일 파일을 브랜치별로 편집하므로, worktree 병렬 작업 시 머지 충돌이 증폭된다(원인 P2 — 이미 `396cfb3 머지 충돌 수정`과 `year-month-date-picker` 등록 누락으로 조짐 존재).
- **방식(기본값 — 규약)**: CLAUDE.md에 "index.json 편집은 항상 최신 `dev` 기준으로, 한 시점에 한 세션만 수행하고 즉시 머지/rebase한다"를 명문화한다. 매핑을 단일 파일에서 분산하는 **설계 변경**(예: spec frontmatter로 브랜치 매핑 도출)은 범위가 커서 **사람 확인 필요**로 둔다.
- **주의**:
  - 이 기능은 규약(문서) 중심이라 코드 변경이 없을 수 있다. 그렇다면 인수기준은 문서 존재로 검증한다.
  - 설계 변경 채택 시 `load-spec.mjs`·`qa-hash.mjs`·`pre-push`가 index.json을 읽는 지점을 모두 바꿔야 하므로 별도 spec으로 분리한다.
- **인수기준**:
  - CLAUDE.md에 index.json 동시 편집 규약(단일 세션 편집 + dev 기준 + 즉시 머지)이 문장으로 존재한다.
  - 등록 누락 검출을 돕는 가벼운 점검(예: `harness/<task>/spec.md`는 있는데 index.json에 없는 항목 경고)을 스크립트로 둘지 여부는 선택 — 두면 `node --check` 통과로 검증한다.

---

## 사람 확인 필요
- **P1 패키지 매니저**: npm→pnpm 전환(content-addressable store로 worktree 간 디스크 공유)은 큰 결정 → 보류. 기본값은 worktree별 `npm install`.
- **P2 매핑 설계 변경**: `index.json` 단일 파일 → 분산(spec frontmatter 등) 전환은 훅 다수 변경을 동반 → 별도 spec. 기본값은 편집 규약.
- **`.claude/worktrees/` 제거**: 디렉터리 삭제는 비가역 → 확인 후 진행(기본 제안: 제거).

## 테스트 메모
- 변경 대부분이 **루트 스크립트 + 문서/설정**이라 테스트 러너가 없다(`packages/ui`만 vitest). 따라서 스크립트의 자동화 테스트는 **러너 도입(Phase 2) 전까지 보류**로 명시한다.
- 대신 검증 가능한 인수기준은: 순수 함수의 입출력(추후 테스트화 가능하도록 export), `node --check` 구문 검사, 문서 키워드 존재(grep)로 확인한다.

# worktree-enforce

## 목적
worktree-workflow로 도구(`scripts/worktree-add.mjs`)·규약은 생겼으나, **task 시작 경로가 여전히 "메인 체크아웃에서 `git checkout -b`"** 라 아무도 worktree로 가지 않는다(실제로 메인 트리에서 checkout 후 제품 소스를 편집하는 사고가 발생했다). 이 작업은 (1) CLAUDE.md의 task 시작 절차를 **worktree-우선**으로 바꾸고, (2) `verify-branch.mjs`가 *"등록된 task 브랜치인데 메인 체크아웃(worktree 아님)에서 제품 소스(`apps/`·`packages/`)를 편집"* 하는 경우를 감지해 `ask`로 경고하게 해서, checkout-in-place를 실제로 막는다.

근거: worktree-workflow(`harness/worktree-workflow/spec.md`)의 후속 수정. 세션은 launch 시 cwd가 고정되므로 "세션을 worktree로 자동 이동"은 불가 — 사람이 worktree 디렉터리에서 세션을 열어야 한다. 이 작업은 그 행동을 **규약 + 훅 경고**로 유도한다.

## 범위 밖
- 세션을 worktree로 **자동 이동/자동 생성**(세션 cwd 고정 한계). 훅이 자동으로 worktree를 만드는 옵션은 후속(사람 확인).
- 훅을 `deny`(차단)로 만드는 것 — 단일/임시작업 여지를 위해 `ask`(경고)까지만 한다.
- pnpm 전환 등 worktree-workflow의 기존 사람-확인 항목.

## 기능 목록

### 기능: CLAUDE.md task 시작 절차를 worktree-우선으로 교체
- **의도**: 프로토콜이 task 시작을 `git checkout -b`(메인 in-place)로 안내하는 한, 세션은 계속 메인 트리에서 작업한다. 시작 절차의 기본값을 worktree로 바꾼다.
- **방식**:
  - `### 자동 커밋 + push`의 `분기 기준` 예시(`git checkout -b feat/<task>`)를 worktree 생성(`scripts/worktree-add.mjs`) 우선으로 교체한다. 단일/임시작업은 메인 checkout도 허용(훅 경고에 승인)임을 함께 명시.
  - `## worktree 동시작업 규약` 절에 **"제품 소스(`apps/`·`packages/`) 작업은 worktree에서 한다 / 메인 체크아웃에서 in-place로 그 코드를 편집하지 않는다"** 를 명문화하고, `verify-branch` 훅이 이를 경고로 강제함을 적는다. `harness/`·`.claude/` 하네스 메타작업은 면제임도 명시.
- **인수기준**:
  - `.claude/CLAUDE.md`에 "메인 체크아웃에서 (제품) 코드 작업을 하지 않는다 / worktree에서 한다"는 취지의 문장이 존재한다.
  - `분기 기준`에 `scripts/worktree-add.mjs` 경로가 task 시작 방법으로 명시된다.
  - 훅이 강제(경고)한다는 사실과 `harness/`·`.claude/` 면제가 문서에 적혀 있다.

---

### 기능: verify-branch.mjs — 메인 체크아웃에서의 task 소스 편집 감지(ask)
- **의도**: 규약만으로는 또 놓친다. 코드 편집 직전에 훅이 "지금 메인 체크아웃에서 제품 소스를 편집하려 한다"를 감지해 `ask`로 경고하면, checkout-in-place 사고를 실제로 잡는다.
- **방식**:
  - 기존 PreToolUse(Edit|Write) 게이트에 단계 추가. 입력의 `tool_input.file_path`를 읽는다.
  - 편집 대상이 `harness/` 또는 `.claude/` 경로면 **면제**(하네스 메타작업 — spec/qa-checklist/CLAUDE.md/훅 자신/QA·planner 서브에이전트 작업이 막히면 안 됨).
  - 면제가 아니고, **등록된 task 브랜치(보호 아님)** 이며, **링크드 worktree가 아니면**(메인 체크아웃: `git rev-parse --absolute-git-dir` 결과에 `/worktrees/` 없음) → `ask`로 "`scripts/worktree-add.mjs <branch>`로 worktree를 만들어 거기서 세션을 여세요. 단일/임시작업이면 승인하세요." 경고.
  - 링크드 worktree 판별이 실패하면 **간섭하지 않는다**(안전 기본값 = 통과).
  - 기존 동작(보호 브랜치/미등록 브랜치 → ask)은 그대로 유지. **deny는 절대 하지 않는다.**
- **주의**:
  - 메인 worktree는 `git-dir == 공용 .git`, 링크드 worktree는 `.git/worktrees/<name>`. `--absolute-git-dir`의 경로에 `/worktrees/` 포함 여부로 판별한다(Windows 역슬래시 정규화).
  - 이 면제 규칙 덕분에 이 작업 자체(CLAUDE.md·훅·spec 편집)와 QA 서브에이전트(qa-checklist 작성)가 경고에 걸리지 않는다.
- **인수기준**:
  - 등록된 task 브랜치 + 메인 체크아웃 + `packages/ui/...` 소스 편집을 나타내는 PreToolUse 입력(JSON, stdin)에 대해 `permissionDecision: "ask"` 를 출력한다.
  - 동일 상황에서 `harness/...` 또는 `.claude/...` 파일 편집 입력에는 `ask`가 없다(exit 0, 무출력).
  - 보호 브랜치/미등록 브랜치의 기존 `ask` 동작이 유지된다.
  - `node --check .claude/hooks/verify-branch.mjs` 가 통과한다.

---

## 테스트 메모
- 훅은 루트 스크립트(테스트 러너 없음) → 자동 테스트는 **보류**(worktree-workflow와 동일, Phase 2). 검증은 `node --check` + PreToolUse JSON을 stdin으로 주입한 **동작 확인**(ask 출력 유무)으로 인수기준을 만족한다.

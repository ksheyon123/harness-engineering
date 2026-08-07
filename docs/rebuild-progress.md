# 하네스 재작성 — 진행 기록

> **범위**: `legacy/` 아카이브 이후 ~ 현재. 설계 근거는 `docs/harness-design.md`, 오케스트레이터
> 규정 초안은 `docs/orchestrator.md` 에 있고 이 문서는 **무엇이 결정됐고 무엇이 남았는지**만 추적한다.

## 0. 지금 저장소는 어떤 상태인가

`legacy/` 로 아카이브하면서 배선이 끊겼고, **아직 다시 이어지지 않았다.**

| 없는 것 | 원래 자리 | 결과 |
|---|---|---|
| `scripts/gate.mjs` | `legacy/scripts/` | 객관 게이트를 돌릴 수단이 없다 |
| `harness/config.json` | `legacy/harness/` | 게이트 대상·`baseBranch`·`harnessMetaPaths` 의 단일 출처가 없다 |
| `.githooks/` | `legacy/githooks/` | `pre-commit`·`pre-push` 가 **아무것도 막지 않는다** |
| `.claude/hooks/` | `legacy/claude/hooks/` | `load-spec`·`verify-branch`·`spec-lock`·`qa-hash` 전부 없다 |
| `.claude/rules/` | `legacy/claude/rules/` | (의도적으로 비워둔다 — §2 참고) |

`git config core.hooksPath` 는 여전히 `.githooks` 를 가리키므로, 그 디렉터리를 만들면 별도
설정 없이 붙는다.

**그런데 `.claude/CLAUDE.md` 는 이것들이 다 있는 것처럼 쓰여 있다.** 지금 이 저장소에서
하드로 강제되는 것은 **하나도 없다.**

---

## 1. 확정된 결정

### 1-1. 세 역할에서 Bash 를 뗀다 (층 0)

설계 문서 §5 의 결론이다 — 어떤 역할에 Bash 를 주면 그 역할에 대한 **경로 소유권 보장 전체가
규약으로 강등된다.** `printf 'x' > ../다른-worktree/src/foo.ts` 한 줄에 `PreToolUse(Edit|Write)`
는 발동하지 않는다.

`developer` 에서 `Bash` 를 제거했다. 이제 세 역할 모두 셸·git 자체가 불가능하다.

**대가**: developer 가 스스로 게이트를 돌릴 수 없고, 스스로 커밋할 수도 없다. 각각 §1-4 와
§1-5 로 푼다.

### 1-2. 세 역할에서 `EnterWorktree` 를 뗀다 (층 1의 구멍 차단)

`EnterWorktree` 스키마의 `path` 모드는 **이미 격리된 서브에이전트에서도 동작**하고, 대상은
`.claude/worktrees/` 아래이기만 하면 된다 — 정확히 형제 역할들이 사는 곳이다.

```
developer-A 가 EnterWorktree({path: ".claude/worktrees/agent-<B의 id>"})
  → A 세션이 B 의 worktree 로 이동 ("only affects this agent")
  → A 가 "자기 트리"로 인식하는 것이 B 의 트리가 된다
  → 경로 소유권 훅이 그 편집을 전부 정상으로 판정한다
```

Bash 보다 조용한 우회다 — 파일을 직접 쓰지 않고 **경로 층이 기준으로 삼는 '자기 트리'를
옮겨버린다.** 설계 문서 §8 의 "층 1에 우회로가 없다"는 이것을 놓치고 있었다.

**세 agents 파일에서 제거했고, 실행으로 검증했다** — `isolation: worktree` 는 이 도구 없이
정상 동작한다(§3).

### 1-3. 역할 정의는 rules 가 아니라 `agents/*.md` 에 둔다

`.claude/rules/*.md` 는 `paths:` glob 에 매칭되는 파일을 **읽는 순간** 로드된다. 역할 정의를
거기 두면 트리거가 어긋난다:

- `planner` 는 `spec.md` 를 **쓰는** 역할이다. 새 task 에서 그 파일은 존재하지 않으므로
  `harness/**/spec.md` 로 건 rule 은 영영 안 걸린다.
- `qa` 는 트리거는 되지만 순서가 틀렸다 — **무엇을 읽을지 정하기 전에** 자기 방법론을 알아야 한다.
- `paths:` 는 **파일**로 선택하지 **역할**로 선택하지 않는다. "이건 QA 만"이라고 말할 수 없다.

**rules 가 맞는 용례는 "이 파일을 고칠 때 이렇게 써라"** — 대상 파일이 이미 있고, 그것을 여는
시점이 규약이 필요한 시점과 일치할 때다.

그래서 3분할이다:

| 내용 | 독자 | 자리 |
|---|---|---|
| 역할이 **무엇을 어떻게** 하는가 | 그 역할 | `.claude/agents/<name>.md` |
| 오케스트레이터가 그 역할을 **어떻게 다루는가** | 오케스트레이터 | `.claude/CLAUDE.md` |
| 특정 경로 코드를 만질 때의 코딩 규약 | 그 파일을 읽는 누구든 | `.claude/rules/*.md` |

**`.claude/rules/` 는 이 저장소를 위한 자리가 아니라 이 하네스가 적용될 프로젝트를 위한
자리다.** 지금은 템플릿만 두고 비워둔다.

### 1-4. 객관 게이트는 훅으로 내린다 — `SubagentStop`

설계 문서 §6. agent frontmatter 가 `hooks:` 를 지원하고, `SubagentStop` 은 `block` 으로 종료를
거부할 수 있다. **훅은 에이전트의 도구 제약을 받지 않으므로**, 게이트를 돌리자고 developer 에게
Bash 를 줄 필요가 없다.

단순 검증이 아니라 **강제 루프**가 된다 — red 면 같은 developer 가 같은 worktree 에서 자기
컨텍스트를 들고 이어서 고친다(§7 의 "실패는 경계를 넘기지 않는다").

**아직 만들지 않았다.**

### 1-5. 회수는 세 역할에 대해 동일하다

세 역할 모두 Bash 가 없으므로 legacy 가 `planner`·`qa` 에만 쓰던 방식을 셋 전부에 적용한다:

```sh
git -C <역할 worktree> add -A
git -C <역할 worktree> commit -F <메시지 파일>
git checkout <task 브랜치>
git merge --no-ff <역할 브랜치>
```

`core.hooksPath` 는 worktree 간 공유되므로 `pre-commit` 이 **그 worktree 안에서** 돈다 —
검사 대상과 커밋 대상이 일치한다.

`git fetch . <역할>:<task>` 로 checkout 없이 fast-forward 회수하는 방법이 있고 브랜치 홉을
하나 줄여주지만, 병렬 developer 의 두 번째부터는 안 되고 절차가 두 갈래로 갈린다.
**일관성을 택했다.**

### 1-6. 규정에는 `[하드]` / `[규약]` 을 표기한다

설계 문서 §3 의 교훈이다 — 구 하네스는 "main 에 커밋하지 않는다"를 **[규약]으로 갖고
있으면서 문서에는 강제되는 것처럼 적어뒀다.** 그래서 `main` 보호가 성립하는 것처럼 보였다.

> **낡은 강제 주장은 없는 것보다 나쁘다. 세션이 안전하다고 믿고 진행한다.**

`docs/orchestrator.md` 는 모든 항목에 강제 수준을 붙였고, `[하드]` 에는 **무엇이 막는지**를
함께 적는다.

---

## 2. 만든 것 / 바꾼 것

| 파일 | 내용 |
|---|---|
| `docs/harness-design.md` | 설계 근거 (이전 커밋) |
| `docs/orchestrator.md` | **신규** — 오케스트레이터 규정 초안. 확정되면 CLAUDE.md 의 해당 절을 대체한다 |
| `docs/rebuild-progress.md` | **신규** — 이 문서 |
| `.claude/agents/developer.md` | `tools:` 에서 `Bash`, `EnterWorktree` 제거 |
| `.claude/agents/planner.md` | `tools:` 에서 `EnterWorktree` 제거 |
| `.claude/agents/qa.md` | `tools:` 에서 `EnterWorktree` 제거 |

`feat/convex-hull` 브랜치(별도, 미push)에는 파이프라인 시험 실행의 산출물이 있다 —
`harness/convex-hull/spec.md`, `harness/index.json`.

---

## 3. 실행으로 검증한 것 — `feat/convex-hull` 시험 가동

`planner` 를 스폰해 convex-hull spec 을 작성시키고 회수까지 돌렸다.

**확인된 것**

- **`isolation: worktree` 는 `EnterWorktree` 없이 동작한다.** planner 가 도구 없이
  `.claude/worktrees/agent-<id>/` 자기 사본에서 정상적으로 돌았다. §1-2 의 제거가 안전하다.
- **회수 절차(§1-5)가 실제로 작동한다.** Bash 없는 역할의 산출물을 오케스트레이터가
  `git -C` 로 커밋 → `--no-ff` 머지 → worktree·브랜치 정리까지 마찰 없이 끝났다.
- **spec 품질 자체는 좋다.** 인수기준이 알고리즘과 실제로 맞았다(수직선 공선 케이스,
  점 1개일 때 monotone chain 이 빈 배열을 내는 함정을 축퇴 분기로 처리 등).

**드러난 문제**

1. **planner 의 보고가 수신자를 착각한다.** 마지막 줄이 "다음 단계: 개발자 세션이 이 spec대로
   구현하고, push 시 QA가 커버리지를 검토합니다" — 사람에게 하는 안내다. 실제 독자는
   오케스트레이터이고, 그가 필요한 것은 **회수 대상 파일 경로 · `<task>` 이름 · `branch:` 값**이다.
   사람이 planner 를 직접 부르던 시절의 잔재.
2. **자기 산출물 개수를 틀렸다.** 보고에 "기능 8개"라 쓰고 7개를 나열했다(파일 자체는 7개로 일관).
3. **커밋이 게이트 없이 통과했다.** `.githooks/` 가 없어 `pre-commit` 이 아예 안 돌았고,
   spec 소유권 검사(`branch:` 값 대조)도 안 걸렸다. **지금은 planner 가 `branch:` 를 틀리게
   써도 아무도 모른다.**
4. **역할이 읽는 CLAUDE.md 는 낡은 것이다.** worktree 가 `HEAD` 에서 잘리므로 사본의
   CLAUDE.md 가 `scripts/gate.mjs`·`spec-lock.mjs` 를 가리킨다. 존재하지 않는 강제 장치를
   전제로 일했다.
5. **`background: true` 가 호출자의 `run_in_background: false` 를 이긴다.** 순차 진행이 필요한
   `planner`·`qa` 에는 매번 알림 왕복이 붙는다.

---

## 4. `planner.md` 검토 결과

| 등급 | 항목 |
|---|---|
| 지금 고친다 | 보고 수신자 오류(§3-1) · "구현은 너를 스폰한 개발자 세션이" (오케스트레이터가 스폰한다) · "세션 seed" 용어(legacy `worktree-add.mjs` 잔재) · 산출물이 "한 파일"이라 적혀 있는데 실제로는 `spec.md` + `index.json` 두 파일 |
| 결정 필요 | `SubagentStop` 형식 게이트 도입 여부 · `model: sonnet` 이 최상류 역할에 맞는지 · `harness/index.json` 의 존폐 |
| 훅 배선에 종속 | `## 규칙 (도구 경계 — 반드시 지킨다)` 제목이 거짓 — 그 아래 4개 중 도구 경계인 것은 없다. planner 는 `Write`/`Edit` 로 `src/`·`package.json` 을 실제로 쓸 수 있다 · `.claude/hooks/spec-lock.mjs`·`pre-commit`·`harness/index.json` 참조가 전부 없는 파일을 가리킨다 |

**spec 형식은 객관 판정이 가능하다** — frontmatter 존재, `branch:` 값이 스폰된 task 브랜치와
일치하는지, 체크박스 유무, 각 `### 기능:` 에 의도/방식/주의/인수기준 4개가 다 있는지. 전부
파싱으로 갈린다. 설계 문서 §6("객관=훅")을 planner 에도 적용하면 `SubagentStop` 게이트가 된다.
판정 불가한 것은 **인수기준이 실제로 검증 가능한가** 뿐이고, 그건 사람 몫으로 남는다.

---

## 5. 미결 사항

### 5-1. 훅 배선 — 가장 급하다

지금 오케스트레이터를 실제로 막는 것이 **아무것도 없다.** 설계 문서 §8 은 층 2(git 훅)를
"면제되지 않는다"고 못박았는데 그 층이 통째로 비어 있다.

| 만들 것 | 무엇을 [하드]로 만드나 |
|---|---|
| `.githooks/pre-commit` | `main`/`dev` 커밋 차단 · 객관 게이트 · spec 소유권 · 부분 스테이징 거부 |
| `.githooks/pre-push` | `refs/heads/main` push 거절(stdin 의 ref 를 본다) · 게이트 백스톱 |
| `scripts/gate.mjs` + `harness/config.json` | 게이트 대상의 단일 출처 |
| `PreToolUse(Edit\|Write)` | 경로 소유권 — 세 역할의 write 범위, 오케스트레이터의 소스 편집 금지 |
| developer `SubagentStop` | 개별 worktree 가 green 이 아니면 종료 거부 |
| `pre-merge-commit` | **머지된 결과**의 게이트. `git merge` 는 `pre-commit` 을 타지 않는다 |

### 5-2. CLAUDE.md 교체 시점

지금 CLAUDE.md 는 없는 것을 가리키고 developer 가 Bash 를 갖고 있다고 적혀 있다. 두 경로:

- **배선 먼저** — 훅을 세우고 실물에 맞춰 문서를 쓴다.
- **문서 먼저, 단 정직하게** — 지금 교체하되 아직 없는 것은 `[하드]` 가 아니라
  `[미구현 — 현재 [규약]]` 으로 표기한다.

**후자를 권한다.** 배선이 여러 task 로 나뉠 텐데 그동안 CLAUDE.md 가 legacy 를 가리키고 있으면
**그 task 들을 진행하는 세션 자신이 틀린 문서를 읽는다**(§3-4 에서 이미 일어났다).

### 5-3. 설계 문서 §8 수정

"층 1에 우회로가 없다"는 `EnterWorktree` 를 놓친 문장이었다. 제거로 참이 됐지만,
**"세 역할에게 Edit/Write 가 파일을 바꾸는 유일한 경로"라는 전제는 도구 목록에 종속된다** —
도구를 하나 더할 때마다 재검토가 필요하다는 것을 §8 에 명시해야 한다.

### 5-4. 설계 문서 §11 에서 이월된 것

1. `SubagentStop` 루프의 상한 — 무한 루프 방지, 상한 초과 시 '자력 해결 불가'로 종료 허용
2. 게이트의 실행 단위 — 변경 파일 기준으로 좁힐지, 매번 전체를 돌릴지
3. `pre-push` 의 main 차단 범위 — 사람의 직접 push 도 막을 것인가(정책 결정)
4. tsc 의 실체 — 이 저장소는 전부 `.mjs` 이고 tsconfig 도 `typescript` 의존성도 없다.
   legacy 의 `gate.typecheck` 는 빈 배열이라 **한 번도 실행된 적 없는 경로다**
5. 미등록 브랜치 판정 — worktree 브랜치는 `worktree-agent-<난수>` 라 항상 실패한다(구조적 오탐).
   빼는 쪽이 맞아 보인다

### 5-5. 그 외

- **`background: true`** — 순차 역할에는 왕복 비용이다(§3-5)
- **`model:` 선택** — `planner: sonnet` / `qa: haiku`. planner 는 파이프라인 최상류라 여기서
  난 오류가 하류 전부에 전파된다(developer 가 잘못된 인수기준을 충실히 구현한다)
- **`harness/index.json` 의 존폐** — legacy 에서 이 파일을 조회한 것은 훅 3곳
  (`load-spec`·`verify-branch`·`spec-lock`)이다. 그 훅들이 어떤 형태로 돌아오느냐에 따라
  planner 의 마무리 절차가 통째로 없어질 수도 있다

---

## 6. 다음 단계 (제안 순서)

1. **`harness/config.json` + `scripts/gate.mjs`** — 다른 모든 게이트 지점이 이것을 참조한다
2. **`.githooks/pre-commit` + `pre-push`** — 층 2. 오케스트레이터를 보는 유일한 층
3. **`.claude/CLAUDE.md` 교체** — §5-2 의 후자 방식
4. **`PreToolUse(Edit|Write)` 훅** — 층 1
5. **developer `SubagentStop` 게이트** — §1-4
6. **`agents/*.md` 세 파일 개정** — §4 의 '지금 고친다' 항목

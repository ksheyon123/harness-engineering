# BACKLOG

`doggy-groommer-scheduler` 에서 하네스만 분리하면서 드러난 잔여 작업. **한 번에 하나씩** 진행한다.

각 항목은 이 저장소의 프로토콜대로 `harness/<task>/spec.md` 를 먼저 쓰고(planner 또는 직접), worktree 에서 구현한다. 항목마다 제안 브랜치명을 적어 뒀다.

> **선행 조건 — `dev` 브랜치가 없다.** `.claude/CLAUDE.md` 는 작업 브랜치를 `dev` 에서 분기하도록 규정하고 `scripts/worktree-add.mjs` 도 `dev` 를 기준으로 삼는데, 이 저장소에는 `main` 밖에 없다. 첫 task 를 시작하기 전에 `dev` 를 만들거나(`git branch dev main && git push -u origin dev`), 아래 **#3** 을 먼저 처리해 기준 브랜치를 설정 가능하게 만든다.

---

## #1 · 게이트 대상이 두 곳에 중복돼 있다 <sub>P1</sub>

**증상** — 1층 객관 게이트의 대상이 서로 다른 두 파일에 각각 하드코딩돼 있고, 사람이 수동으로 일치시켜야 한다. 어긋나면 **세션에서는 통과한 코드가 push 에서 막힌다.** 원인이 코드가 아니라 설정 불일치라 진단도 오래 걸린다.

**근거**
- `.githooks/pre-push:15` — `TSC_DIRS="apps/web packages/ui"`
- `.githooks/pre-push:35` — `TEST_DIR="packages/ui"`
- `.claude/CLAUDE.md` '검증 명령' 절 — 개발자 세션이 참조하는 같은 정보

**바꿀 것** — 단일 소스를 만들고 양쪽이 그걸 읽게 한다. 예: `harness/harness.config.json`

```json
{
  "gate": {
    "typecheck": [{ "dir": "apps/web", "cmd": "npx tsc --noEmit" }],
    "test": [{ "dir": "packages/ui", "cmd": "npx vitest run" }]
  }
}
```

`pre-push` 는 이 파일을 `node -e` 로 읽어 순회하고, CLAUDE.md 의 '검증 명령' 절은 "이 파일을 보라"로 바꾼다.

**완료 조건**
- 게이트 대상을 한 곳에서만 고치면 세션·pre-push 양쪽에 반영된다
- 설정 파일이 없거나 대상 디렉터리가 없으면 **경고 후 건너뛴다**(현재 동작 유지 — push 를 부당하게 막지 않는다)

**브랜치** `refactor/gate-config`

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

## #3 · `worktree-add.mjs` 가 `dev` 와 npm 을 가정한다 <sub>P2</sub>

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

## #4 · `qa-hash.mjs` 의 테스트 파일 패턴이 고정이다 <sub>P2</sub>

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

## 우선순위 요약

| 순서 | 항목 | 이유 |
|:--:|---|---|
| 1 | #1 게이트 설정 단일화 | 가장 현실적인 실패 모드. #3·#4 가 이 설정 파일에 얹힌다 |
| 2 | #2 Phase 1 서술 제거 | 값싸고, QA 산출물을 실제로 오염시킨다 |
| 3 | #3 worktree 기준 브랜치 | 다른 프로젝트 도입의 첫 걸림돌 |
| 4 | #4 qa-hash glob | 조용히 실패해서 발견이 늦다 |
| 5 | #5 index-sync 결정 | 구현 전에 존폐 판단이 먼저 |
| — | #6 doggy rules | 별도 저장소, 독립적으로 가능 |

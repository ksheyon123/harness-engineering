# harness-engineering

Claude Code hooks + git 훅으로 **역할 기반(기획자 / 개발자 / QA) 문서 주도 개발**을 자동화하는 하네스.

핵심 철학:

- **설계 의도가 코드보다 먼저 문서로 확립된다** — 기획자가 *기능 목록*(spec)을 먼저 쓴다.
- **각 역할은 서로 다른 agent이고, 도구 경계로 역할이 강제된다** (Separation of Duties).
- **AI는 차단·판정하지 않는다** — 브랜치에 산출물 묶음(기능 목록 / 코드 / 테스트 / QA 체크리스트)을 남기고 push할 뿐이다.
- **사람의 머지 결정이 유일한 권위 게이트다.** 미비한 기능이 있으면 사람이 추가 개발을 요청한다.

이 모델은 "런타임에 무엇을 막는가"가 아니라 **"브랜치마다 리뷰 가능한 산출물을 남기는가"** 에 초점을 둔다.

> 이 문서는 설계와 사용법을 함께 담는다(구 `harness-engineering.md` 통합). 결정의 배경은 맨 아래 [설계 변경 이력](#설계-변경-이력), 파이프라인 전 구간의 추적과 남은 논점은 [`harness/pipeline-review.md`](./harness/pipeline-review.md) 참고.

---

## 1. 역할 모델

| 역할 | 형태 | 트리거 | 도구 경계 | 산출물 |
|------|------|--------|-----------|--------|
| **기획자** | 서브에이전트 `.claude/agents/planner.md` | 작업 시작(수동) | Read/Grep/Glob + Write/Edit. **Bash ❌** | `spec.md` — 기능 목록 |
| **개발자** | **메인 세션** | 사용자 | 코드·테스트 전체 편집 | 코드 + 테스트(green) |
| **QA** | 서브에이전트 `.claude/agents/qa.md` (게이트 통과 후 세션이 스폰 / pre-push에서 headless) | 자동 | Read/Grep/Glob + Write/Edit. **Bash ❌ → 테스트 실행 불가** | `qa-checklist.md` — 기능 체크리스트 + 커버리지 매트릭스 |
| **사람** | — | PR 리뷰 | — | **머지 결정 (유일한 품질 게이트)** |

분리가 "의미"가 되는 두 원칙:

- **기획자는 코드를 짜지 않는다** — 명세(기능 목록)만. 안 그러면 그냥 개발자다.
- **QA는 코드를 못 고친다** — 자기가 고쳐서 통과시키면 검증이 무의미. 읽기 + 대조 + 리포트만. 단 *리포트 기록*을 위해 `harness/` 에는 쓸 수 있다.

> 개발자=메인 세션인 이유: 코딩은 iterative하고 사람과 왕복 대화가 필요한데, 서브에이전트는 비대화형 단발 실행기라 맞지 않는다. 기획자·QA는 fire-and-forget이라 서브에이전트가 맞는다.
>
> 개발자의 행동 규약이 별도 에이전트 파일이 아니라 `.claude/CLAUDE.md` 에 있는 것도 같은 이유다.

---

## 2. 전체 플로우

```
사람+AI ─▶ main 체크아웃 = 디스패처: 요구사항 논의 → 브랜치명 확정
              │   여기서는 기획도 구현도 하지 않는다
              ▼
        node scripts/worktree-add.mjs <branch> --launch
              │   형제 디렉터리에 worktree 생성 + 설치 + 새 창에서 세션 기동
              │   seed 는 그 worktree 의 등록 여부로 갈린다(미등록=기획부터 / 등록=이어서)
              ▼
        개발자(그 worktree의 메인 세션) ── 여기서부터 전부 한 브랜치 위에서 일어난다
              │
              ├─▶ 기획자(planner) 스폰: 기능 목록 작성 → harness/<task>/spec.md
              │        + harness/index.json 에 브랜치 등록  → spec 커밋
              │        ※ 한 브랜치는 spec 을 한 번만 확정한다(pre-commit 이 강제)
              ▼
        이어서 구현 — load-spec 훅이 브랜치의 spec을 컨텍스트에 주입
              │   test-first: 실패 테스트(RED) → 구현 → 통과(GREEN)
              ▼
        node scripts/gate.mjs        ← 1층 객관 게이트 (자기 점검)
              ▼
        QA 서브에이전트 스폰 → qa-checklist.md   ← 2층 주관(비차단)
              ▼
        git commit ─[pre-commit]─ 부분 스테이징 거부 → spec 소유권 검사 → 게이트 → 통과 트리 기록
              ▼
        git push  ─[pre-push]── 게이트(조건부) + QA 해시 검사 + 산출물 미커밋 차단
              ▼
        작업 브랜치에 push — 산출물 4종(spec / 코드 / 테스트 / qa-checklist) 포함
              ▼
        사람: PR 리뷰 → 충분하면 머지            ← 유일한 권위 게이트
              │
              └─ 거부/변동 시: node scripts/worktree-add.mjs <branch>-1 --from <branch> --launch \
                                 --seed "spec 개정 — <요청 내용>"
                               → 새 세션이 spec 을 개정하고 이어서 구현한다
```

**`[x]` 확정·차단·에스컬레이션 큐는 AI 플로우에 없다.** 완성도 판단은 전적으로 사람의 머지 시점에 일어난다.

**파이프라인 안에 사람이 멈춰 서는 지점은 없다.** spec 검토를 별도 게이트로 두지 않고 최종 PR 하나로 몰았다 — 그래야 "사람의 머지 결정이 유일한 권위 게이트"라는 선언과 실제가 일치한다. 대가는 spec 검토가 구현 뒤로 밀리는 것이고, 그것은 `--from` 리비전 경로로 회수한다.

---

## 3. 구성

```
.claude/
  CLAUDE.md                 # 하네스 코어 규약 (역할·게이트·커밋/push·worktree) — 개발자 역할 정의
  rules/                    # 프로젝트별 코딩 규약 — paths: frontmatter 로 조건부 로드
    example.md.template     #   복사해서 쓰는 템플릿
    test-git.md             #   테스트에서 git 을 부를 때의 규약 (게이트 밖 이중 방어)
  agents/planner.md         # 기획자 — spec.md(기능 목록) 작성. src 편집 ❌
  agents/qa.md              # QA — 커버리지 매트릭스 작성. src 편집 ❌, 테스트 실행 ❌
  hooks/load-spec.mjs       # UserPromptSubmit — 현재 브랜치의 spec 을 컨텍스트에 주입
  hooks/verify-branch.mjs   # PreToolUse(Edit|Write) — 보호 브랜치 / worktree 게이트
  hooks/qa-hash.mjs         # QA 입력 해시 (재생성 무한루프 차단)
  hooks/spec-lock.mjs       # spec 소유권 판정 — 한 브랜치는 spec 을 한 번만 확정한다
  hooks/session-cost.mjs    # SessionEnd — 세션 토큰/비용 요약
  settings.json             # 훅 등록 + 권한 경계
.githooks/
  pre-commit                # spec 소유권 검사 + 1층 객관 게이트 — 실패하면 커밋 자체가 안 만들어진다
  pre-push                  # 게이트(조건부 재실행) + 2층 headless QA
scripts/
  gate.mjs                  # 1층 객관 게이트의 유일한 실행 진입점
  setup-githooks.mjs        # core.hooksPath 자동 활성화 (npm install 시)
  worktree-add.mjs          # 브랜치별 worktree 생성 + 세션 자동 기동
  token-usage.mjs           # 토큰/비용 집계
harness/
  config.json               # 게이트 대상의 단일 출처 (+ baseBranch·installCommand·
                            #  testFilePatterns·harnessMetaPaths)
  index.json                # 브랜치 → spec 경로 매핑
  <task>/spec.md            # 기획자 산출물 — 기능 목록
  <task>/qa-checklist.md    # QA 산출물 — 커버리지 매트릭스
.gitattributes              # eol=lf 고정 (셰뱅+CRLF 가 worktree 게이트를 깨뜨림 — BACKLOG #8)
```

> 기능 목록(기획자)과 기능 체크리스트(QA)는 **독립 산출물**이라 별도 파일로 분리한다. QA가 기획자 목록을 그대로 상속하지 않고 독립 도출해야, 기획자 목록의 누락까지 잡힌다.

하네스 자신의 테스트는 검사 대상 옆에 둔다: `scripts/*.test.mjs`, `.claude/hooks/*.test.mjs`.

---

## 4. 2층 검증 — 객관 / 주관 분리

| 층 | 무엇 | 실행 주체 | 차단? |
|----|------|-----------|:---:|
| **1층 (객관)** | 결정적 통과 여부(타입 검사·테스트) | 결정적 스크립트 (LLM 불필요) | **red면 커밋·push 중단** |
| **2층 (주관)** | 기능 체크리스트 ↔ 테스트 커버리지 대조 | QA 에이전트 (LLM) | ❌ 비차단. 매트릭스에 기록만 |

테스트는 "이거 맞나?"의 객관적 부분을 LLM에서 떼어내 **공짜이고 반복가능한 신호**로 만든다. 그 덕에 QA는 *테스트를 실행할 필요 없이*(Bash 불필요) 정적으로 읽고 커버리지만 평가한다.

### 게이트 대상은 설정 하나에서 온다

1층 객관 게이트가 **무엇을 어디서 도는지는 `harness/config.json` 의 `gate` 가 유일한 출처**다. 실행 진입점도 하나(`node scripts/gate.mjs`)이고, 세션·`pre-commit`·`pre-push` 가 모두 그것을 호출한다. `CLAUDE.md` 에도 이 README 에도 대상 목록을 옮겨 적지 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋나고, **낡은 사본은 없는 것보다 나쁘다**(세션이 틀린 검사를 돌리고 '통과했다'고 확신한다. 실제로 일어났던 일이다 → 구 BACKLOG #1).

QA도 같은 파일을 Read해서 러너 유무를 판단한다(QA는 Bash가 없어 게이트를 실행할 수 없다). `gate.test` 항목이 없으면 러너가 없는 것이고, **그때만** 커버리지를 '테스트 러너 없음'으로 기록한다 — "테스트가 없을 것"이라고 가정하지 않는다.

세션에서:

```sh
node scripts/gate.mjs           # 전체 실행
node scripts/gate.mjs --list    # 대상만 확인 (테스트를 어디에 쓸지 판단)
```

---

## 5. 게이트 파이프라인 — pre-commit / pre-push

```
git commit ─[pre-commit]─ 부분 스테이징 거부 → spec 소유권 검사 → gate.mjs → 통과한 트리 해시를 기록
                          실패 → 커밋 중단 (워킹트리 보존, 히스토리 무손상)
git push   ─[pre-push]──  HEAD 트리 == 기록된 트리?  같으면 게이트 생략
                          다르면(rebase·머지·--no-verify) gate.mjs 재실행
                          + spec 조회 → QA 입력 해시 비교 → 재생성 → 미커밋이면 차단
```

**게이트를 커밋 앞에 두는 이유**: 없으면 `git commit` 은 무조건 성공하고 실패는 push 시점에야 드러난다. 그때는 이미 깨진 커밋이 히스토리에 남아 `--amend` 가 필요하고, 수정이 테스트/spec 에 닿으면 QA 입력 해시가 바뀌어 push 시도가 3회까지 늘어난다.

**부분 스테이징을 거부하는 이유**: 훅은 워킹트리를 검사하는데 커밋되는 것은 인덱스다. 둘이 다르면 '통과했다고 판정한 트리'와 '실제 커밋되는 트리'가 어긋나 거짓 통과가 난다. 하네스는 spec 당 코드+테스트+qa-checklist 를 한 커밋에 담는 규약이라 부분 스테이징을 쓸 일이 없다 — stash 후 복원(작업 손실 위험) 대신 **거부**한다.

**pre-push 의 게이트를 없애지 않는 이유**: `rebase`·자동 머지는 `pre-commit` 을 실행하지 않는다. 각각은 통과하지만 합치면 깨지는 조합(semantic conflict)은 커밋 시점에 존재하지 않아 `pre-commit` 이 원리적으로 잡을 수 없다. 마커가 없거나 다르면 **안전 기본값 = 실행**.

### pre-push 가 QA를 다루는 방식 — 두 함정

push가 곧 마일스톤이다. 슬래시 커맨드와 달리 *"개발자가 깜빡함"이 불가능*하고, 사람/AI 누가 push하든 git이 강제한다. 단 두 함정을 처리해야 한다.

**함정 1 — 타이밍: pre-push에서 만든 산출물은 그 push에 안 들어간다.**
pre-push는 *이미 커밋된 ref* 를 보내기 직전에 돈다. 이때 생성한 `qa-checklist.md` 는 미커밋 변경일 뿐이다.
→ **재생성 → 미커밋이면 차단 → 커밋 → 재push** 패턴(포매터 훅과 동일). 이 차단은 *"QA 산출물 미커밋"* 에 대한 **패키징 게이트**이지, 커버리지 누락에 대한 품질 게이트가 아니다. **누락/partial은 push를 막지 않는다** → "사람 머지가 유일한 품질 게이트" 유지.

**함정 2 — 비결정성: LLM은 매번 결과가 달라 재push가 영원히 수렴 안 할 수 있다.**
→ **입력 해시 스킵.** `(spec + 테스트 파일들)` 의 해시를 `qa-checklist.md` frontmatter 에 기록한다. push 시 `node .claude/hooks/qa-hash.mjs <branch>` 값과 같으면 QA를 스킵하고 통과. 1회차(입력 변경)엔 생성·차단 → 커밋, 2회차엔 입력 불변 → 해시 일치 → 스킵 → 통과. 루프가 끊긴다. (덤으로 WIP push마다 LLM 도는 비용도 차단.)

그래서 **세션이 커밋 전에 QA를 스폰하고 해시를 직접 주입하는 것이 정상 경로다** — 그러면 push 는 한 번에 끝난다. pre-push 의 headless QA 는 그 경로를 밟지 않았을 때의 안전망이다.

`.githooks/pre-push` 의 실제 순서:

1. **1층 객관 게이트** — `node scripts/gate.mjs`. 단 `pre-commit` 이 통과시킨 트리 해시(git-dir 안 마커)와 `HEAD^{tree}` 가 같으면 건너뛴다.
2. **spec 조회** — `harness/index.json` 에서 현재 브랜치의 spec 을 찾는다. 없으면 QA 생략, push 허용.
3. **입력 해시 스킵** — `qa-hash.mjs` 값 == frontmatter `input_hash` 면 QA 생략.
4. **QA 생성(headless)** — `claude -p ... --model haiku --permission-mode acceptEdits --allowedTools "Read,Grep,Glob,Edit,Write" --disallowedTools "Bash" < /dev/null`. 역할 정의는 프롬프트에서 `.claude/agents/qa.md` 를 Read 하게 한다(단일 소스). **QA 실행 실패는 push 를 막지 않는다** — `claude` CLI 가 없을 때도 마찬가지다.
5. **패키징 게이트** — QA 산출물이 미커밋이면 중단하고 커밋 후 재push 를 안내한다.

> **훅 자신의 출력이 훅을 죽이면 안 된다.** 진단 출력은 서브셸 헬퍼(`say()`)로 내보내, 파이프가 닫혀 출력이 실패해도(`git commit | head -6` 같은 소비자) 종료 코드가 그것에 좌우되지 않게 한다. 실제로 훅이 SIGPIPE 로 죽어 **막아야 할 커밋이 조용히 통과한** 적이 있다. 정보성 메시지도 같은 헬퍼를 쓴다 — 그것 때문에 훅이 죽으면 통과해야 할 push 가 막힌다(거짓 차단).

> **한계(기록)**: 게이트를 *실행하는* 경로에서 `gate.mjs` 는 워킹트리를 검사하지 `HEAD` 의 트리를 체크아웃해 검사하지 않는다. 워킹트리가 dirty 하면 push 되는 내용과 검사 대상이 다를 수 있다. 스킵 경로에는 이 문제가 없다(커밋 시점에 검증된 트리와 `HEAD` 트리가 같음을 확인한다).

> **게이트는 `GIT_*` 를 씻고 명령을 스폰한다.** 게이트가 git 훅 안에서 돌면 자식 프로세스가 진짜 저장소를 가리키는 `GIT_DIR`·`GIT_INDEX_FILE` 을 상속한다. **`GIT_DIR` 이 있으면 `git -C` 는 무시되므로**, 임시 저장소를 겨냥한 테스트가 실제로는 이 저장소를 조작한다(가설이 아니라 실제로 브랜치를 덮어썼다 → 구 BACKLOG #9). 방어는 스폰 지점 한 곳(`gate.mjs`)에 있고, 게이트 밖(직접 실행·CI)을 위한 이중 방어는 `.claude/rules/test-git.md` 에 있다.

---

## 6. 세션 훅 — 무엇이 언제 도는가

설정 위치가 둘로 나뉜다. **Claude 훅은 세션 중**, **git 훅은 커밋/push 시** 동작한다.

| 위치 | 이벤트 | 담당 |
|------|--------|------|
| `.claude/settings.json` | `UserPromptSubmit` | `load-spec.mjs` — 브랜치의 기능 목록 주입 |
| | `PreToolUse` (`Edit\|Write`) | `verify-branch.mjs` — 보호 브랜치 / worktree 강제 |
| | `SessionEnd` | `session-cost.mjs` — 세션 토큰/비용 요약 |
| `.githooks/pre-commit` | 커밋 시 | 부분 스테이징 거부 + 1층 객관 게이트 + 트리 마커 |
| `.githooks/pre-push` | push 시 | 게이트(조건부) + 2층 headless QA + 패키징 게이트 |

> Claude Code의 hook 이벤트에는 git 생명주기가 없다. 그래서 QA-at-push는 **git 훅**이고, 그 안에서 headless Claude를 호출한다. 이 분리 덕에 초기 설계에서 막혔던 "Stop hook 무한루프", "agent hook의 Write/Bash 가능 여부" 같은 불확실성이 **전부 사라진다** (QA는 hook의 `type: agent` 가 아니라 일반 headless 호출이라 도구 제약이 없다).

### 6.1 `load-spec.mjs` — 기능 목록 로더 (UserPromptSubmit)

게이트(차단)가 아니라 **주입(로더)** 다. 현재 브랜치의 `spec.md` 를 읽어 개발자 컨텍스트에 깐다 → AI가 항상 설계 의도를 보고 코딩한다.

- `command` 타입이라 git·파일 접근이 되어, prompt 타입의 한계(상태 못 읽음)가 없다.
- `jq` 미설치 + Windows를 고려해 **Node 스크립트**로 구현(추가 의존성 없음).
- 문서 없는 브랜치는 **하드 차단하지 않고 소프트 경고**만 한다(전제: 기획자가 사전 작성). 강제는 사람이 책임진다.

### 6.2 `verify-branch.mjs` — 워킹트리·브랜치 게이트 (PreToolUse)

`Edit`/`Write` 마다 대상 파일과 세션의 git 컨텍스트를 비교해 판정한다. **순서가 중요하다** — 앞선 판정이 `ask` 를 반환하면 뒤의 `deny` 가 샌다.

| # | 조건 | 결과 |
|:--:|------|------|
| 0 | 대상이 **다른 워킹트리**(같은 저장소, 다른 toplevel) | **`deny`** — 그 worktree 의 세션에서 하라 |
| 0' | 대상이 **다른 저장소** | `ask` — 다중 저장소 작업은 정당할 수 있다 |
| 1 | 현재 브랜치가 보호 브랜치(`main`/`dev`) | `ask` |
| 2 | 현재 브랜치가 `index.json` 에 미등록 | `ask` — 애드혹 수정 허용 |
| 3 | 대상이 `harnessMetaPaths` 면제 경로 | 통과 (저장소 루트 기준 앵커링) |
| 4 | 등록된 task 브랜치 + **메인 체크아웃** | **`deny`** — worktree 에서만 |
| 5 | 등록된 task 브랜치 + worktree | 통과 |

면제 판정은 **저장소 루트 상대경로 + 디렉터리 경계 매칭**이다. 부분 문자열 매칭이던 시절엔 `apps/web/harness/foo.ts` 가 면제돼 제품 코드가 뚫렸다(구 BACKLOG #7).

---

## 7. worktree 동시작업

여러 작업을 동시에 진행할 때는 `git worktree` 로 브랜치별 워킹트리를 분리하고, **worktree 1개 = 개발자 세션 1개**로 붙인다(세션 간 컨텍스트는 공유되지 않는다).

```sh
node scripts/worktree-add.mjs feat/<task> --launch
```

- **생성 위치**: 저장소 트리 **밖 형제 디렉터리**(`../<repo>-<task>`). 저장소 내부에 두면 타입 검사·테스트 러너의 글로빙과 `.gitignore` 가 그 트리를 untracked/중첩 repo로 오인한다.
- **분기 기준**: 항상 최신 `baseBranch`(`harness/config.json`). 로컬에 없으면 `origin/<baseBranch>`, 둘 다 없으면 **에러로 멈춘다** — `HEAD` 로 조용히 물러서면 의도치 않은 커밋에서 분기된다.
- **`--install`**: 그 worktree에서 `installCommand` 실행. 새 worktree에는 `node_modules` 가 따라오지 않고, `pre-push` 가 그 트리에서 게이트를 돌리므로 설치가 없으면 게이트가 실패한다.
- **`--launch`**: `--install` 포함 + 새 터미널 창(macOS=Terminal.app, Windows=PowerShell)에서 세션 자동 기동. 미지원/실패 시 기동 명령 출력으로 폴백.
- **push**: 각 세션은 자기 작업 브랜치만 push한다. `main`/`dev` 로는 절대 push하지 않는다.
- **정리**: `git worktree remove <path>`. 디렉터리 삭제는 비가역이므로 자동화하지 않고 사람이 한다.

**`harness/index.json` 은 모든 작업이 공유하는 단일 파일이라 병렬 편집 시 충돌한다.** 등록은 한 시점에 한 세션만, 최신 `baseBranch` 기준으로 하고 곧바로 머지한다. 코드 작업 세션은 index.json 을 건드리지 않는 것이 기본이다.

---

## 8. 문서 포맷

### 8.1 `spec.md` — 기획자의 기능 목록

기획자는 *체크하지 않는다.* 기능을 열거하고, 각 기능의 의도/방식/주의/인수기준을 기술한다.

```markdown
# 태스크명

## 목적
이 작업이 왜 필요한지.

## 기능 목록

### 기능: 콜백 code 중복 제출 방지
- **의도**: authorization code는 일회용 → 1회만 교환되어야 함
- **방식**: useRef 가드 + useEffect 의존성 []
- **주의**: React StrictMode 이중 마운트
- **인수기준**: 동일 code로 2회 진입해도 교환 POST는 1회만 발생

### 기능: 콜백 에러 표시
- **의도**: ...
- **방식**: ...
- **주의**: ...
- **인수기준**: ...
```

### 8.2 `qa-checklist.md` — QA의 기능 체크리스트 + 커버리지 매트릭스

QA가 `spec.md` 의 기능 목록으로부터 **독립적으로** 검증 항목을 도출하고, 개발자의 **테스트 코드를 읽어** 커버리지를 대조한다. *판정은 하지 않고, 누락을 사람에게 올린다.*

```markdown
---
input_hash: <spec.md + 테스트 파일들의 해시>
generated: 2026-06-13
spec: harness/<task>/spec.md
---

# QA 기능 체크리스트 — 태스크명

## 기능 체크리스트 (기획 의도로부터 독립 도출)
- code 1회만 교환되는가
- StrictMode 이중 마운트에도 1회인가
- 에러 시 사용자에게 메시지가 노출되는가

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| code 1회만 교환 | `callback.test > "exchange once"` | ✅ covered | — |
| StrictMode 이중마운트 1회 | (없음) | ❌ 누락 | **요검토** |
| 에러 메시지 노출 | `callback.test > "shows error"` | △ partial (메시지 내용 미검증) | 요검토 |
```

`❌ 누락` / `△ partial` 행이 **사람에게 올라가는 결정 큐**이며, PR 리뷰에서 처리된다.

---

## 9. 권한 / 경계 모델

도구 경계는 **파일 단위로 하드 강제**, 문서 섹션 소유는 **프롬프트로 소프트 강제**한다.

| 역할 | src 편집 | docs 편집 | 테스트 실행 | 비고 |
|------|:---:|:---:|:---:|------|
| 기획자 | ❌ | ✅ | — | 명세만 작성 |
| 개발자 | ✅ | △ (기능 목록 섹션만) | ✅ | 명세(spec)는 사람·기획자 영역 |
| QA | ❌ | ✅ (`harness/`) | ❌ (읽기만) | 자기채점·자기수정 금지 |

| 문서 영역 | 소유자 |
|------|--------|
| `spec.md` 기능 목록(의도/방식/주의/인수기준) | 기획자 |
| `qa-checklist.md` 기능 체크리스트 + 매트릭스 | QA |
| 커버리지 누락 판단 / 추가 개발 요청 | **사람** |

**파괴적/비가역 행위(파일 삭제, force-push 등)는 어떤 agent도 직접 하지 않는다** — spec/리뷰에 명시해 사람이 수행한다. `settings.json` 의 `permissions.deny` 가 `rm -rf`·`git push --force`·`git reset --hard`·`.env` 읽기를 막는다.

---

## 10. 도입

```sh
npm install   # prepare 훅이 core.hooksPath 를 .githooks 로 설정한다
```

의존성은 `vitest` 하나뿐이다(하네스 자신의 테스트용). `npm install` 은 그 설치와 git 훅 활성화를 겸한다.

도입 프로젝트가 채워야 하는 것:

**1. `harness/config.json`** — 게이트 대상. 이게 1층 객관 게이트의 **유일한** 정의다.

```json
{
  "baseBranch": "dev",
  "installCommand": "npm install",
  "testFilePatterns": ["**/*.test.{ts,tsx}"],
  "harnessMetaPaths": ["harness/", ".claude/", ".githooks/"],
  "gate": {
    "typecheck": [{ "dir": "apps/web", "cmd": "npx tsc --noEmit" }],
    "test": [{
      "dir": "packages/ui",
      "cmd": "npx vitest run --changed {{BASE}} --passWithNoTests",
      "fallbackCmd": "npx vitest run"
    }]
  }
}
```

| 키 | 쓰임 |
|---|---|
| `baseBranch` | 게이트의 merge-base 산출 + `worktree-add.mjs` 의 분기 기준 |
| `installCommand` | `worktree-add.mjs` 가 새 worktree에서 돌릴 설치 명령(기본 `npm install`) |
| `testFilePatterns` | `qa-hash.mjs` 가 해시 입력으로 잡을 테스트 파일 |
| `harnessMetaPaths` | `verify-branch.mjs` 의 worktree 강제 면제 경로 |
| `gate` | 1층 객관 게이트 대상 |

`installCommand` 는 lockfile 로 자동 감지하지 않는다 — 추측이 틀리면 조용히 잘못된 매니저로 설치한다. pnpm/yarn/bun 이면 여기서 바꾼다.

`{{BASE}}` 는 `merge-base(baseBranch, HEAD)` 로 치환된다(브랜치 변경분만 검사). 산출할 수 없으면 `fallbackCmd` 로 물러선다. 존재하지 않는 `dir` 은 경고 후 건너뛰고, 설정 파일 자체가 없으면 게이트 없이 통과한다 — 도입 초기에 push 가 부당하게 막히지 않게 하기 위함이다. 반대로 파일이 있는데 JSON 이 깨져 있으면 **중단**한다(오타가 '게이트 없음' 으로 둔갑하면 안 된다).

**2. `.claude/rules/*.md`** — 프로젝트별 코딩 규약. `example.md.template` 을 복사해 쓴다.

**3. 인증 토큰** — `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` 을 셸 환경에 설정(headless QA 전제). `ANTHROPIC_API_KEY` 도 가능. `--bare` 는 OAuth를 읽지 않으므로(API key 전용) 로컬 구독 로그인 훅에선 쓰지 않는다.

`.claude/CLAUDE.md` 나 훅에 게이트 대상을 다시 적지 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋날 수 있고, **낡은 사본은 없는 것보다 나쁘다**.

그 다음 기획자(`planner`)로 첫 태스크의 `harness/<task>/spec.md` 를 쓰고, `harness/index.json` 의 `tasks` 에 `"<branch>": "harness/<task>/spec.md"` 를 등록한다.

> 점진 적용 권장: 먼저 로더 + 설정 + 문서 + 개발 흐름으로 가치를 확인한 뒤, git 훅 + QA를 붙인다.

### 프로젝트 규약을 CLAUDE.md 에 쓰지 않는 이유

`.claude/CLAUDE.md` 와 `@import` 로 끌어온 파일은 **세션 시작 시 전부 컨텍스트에 로드**된다. 파일만 나누는 것은 사람 가독성에만 도움이 되고 AI 쪽 이득은 없다. 반면 `paths:` frontmatter 가 붙은 `.claude/rules/*.md` 는 **매칭되는 파일을 읽을 때만** 로드되므로, 프론트 작업 중에 백엔드 규약이 컨텍스트를 차지하지 않는다.

주의: `paths:` 없는 rule 은 `.claude/CLAUDE.md` 와 동일하게 매 세션 로드된다. 또 rule 은 매칭 파일을 **읽을 때** 걸리므로, 파일을 읽기 전 계획 단계에서 지켜져야 하는 규약은 `CLAUDE.md` 에 둔다.

경계 요약:

- **`.claude/CLAUDE.md`** — 하네스 코어(역할·게이트·커밋/push·worktree) + 읽기 *전* 지켜져야 할 규약.
- **`.claude/rules/*.md`** — 특정 경로의 코드를 만질 때만 필요한 규약.
- **`.claude/hooks/*`·`.githooks/*`** — 반드시 막아야 하는 것. CLAUDE.md·rules 는 컨텍스트일 뿐 강제가 아니다.

---

## 11. 검증된 사항 (공식 문서 기준, 2026-06-13)

| 항목 | 결론 |
|------|------|
| headless 호출 | `claude -p "<prompt>"`, 출력 `--output-format text\|json\|stream-json`, 종료코드 0/비0 |
| 서브에이전트 지정 | **`--agent <name>` 플래그 없음.** 자동 위임 또는 `--agents '<json>'` 인라인. 훅은 직접 호출 + `--allowedTools` 로 경계 강제 |
| 서브에이전트 정의 | `.claude/agents/*.md` frontmatter: `name`/`description`/`prompt`/`tools`/`model`/`permissionMode`. **`tools` 화이트리스트는 미포함 도구를 실제로 차단** |
| 비대화형 권한 | `--permission-mode acceptEdits` + `--allowedTools`(+`--disallowedTools`) → 무프롬프트 |
| stdin 충돌 | pre-push가 ref를 stdin으로 넘김 → **`< /dev/null` 필수** |
| 인증 | `CLAUDE_CODE_OAUTH_TOKEN`(`claude setup-token`) 또는 `ANTHROPIC_API_KEY`. `--bare` 는 OAuth 미사용 |

여전히 **저장소 고유**로 확인할 것: Windows git 훅이 git-bash(sh)로 실행되는지(현재 `/usr/bin/bash` 존재 확인됨) + 개발자 셸에 인증 토큰 노출.

---

## 12. 포함된 spec

`harness/` 아래 spec 들은 **하네스 자신을 만든 작업의 실제 spec**이다. 형식 예시이자 설계 근거로 남겨둔다.

| task | 내용 |
|---|---|
| `worktree-workflow` | 브랜치별 worktree 분리 규약 + `worktree-add.mjs` |
| `worktree-enforce` | task 시작을 worktree 우선으로 강제 (`verify-branch.mjs`) |
| `token-usage` | 세션 토큰/비용 사후 집계 (`token-usage.mjs`) |
| `gate-pipeline` | 게이트 정의·실행 단일화 + `pre-commit` 도입 (`gate.mjs`, `config.json`) |
| `worktree-config` | `worktree-add.mjs` 의 분기 기준·설치 명령을 `config.json` 에서 읽기 |
| `index-sync-removal` | 한 번도 동작한 적 없던 코드↔문서 드리프트 알림 훅 제거 |
| `gate-env-isolation` | 게이트가 스폰하는 프로세스에서 `GIT_*` 를 씻어낸다 |
| `verify-branch-guard` | 교차 워킹트리 편집 차단 + 면제 경로 루트 앵커링 (`harnessMetaPaths`) |
| `drop-phase1` | "테스트 러너가 없다" 는 낡은 전제를 조건부 규칙으로 대체 |

## 알려진 제약

이 저장소는 Turborepo 기반 프로젝트에서 하네스 부분만 분리한 것이다. 분리 과정에서 드러난 잔여 작업은 `BACKLOG.md` 에 있었으나 그 파일은 삭제됐다(항목 대부분이 spec 으로 승격돼 구현·머지됐고, 근거는 코드 주석과 커밋에 남아 있다). **남은 논점은 [`harness/pipeline-review.md`](./harness/pipeline-review.md) §3 에 있다** — 파이프라인 전 구간을 사용법 기준으로 추적한 문서이고, §4 에 확정된 결정이 기록된다.

---

## 설계 변경 이력

초기 초안(3-hook 게이트/Validator)에서 다음이 바뀌었다.

| 초기 초안 | 현재 | 이유 |
|-----------|------|------|
| Hook 1 = 게이트(prompt, 차단) | command **로더**(주입) | prompt 타입은 git·index.json을 못 읽어 게이트 판단 불가. 문서는 기획자가 사전 작성 전제라 차단 불필요 |
| Hook 2 = Stop Validator(agent, 차단) | **삭제** → QA를 pre-push 비차단 단계로 | Stop 차단은 무한루프·4단계→2값 붕괴·agent Write/Bash 불확실성 유발. 사람 머지가 게이트면 차단 자체가 불필요 |
| QA = 검증·판정자 | QA = **독립 커버리지 분석가** | 개발자가 자기 테스트를 green으로 수렴(루프 회피). QA는 기능 체크리스트를 독립 도출해 테스트 커버리지만 대조, 누락은 사람이 판단 |
| 완료표시 `[x]` 자동/수동 확정 | **없음** | AI 플로우엔 확정 단계가 없다. 산출물 push → 사람 머지가 완성도 판단 |
| Telegram 원격 승인(차단 우회) | (불필요) | 차단이 없으므로 원격 승인 개념도 불필요. 필요 시 *알림*으로만 선택 도입 |
| 검증은 pre-push 한 곳 | **pre-commit 추가**(하드 게이트) + pre-push 조건부 재실행 | 실패를 커밋 앞으로 옮기면 워킹트리만 dirty 한 상태로 끝난다. rebase·머지·`--no-verify` 로 만들어진 트리가 있어 pre-push 게이트는 남긴다 |
| 테스트 러너 **단계적 도입**(Phase 1 = `tsc --noEmit` 만, Phase 2 = vitest) | **완료 — 단계 구분 자체를 없앰** | 원 저장소에 테스트 러너가 없어, 러너 도입을 기다리지 않고 하네스를 먼저 굴리려는 판단이었다. vitest 가 들어와 그 단계는 끝났는데 **서술만 남아 QA 에게 "커버리지 열을 전부 ❌ 로 적으라" 고 지시하고 있었다** — 문서 오타가 아니라 동작하는 오지시였고, 실패 방향이 나쁘다(덮여 있는데 누락으로 기록되면 사람이 틀린 신호로 판단한다). 지금은 러너 유무를 **사실 주장이 아니라 조건부 규칙**으로 쓴다 |
| Hook 3 = `index-sync`(PostToolUse, 코드↔문서 드리프트 알림) | **삭제** | `index.json` 의 `components` 매핑을 *누가·언제* 등록하는지가 프로토콜 어디에도 없어 80개 task 동안 0개였다 — 한 번도 동작한 적이 없다. 드리프트는 알림으로 따라잡는 대신 **중복 자체를 없애** 단일 출처로 모은다(게이트 대상 → `harness/config.json`). 서술형 문서의 드리프트는 사람이 PR 에서 잡는다 |
| 설계 문서(`harness-engineering.md`) + README 분리 | **README 하나로 통합** | 같은 사실을 두 문서가 각각 서술해 드리프트가 났다(§7.3의 pre-push 스케치는 실제 구현과 어긋난 채 남아 있었다). 위 '낡은 사본은 없는 것보다 나쁘다' 를 문서 자신에게도 적용한다 |

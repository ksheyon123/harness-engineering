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
| **기획자** | 서브에이전트 `.claude/agents/planner.md` (`model: sonnet`) | worktree 세션이 스폰 | Read/Grep/Glob + Write/Edit. **Bash ❌** | `spec.md` — 기능 목록 |
| **개발자** | **메인 세션** (규약은 `.claude/CLAUDE.md`) | 사용자 | 코드·테스트 전체 편집 | 코드 + 테스트(green) |
| **QA** | 서브에이전트 `.claude/agents/qa.md` (`model: haiku`) — 게이트 통과 후 세션이 스폰 / pre-push에서 headless | 자동 | Read/Grep/Glob + Write/Edit. **Bash ❌ → 테스트 실행 불가** | `qa-checklist.md` — 기능 체크리스트 + 커버리지 매트릭스 |
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

## 3. 강제력 위계 — 무엇이 실제로 막는가

장치가 늘면서 "이건 규약인가 강제인가"가 흐려지기 쉽다. 층은 넷뿐이고, **아래로 갈수록 약하다.**

```
하드 (훅이 막는다)      pre-commit ③종 · pre-push ②종 · verify-branch 의 deny ②종
반강제 (사람 승인)      verify-branch 의 ask ③종
주입 (문맥만)           load-spec
문서 (강제 없음)        .claude/CLAUDE.md · 이 README · .claude/rules/*.md
```

문서에 아무리 강하게 적어도 그것은 **컨텍스트일 뿐 강제가 아니다.** 반드시 막아야 하는 것은 훅으로 내려야 한다. 이 구분이 무너진 자리가 아래 [열린 구멍](#열린-구멍)에 기록돼 있다.

### 강제 지점 지도 — 언제 무엇이 발동하나

```
세션 타임라인
──────────────────────────────────────────────────────────────────────────────

프롬프트 제출
  └─[UserPromptSubmit]  .claude/hooks/load-spec.mjs ········ 주입 (비차단)
        읽는 것: harness/index.json → tasks[현재 브랜치] → spec.md 전문
        결과   : spec 이 컨텍스트에 깔린다 / 미등록이면 소프트 경고만
        실패시 : 무조건 exit 0 — 프롬프트를 절대 깨지 않는다

파일 편집 (Edit | Write)
  └─[PreToolUse]        .claude/hooks/verify-branch.mjs ···· deny · ask · 통과
        읽는 것: 대상 파일이 속한 워킹트리, index.json, config.harnessMetaPaths
        결과   : §8.2 판정 트리

git commit
  └─[pre-commit]        .githooks/pre-commit ··············· 하드 차단
        ① 부분 스테이징 거부   ② spec 소유권(spec-lock.mjs)
        ③ node scripts/gate.mjs   ④ 통과 트리 해시 기록

git push
  └─[pre-push]          .githooks/pre-push ················· 하드 차단
        ① 트리 마커 비교 → 같으면 게이트 생략
        ② spec 미등록이면 즉시 통과
        ③ QA 입력 해시 비교 → 같으면 QA 생략
        ④ headless QA(haiku)  ⑤ 산출물 미커밋이면 차단

세션 종료
  └─[SessionEnd]        .claude/hooks/session-cost.mjs ····· 기록 (비차단)
```

> Claude Code의 hook 이벤트에는 git 생명주기가 없다. 그래서 QA-at-push는 **git 훅**이고, 그 안에서 headless Claude를 호출한다. 이 분리 덕에 초기 설계에서 막혔던 "Stop hook 무한루프", "agent hook의 Write/Bash 가능 여부" 같은 불확실성이 **전부 사라진다** (QA는 hook의 `type: agent` 가 아니라 일반 headless 호출이라 도구 제약이 없다).

---

## 4. 구성

```
.claude/
  CLAUDE.md                 # 하네스 코어 규약 (역할·게이트·커밋/push·worktree) — 개발자 역할 정의
  rules/                    # 프로젝트별 코딩 규약 — paths: frontmatter 로 조건부 로드
    example.md.template     #   복사해서 쓰는 템플릿
    test-git.md             #   테스트에서 git 을 부를 때의 규약 (게이트 밖 이중 방어)
  agents/planner.md         # 기획자 — spec.md(기능 목록) 작성. src 편집 ❌
  agents/qa.md              # QA — 커버리지 매트릭스 작성. src 편집 ❌, 테스트 실행 ❌
  hooks/load-spec.mjs       # UserPromptSubmit — 현재 브랜치의 spec 을 컨텍스트에 주입
  hooks/verify-branch.mjs   # PreToolUse(Edit|Write) — 워킹트리 / 보호 브랜치 게이트
  hooks/spec-lock.mjs       # spec 소유권 판정 — 한 브랜치는 spec 을 한 번만 확정한다
  hooks/qa-hash.mjs         # QA 입력 해시 (재생성 무한루프 차단)
  hooks/session-cost.mjs    # SessionEnd — 세션 토큰/비용 요약
  settings.json             # 훅 등록 + 권한 경계
.githooks/
  pre-commit                # 부분 스테이징 거부 + spec 소유권 + 1층 객관 게이트 + 트리 마커
  pre-push                  # 게이트(조건부 재실행) + 2층 headless QA + 패키징 게이트
scripts/
  gate.mjs                  # 1층 객관 게이트의 유일한 실행 진입점 + 설정 파서(loadConfig)
  setup-githooks.mjs        # core.hooksPath 자동 활성화 (npm install 의 prepare 훅)
  worktree-add.mjs          # 브랜치별 worktree 생성 + 세션 자동 기동
  token-usage.mjs           # 토큰/비용 집계 (session-cost.mjs 가 재사용)
harness/
  config.json               # 설정 단일 출처 — 게이트 대상 + baseBranch·installCommand·
                            #  testFilePatterns·skipDirs·harnessMetaPaths
  index.json                # 브랜치 → spec 경로 매핑
  pipeline-review.md        # 파이프라인 전 구간 추적 + 미결 논점 (§3) + 확정 결정 (§4)
  <task>/spec.md            # 기획자 산출물 — 기능 목록
  <task>/qa-checklist.md    # QA 산출물 — 커버리지 매트릭스
.gitattributes              # eol=lf 고정 (셰뱅+CRLF 가 worktree 게이트를 깨뜨림 — 구 BACKLOG #8)
package.json                # vitest 하나만 의존. prepare → setup-githooks
```

> 기능 목록(기획자)과 기능 체크리스트(QA)는 **독립 산출물**이라 별도 파일로 분리한다. QA가 기획자 목록을 그대로 상속하지 않고 독립 도출해야, 기획자 목록의 누락까지 잡힌다.

하네스 자신의 테스트는 검사 대상 옆에 둔다: `scripts/*.test.mjs`, `.claude/hooks/*.test.mjs`.

**모든 스크립트는 같은 관례를 따른다** — 순수 함수를 `export` 하고, 직접 실행일 때만 `main()` 을 돈다. import 시 부수효과가 없으므로 git·파일시스템 없이 단위 테스트할 수 있다. 훅은 그 순수 함수를 **실제로 호출**하므로 테스트되는 것과 실행되는 것이 같다(사본이 아니다).

`hooks-registration.test.mjs` 는 훅 *등록 사실*을 지킨다 — `settings.json` 이 유효한 JSON인지(깨지면 Claude Code 가 설정 전체를 못 읽는다), 등록된 command 가 실존 파일을 가리키는지, 삭제된 `PostToolUse` 키가 되살아나지 않았는지.

---

## 5. 2층 검증 — 객관 / 주관 분리

| 층 | 무엇 | 실행 주체 | 차단? |
|----|------|-----------|:---:|
| **1층 (객관)** | 결정적 통과 여부(타입 검사·테스트) | 결정적 스크립트 (LLM 불필요) | **red면 커밋·push 중단** |
| **2층 (주관)** | 기능 체크리스트 ↔ 테스트 커버리지 대조 | QA 에이전트 (LLM) | ❌ 비차단. 매트릭스에 기록만 |

테스트는 "이거 맞나?"의 객관적 부분을 LLM에서 떼어내 **공짜이고 반복가능한 신호**로 만든다. 그 덕에 QA는 *테스트를 실행할 필요 없이*(Bash 불필요) 정적으로 읽고 커버리지만 평가한다.

세션에서:

```sh
node scripts/gate.mjs           # 전체 실행
node scripts/gate.mjs --list    # 대상만 확인 (테스트를 어디에 쓸지 판단)
```

**게이트는 `GIT_*` 를 씻고 명령을 스폰한다.** 게이트가 git 훅 안에서 돌면 자식 프로세스가 진짜 저장소를 가리키는 `GIT_DIR`·`GIT_INDEX_FILE` 을 상속한다. **`GIT_DIR` 이 있으면 `git -C` 는 무시되므로**, 임시 저장소를 겨냥한 테스트가 실제로는 이 저장소를 조작한다(가설이 아니라 실제로 브랜치를 덮어썼다 → 구 BACKLOG #9). 방어는 접두어 전체 제거이고(개별 denylist 는 fail-open), 스폰 지점 한 곳(`gate.mjs`)에 있다. 게이트 밖(직접 실행·CI)을 위한 이중 방어는 `.claude/rules/test-git.md` 에 있다.

---

## 6. 설정 단일 출처 — 무엇이 어디로 흘러가나

이 저장소가 "사본을 만들지 않는다"고 반복해 말하는 것의 실체다. **설정 파일은 둘뿐이고, 파서는 하나다**(`gate.mjs` 의 `loadConfig` — 훅들이 그것을 import 한다).

```
harness/config.json
  │
  ├─ baseBranch ─────────────┬─▶ scripts/gate.mjs         merge-base(base, HEAD) → {{BASE}}
  │                          └─▶ scripts/worktree-add.mjs 새 브랜치 분기 기준 (--from 이 이김)
  │
  ├─ installCommand ───────────▶ scripts/worktree-add.mjs --install / --launch 시 실행
  │
  ├─ testFilePatterns ───────┬─▶ .claude/hooks/qa-hash.mjs  무엇이 테스트 파일인가
  ├─ skipDirs ───────────────┘                              수집 시 건너뛸 디렉터리
  │
  ├─ harnessMetaPaths ─────────▶ .claude/hooks/verify-branch.mjs  메인 체크아웃 편집 면제
  │
  └─ gate.typecheck / .test ───▶ scripts/gate.mjs   실행 대상
                                   ↑ 세션 · pre-commit · pre-push 가 전부 이 하나를 호출한다

harness/index.json   { tasks: { "<브랜치>": "<spec 경로>" } }
  │
  ├─▶ .claude/hooks/load-spec.mjs      주입할 spec 을 고른다
  ├─▶ .claude/hooks/verify-branch.mjs  등록 여부 → ask / worktree 강제
  ├─▶ .claude/hooks/qa-hash.mjs        해시에 넣을 spec 을 고른다
  ├─▶ scripts/worktree-add.mjs         seed 2분기 (미등록=기획부터 / 등록=이어서)
  ├─▶ .githooks/pre-commit             spec 소유권 검사 대상 경로
  └─▶ .githooks/pre-push               QA 대상 spec / qa-checklist 경로
```

1층 객관 게이트가 **무엇을 어디서 도는지는 `config.json` 의 `gate` 가 유일한 출처**다. `CLAUDE.md` 에도 이 README 에도 대상 목록을 옮겨 적지 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋나고, **낡은 사본은 없는 것보다 나쁘다**(세션이 틀린 검사를 돌리고 '통과했다'고 확신한다. 실제로 일어났던 일이다 → 구 BACKLOG #1).

QA도 같은 파일을 Read해서 러너 유무를 판단한다(QA는 Bash가 없어 게이트를 실행할 수 없다). `gate.test` 항목이 없으면 러너가 없는 것이고, **그때만** 커버리지를 '테스트 러너 없음'으로 기록한다 — "테스트가 없을 것"이라고 가정하지 않는다.

### 부재·오류를 다루는 방향이 소비자마다 다르다

```
파일 없음      → DEFAULTS 로 진행       (도입 초기에 push 가 부당하게 막히지 않게)
JSON 깨짐      → gate.mjs · worktree-add.mjs 는 중단
                 qa-hash.mjs 는 경고 후 DEFAULTS  (해시 산출까지 멈추면 훅이 조용히 깨진다)
필드 타입 오타 → installCommand · harnessMetaPaths · gate.* 는 throw
                 baseBranch 만 조용히 DEFAULTS 로 물러선다      ← 결이 다르다 (열린 구멍 #1)
존재하지 않는 dir → 경고 후 건너뜀
{{BASE}} 산출 실패 → fallbackCmd, 그것도 없으면 그 항목을 건너뜀
```

"오타가 '게이트 없음' 으로 둔갑하면 안 된다"가 원칙이고, 파일 부재는 그와 다르게 다룬다.

---

## 7. 게이트 파이프라인 — pre-commit / pre-push

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

> **훅 자신의 출력이 훅을 죽이면 안 된다.** 진단 출력은 서브셸 헬퍼(`say()`)로 내보내, 파이프가 닫혀 출력이 실패해도(`git commit | head -6` 같은 소비자) 종료 코드가 그것에 좌우되지 않게 한다. 실제로 훅이 SIGPIPE 로 죽어 **막아야 할 커밋이 조용히 통과한** 적이 있다. 정보성 메시지도 같은 헬퍼를 쓴다 — 그것 때문에 훅이 죽으면 통과해야 할 push 가 막힌다(거짓 차단).

### 7.1 훅 사이에 남는 상태는 둘뿐이다

흐름보다 어려운 것이 **훅과 훅 사이에 무엇이 남아서 전달되는가**다. 딱 두 개다.

```
git commit
  └─[pre-commit]
       ① 부분 스테이징 거부 ────── 실패 ─▶ 커밋 중단 (워킹트리 보존)
       ② spec 소유권 (spec-lock) ─ 실패 ─▶ 커밋 중단 "개정은 새 브랜치에서"
       ③ node scripts/gate.mjs ─── 실패 ─▶ 커밋 중단
       ④ git write-tree
            │
            └─▶ 상태 1 ── .git/harness-gate-tree  = 통과한 트리 해시
                  · 커밋 해시가 아니라 트리 해시다 (이 시점엔 커밋이 아직 없다)
                  · 검증 대상은 히스토리가 아니라 내용 → 메시지만 고친 amend 는 유효 유지
                  · 링크드 worktree 마다 git-dir 이 달라 마커도 자동 분리된다
                  · .git/ 안이라 절대 추적되지 않는다
                  · 트리를 못 쓰면(머지 중) 마커를 지운다 → pre-push 가 다시 돌게

세션: QA 스폰 시 input_hash 를 프롬프트로 주입
  └─▶ 상태 2 ── harness/<task>/qa-checklist.md 의 frontmatter input_hash
        = sha256( spec 내용 + 저장소의 모든 테스트 파일 경로·내용 )
          '무엇이 테스트인가' 는 config.testFilePatterns 에서 온다 (단일 출처)
          경로는 구분자를 정규화해 해시에 넣는다 (Windows/POSIX 동일 결과)

git push
  └─[pre-push]
       ① HEAD^{tree} == 상태 1 ?
            같다  ─▶ 객관 게이트 생략
            다르다 ─▶ gate.mjs 재실행 (rebase · 자동 머지 · --no-verify · 다른 클론)
       ② index.json 에 spec 없음 ─▶ QA 생략, push 허용 (종료)
       ③ qa-hash.mjs <branch> == 상태 2 ?
            같다  ─▶ QA 생략, push 허용 (종료)   ← 재생성 무한루프를 끊는 지점
            다르다 ─▶ ④
       ④ headless QA: claude -p --model haiku --permission-mode acceptEdits
                              --allowedTools "Read,Grep,Glob,Edit,Write"
                              --disallowedTools "Bash"  < /dev/null
            claude CLI 없음 · 실행 실패 ─▶ push 허용 (비차단)
       ⑤ QA 산출물이 미커밋이면 ─▶ push 차단 "커밋하고 다시 push"
```

> **한계(기록)**: 게이트를 *실행하는* 경로에서 `gate.mjs` 는 워킹트리를 검사하지 `HEAD` 의 트리를 체크아웃해 검사하지 않는다. 워킹트리가 dirty 하면 push 되는 내용과 검사 대상이 다를 수 있다. 스킵 경로에는 이 문제가 없다(커밋 시점에 검증된 트리와 `HEAD` 트리가 같음을 확인한다).

### 7.2 pre-push 가 QA를 다루는 방식 — 두 함정

push가 곧 마일스톤이다. 슬래시 커맨드와 달리 *"개발자가 깜빡함"이 불가능*하고, 사람/AI 누가 push하든 git이 강제한다. 단 두 함정을 처리해야 한다.

**함정 1 — 타이밍: pre-push에서 만든 산출물은 그 push에 안 들어간다.**
pre-push는 *이미 커밋된 ref* 를 보내기 직전에 돈다. 이때 생성한 `qa-checklist.md` 는 미커밋 변경일 뿐이다.
→ **재생성 → 미커밋이면 차단 → 커밋 → 재push** 패턴(포매터 훅과 동일). 이 차단은 *"QA 산출물 미커밋"* 에 대한 **패키징 게이트**이지, 커버리지 누락에 대한 품질 게이트가 아니다. **누락/partial은 push를 막지 않는다** → "사람 머지가 유일한 품질 게이트" 유지.

**함정 2 — 비결정성: LLM은 매번 결과가 달라 재push가 영원히 수렴 안 할 수 있다.**
→ **입력 해시 스킵.** 1회차(입력 변경)엔 생성·차단 → 커밋, 2회차엔 입력 불변 → 해시 일치 → 스킵 → 통과. 루프가 끊긴다. (덤으로 WIP push마다 LLM 도는 비용도 차단.)

그래서 **세션이 커밋 전에 QA를 스폰하고 해시를 직접 주입하는 것이 정상 경로다** — 그러면 push 는 한 번에 끝난다. pre-push 의 headless QA 는 그 경로를 밟지 않았을 때의 안전망이다.

해시는 **모든 테스트 파일을 다 쓴 뒤** 저장소 루트에서 계산한다:

```sh
node .claude/hooks/qa-hash.mjs <branch>
```

`qa-hash.mjs` 는 cwd 의존이라 하위 디렉터리에서 돌리면 값이 어긋나 push 가 한 번 막힌다. 계산 뒤에 테스트/spec 을 더 건드려도 마찬가지다.

### 7.3 규칙 2 는 어떻게 강제되나 — spec-lock

한 규칙이 여러 장치에 걸쳐 있는 전형이라, 하나만 끝까지 따라가 본다.

```
규칙 2 "한 브랜치는 spec 을 정확히 한 번만 확정한다"

  선언   .claude/CLAUDE.md  "spec 개정은 새 브랜치에서 한다"          강제력 없음
  판정   .claude/hooks/spec-lock.mjs   frontmatter 의 branch: 소유자   순수 함수
  강제   .githooks/pre-commit ②                                       하드 차단
           판정 근거 = HEAD 시점의 spec (워킹트리가 아니다)
             feat/a 최초 작성   → HEAD 에 파일 없음      → 통과
             feat/a 재수정      → HEAD 소유자 = feat/a   → 차단
             feat/a-1 첫 개정   → HEAD 소유자 = feat/a   → 통과
             feat/a-1 재수정    → HEAD 소유자 = feat/a-1 → 차단
  탈출   scripts/worktree-add.mjs --from <원본> --launch --seed "spec 개정 — ..."
           └─ 차단 메시지가 이 명령을 그대로 출력한다 (막고 끝내지 않는다)
  흡수   .claude/agents/planner.md 의 리비전 모드 + worktree-add 의 seed 2분기
```

소유권 검사를 게이트보다 **앞에** 둔다 — O(1) 검사라 실패를 값싸게 알린다. 뒤에 두면 무거운 typecheck/test 가 다 돈 뒤에야 '브랜치를 잘못 골랐다'는 사실이 드러난다.

판정을 셸이 아니라 Node 로 뺀 이유: `sed -n 's/^branch:.*//p'` 는 파일 전체를 훑으므로 spec **본문**에 줄 시작이 `branch:` 인 문장이 있으면 그것을 소유자로 읽는다. `spec-lock.mjs` 는 첫 `---`~닫는 `---` 블록으로 범위를 좁히고, 그 판정을 vitest 로 고정한다.

---

## 8. 세션 훅 — 무엇이 언제 도는가

설정 위치가 둘로 나뉜다. **Claude 훅은 세션 중**, **git 훅은 커밋/push 시** 동작한다.

| 위치 | 이벤트 | 담당 |
|------|--------|------|
| `.claude/settings.json` | `UserPromptSubmit` | `load-spec.mjs` — 브랜치의 기능 목록 주입 |
| | `PreToolUse` (`Edit\|Write`) | `verify-branch.mjs` — 워킹트리 / 보호 브랜치 강제 |
| | `SessionEnd` | `session-cost.mjs` — 세션 토큰/비용 요약 |
| `.githooks/pre-commit` | 커밋 시 | 부분 스테이징 거부 + spec 소유권 + 1층 객관 게이트 + 트리 마커 |
| `.githooks/pre-push` | push 시 | 게이트(조건부) + 2층 headless QA + 패키징 게이트 |

### 8.1 `load-spec.mjs` — 기능 목록 로더 (UserPromptSubmit)

게이트(차단)가 아니라 **주입(로더)** 다. 현재 브랜치의 `spec.md` 를 읽어 개발자 컨텍스트에 깐다 → AI가 항상 설계 의도를 보고 코딩한다.

- `command` 타입이라 git·파일 접근이 되어, prompt 타입의 한계(상태 못 읽음)가 없다.
- `jq` 미설치 + Windows를 고려해 **Node 스크립트**로 구현(추가 의존성 없음).
- 문서 없는 브랜치는 **하드 차단하지 않고 소프트 경고**만 한다(전제: 기획자가 사전 작성). 강제는 사람이 책임진다.
- 어떤 실패도 `exit 0` — 훅이 프롬프트를 깨뜨리지 않는다.

### 8.2 `verify-branch.mjs` — 워킹트리·브랜치 게이트 (PreToolUse)

`Edit`/`Write` 마다 대상 파일과 세션의 git 컨텍스트를 비교해 판정한다. **순서가 곧 설계다** — 앞선 판정이 `ask` 로 조기 반환하면 뒤의 `deny` 가 샌다.

```
Edit / Write 호출
   │
   ├─ 대상이 세션과 다른 워킹트리(같은 저장소)? ── 예 ─▶ deny   "그 worktree 세션에서 하라"
   │     아니오                                          ↑ 맨 앞인 것은 의도적이다.
   │                                                       뒤로 밀면 보호 브랜치 ask 가
   │                                                       먼저 반환해 deny 가 ask 로 샌다
   ├─ 대상이 다른 저장소? ──────────────────────── 예 ─▶ ask    다중 저장소 작업일 수 있다
   │     아니오
   ├─ git 저장소 아님 / index.json 없음? ───────── 예 ─▶ 통과   하네스 미설정 → 간섭 안 함
   │     아니오
   ├─ 브랜치 ∈ {main, dev, master}? ────────────── 예 ─▶ ask    ※ 하드코딩 (열린 구멍 #2)
   │     아니오
   ├─ index.json 에 미등록 브랜치? ─────────────── 예 ─▶ ask    애드혹 수정이면 승인
   │     아니오
   ├─ 대상이 git 밖(스크래치패드 등)? ──────────── 예 ─▶ 통과   worktree 강제 대상이 아니다
   │     아니오
   ├─ 경로가 harnessMetaPaths 접두어? ──────────── 예 ─▶ 통과   저장소 루트 기준 앵커링
   │     아니오
   ├─ 링크드 worktree 가 아님(= 메인 체크아웃)? ── 예 ─▶ deny   "worktree 를 만들어 거기서"
   │     아니오
   └────────────────────────────────────────────────────▶ 통과   정상 흐름
```

- 면제 판정은 **저장소 루트 상대경로 + 디렉터리 경계 매칭**이다. 부분 문자열 매칭이던 시절엔 `apps/web/harness/foo.ts` 가 면제돼 제품 코드가 뚫렸다(구 BACKLOG #7). `harness/` 는 `harness/x` 를 면제하지만 `apps/web/harness/x` 는 면제하지 않는다.
- 링크드 worktree 판별은 git-dir 경로에 `/worktrees/` 가 있는지로 한다(메인 체크아웃엔 없다).
- **판별 실패는 전부 '간섭 안 함' 쪽으로 기운다** — 오탐 `deny` 가 작업을 막는 것이 더 나쁘다.

### 8.3 `session-cost.mjs` — 세션 종료 요약 (SessionEnd)

종료되는 **그 세션의** 트랜스크립트(+ 그 세션이 스폰한 서브에이전트 파일)만 읽어 토큰/비용을 집계하고, `~/.claude/projects/<cwd-slug>/session-costs.log` 에 한 줄 남긴다. 읽기 전용이고 항상 `exit 0`. 단가·집계 로직은 `scripts/token-usage.mjs` 를 재사용한다(단일 소스).

---

## 9. worktree 동시작업

여러 작업을 동시에 진행할 때는 `git worktree` 로 브랜치별 워킹트리를 분리하고, **worktree 1개 = 개발자 세션 1개**로 붙인다(세션 간 컨텍스트는 공유되지 않는다).

```sh
node scripts/worktree-add.mjs feat/<task> --launch
node scripts/worktree-add.mjs feat/<task>-1 --from feat/<task> --launch --seed "spec 개정 — ..."
```

| 플래그 | 뜻 |
|---|---|
| (없음) | 형제 경로에 worktree 생성 + `baseBranch` 에서 분기 |
| `--install` | 그 worktree 에서 `installCommand` 실행 |
| `--launch` | `--install` 포함 + 새 터미널 창에서 세션 자동 기동 |
| `--from <branch>` | `baseBranch` 대신 이 브랜치에서 분기 (**spec 개정용 리비전 브랜치**) |
| `--seed "<문구>"` | 새 세션에 줄 첫 프롬프트. 생략하면 브랜치명 + 등록 여부로 도출 |

- **생성 위치**: 저장소 트리 **밖 형제 디렉터리**(`../<repo>-<task>`). 저장소 내부에 두면 타입 검사·테스트 러너의 글로빙과 `.gitignore` 가 그 트리를 untracked/중첩 repo로 오인한다.
- **분기 기준**: 기본은 최신 `baseBranch`(`harness/config.json`). 로컬 `<base>` → `origin/<base>` 순으로 찾고, 둘 다 없으면 **에러로 멈춘다** — `HEAD` 로 조용히 물러서면 의도치 않은 커밋에서 분기되고, 그 사실은 머지할 때에야 드러난다.
  > 탐색 순서가 `gate.mjs` 의 merge-base 와 **반대**(저쪽은 `origin/` 우선)인 것은 의도적이다. 분기는 '사람이 방금 로컬에 만든 기준 브랜치'를 존중해야 하고, merge-base 는 '원격 기준선과의 공통 조상'이라 원격이 먼저다.
- **멱등**: 같은 브랜치의 worktree 가 그 경로에 이미 있으면 재사용(attach)한다. attach 경로에서는 `--from` 이 쓰이지 않으며, 그 사실을 알린다.
- **의존성**: 새 worktree 에는 `node_modules` 가 따라오지 않는다. `pre-push` 가 그 트리에서 게이트를 돌리므로 설치가 없으면 게이트가 실패한다. Windows 에서는 install 을 PowerShell 로 돌린다(`npm.cmd` 문제 + MSYS 하위 native postinstall 깨짐 회피).
- **자동 기동**: macOS=Terminal.app(osascript), Windows=새 PowerShell 창(`-EncodedCommand`). 미지원/실패 시 붙여넣기용 기동 명령 출력으로 폴백.
- **seed 2분기**: 그 worktree 의 `index.json` 기준 미등록이면 "기획부터", 등록이면 "이어서 구현". 신규 task 도 리비전도 아직 미등록이고, **같은 브랜치를 attach 하는 재개만** 등록으로 나온다 — 재개에 '기획부터'를 주면 규칙 2 로 막힌 spec 을 다시 쓰라고 지시하게 된다.
- **push**: 각 세션은 자기 작업 브랜치만 push한다. `main`/`dev` 로는 절대 push하지 않는다.
- **정리**: `git worktree remove <path>`. 디렉터리 삭제는 비가역이므로 자동화하지 않고 사람이 한다. spec 개정마다 새 브랜치가 생기므로(`feat/a` → `feat/a-1` → `feat/a-1-2`) 오래된 worktree 가 쌓인다.

### 두 개의 하드 금지

| 금지 | 강제 |
|---|---|
| spec 등록된 task 의 소스를 **메인 체크아웃에서** 편집 | `verify-branch` **deny** — 단일 작업이어도 예외 없다 |
| 세션이 속한 워킹트리 **밖의** 파일 편집 | `verify-branch` **deny** — 그 worktree 세션에서 해야 spec 주입·브랜치 전제가 실제와 맞는다 |

면제 경로(하네스 메타작업)는 `config.json` 의 `harnessMetaPaths` 에 있다. 등록 전 ad-hoc 수정과 하네스 자체 정비는 메인 체크아웃에서 가능하다.

**`harness/index.json` 은 모든 작업이 공유하는 단일 파일이라 병렬 편집 시 충돌한다.** 등록은 한 시점에 한 세션만, 최신 `baseBranch` 기준으로 하고 곧바로 머지한다. 코드 작업 세션은 index.json 을 건드리지 않는 것이 기본이다.

---

## 10. 문서 포맷

### 10.1 `spec.md` — 기획자의 기능 목록

기획자는 *체크하지 않는다.* 기능을 열거하고, 각 기능의 의도/방식/주의/인수기준을 기술한다.

```markdown
---
branch: feat/oauth-callback
---

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

frontmatter 의 `branch:` 가 **spec 소유자**다. `pre-commit` 이 이 값으로 규칙 2 를 강제한다(§7.3).

### 10.2 `qa-checklist.md` — QA의 기능 체크리스트 + 커버리지 매트릭스

QA가 `spec.md` 의 기능 목록으로부터 **독립적으로** 검증 항목을 도출하고, 개발자의 **테스트 코드를 읽어** 커버리지를 대조한다. *판정은 하지 않고, 누락을 사람에게 올린다.*

```markdown
---
input_hash: <spec.md + 테스트 파일들의 sha256>
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

## 11. 권한 / 경계 모델

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

**파괴적/비가역 행위(파일 삭제, force-push 등)는 어떤 agent도 직접 하지 않는다** — spec/리뷰에 명시해 사람이 수행한다. `settings.json` 의 `permissions.deny` 가 `rm -rf`·`git push --force`/`-f`·`git reset --hard`·`.env` 읽기를 막는다.

**신뢰 모델**: `config.json` 의 `cmd`·`installCommand` 는 셸을 거쳐 실행된다. 그 파일은 저장소에 커밋돼 있고, 그것을 고칠 수 있는 사람은 이미 코드를 고칠 수 있으므로 새로운 신뢰 경계를 만들지 않는다. 반면 브랜치명 같은 **사용자 입력은 항상 인자 배열로** 넘겨 셸을 거치지 않는다 — 이 구분은 유지한다.

---

## 12. 도입

```sh
npm install   # prepare 훅이 core.hooksPath 를 .githooks 로 설정한다
```

의존성은 `vitest` 하나뿐이다(하네스 자신의 테스트용). `npm install` 은 그 설치와 git 훅 활성화를 겸한다. `setup-githooks.mjs` 는 멱등이고, `.git` 이 없는 환경(tarball 설치 등)에선 조용히 건너뛴다 — 설치를 절대 막지 않는다.

도입 프로젝트가 채워야 하는 것:

**1. `harness/config.json`** — 설정 단일 출처.

```json
{
  "baseBranch": "dev",
  "installCommand": "npm install",
  "testFilePatterns": ["**/*.test.{ts,tsx}"],
  "harnessMetaPaths": ["harness/", ".claude/", ".githooks/", "README.md"],
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

| 키 | 쓰임 | 기본값 |
|---|---|---|
| `baseBranch` | 게이트의 merge-base 산출 + `worktree-add.mjs` 의 분기 기준 | `dev` |
| `installCommand` | `worktree-add.mjs` 가 새 worktree에서 돌릴 설치 명령 | `npm install` |
| `testFilePatterns` | `qa-hash.mjs` 가 해시 입력으로 잡을 테스트 파일 | `**/*.test.{ts,tsx}` |
| `skipDirs` | 해시 수집 시 건너뛸 디렉터리 | `node_modules` `.git` `.next` `dist` `.turbo` |
| `harnessMetaPaths` | `verify-branch.mjs` 의 worktree 강제 면제 경로 | `harness/` `.claude/` |
| `gate` | 1층 객관 게이트 대상 (`typecheck` → `test` 순) | 없음 |

`installCommand` 는 lockfile 로 자동 감지하지 않는다 — 추측이 틀리면 조용히 잘못된 매니저로 설치한다. pnpm/yarn/bun 이면 여기서 바꾼다.

`{{BASE}}` 는 `merge-base(baseBranch, HEAD)` 로 치환된다(브랜치 변경분만 검사). 산출할 수 없으면 `fallbackCmd` 로 물러선다. 부재·오류 처리 전반은 §6 참고.

> 이 저장소 자신의 `config.json` 은 `baseBranch: "main"`, `gate.test` 하나(`npx vitest run --passWithNoTests`)뿐이고 `{{BASE}}` 를 쓰지 않는다 — 규모가 작아 전체 스위트를 매번 돌리는 편이 단순하다.

**2. `.claude/rules/*.md`** — 프로젝트별 코딩 규약. `example.md.template` 을 복사해 쓴다.

**3. 인증 토큰** — `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` 을 셸 환경에 설정(headless QA 전제). `ANTHROPIC_API_KEY` 도 가능. `--bare` 는 OAuth를 읽지 않으므로(API key 전용) 로컬 구독 로그인 훅에선 쓰지 않는다.

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

## 13. 검증된 사항 (공식 문서 기준, 2026-06-13)

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

## 14. 포함된 spec

`harness/` 아래 spec 들은 **하네스 자신을 만든 작업의 실제 spec**이다. 형식 예시이자 설계 근거로 남겨둔다.

| task | 내용 |
|---|---|
| `worktree-workflow` | 브랜치별 worktree 분리 규약 + `worktree-add.mjs` |
| `worktree-enforce` | task 시작을 worktree 우선으로 강제 (`verify-branch.mjs`) |
| `token-usage` | 세션 토큰/비용 사후 집계 (`token-usage.mjs`, `session-cost.mjs`) |
| `gate-pipeline` | 게이트 정의·실행 단일화 + `pre-commit` 도입 (`gate.mjs`, `config.json`) |
| `worktree-config` | `worktree-add.mjs` 의 분기 기준·설치 명령을 `config.json` 에서 읽기 |
| `index-sync-removal` | 한 번도 동작한 적 없던 코드↔문서 드리프트 알림 훅 제거 |
| `gate-env-isolation` | 게이트가 스폰하는 프로세스에서 `GIT_*` 를 씻어낸다 |
| `verify-branch-guard` | 교차 워킹트리 편집 차단 + 면제 경로 루트 앵커링 (`harnessMetaPaths`) |
| `drop-phase1` | "테스트 러너가 없다" 는 낡은 전제를 조건부 규칙으로 대체 |
| `spec-in-worktree` | 기획을 worktree 로 옮기고 spec 소유권을 훅으로 강제 (`spec-lock.mjs`, `--from`) |

---

## 열린 구멍

파이프라인을 전 구간 추적하며 드러난 것들이다. 상세 논의는 [`harness/pipeline-review.md`](./harness/pipeline-review.md) §3.

| # | 구멍 | 결과 |
|:--:|------|------|
| 1 | `gate.mjs` 의 `DEFAULTS.baseBranch = "dev"` | 필드를 빼면 조용히 `dev` 로 물러선다. `installCommand`·`harnessMetaPaths` 는 오타에 throw 하는데 이것만 침묵한다 |
| 2 | `verify-branch.mjs` 의 `PROTECTED = {main, dev, master}` 하드코딩 | `config.baseBranch` 와 **이중 출처**. `baseBranch: "develop"` 인 프로젝트에서 `develop` 은 보호되지 않고, 이 저장소는 쓰지도 않는 `dev`·`master` 를 보호한다 (논점 H, 미결) |
| 3 | git 훅에 브랜치 보호 검사가 **없다** | "`main`/`dev` 에 커밋·push 금지"는 `CLAUDE.md` 문장 + `verify-branch` 의 `ask` 뿐이다. 가장 강하게 말하는 규칙이 가장 약하게 강제돼 있다 |
| 4 | `CLAUDE.md` 가 `main`/`dev` 를 리터럴로 3곳에 적는다 | 같은 파일이 `baseBranch`·`harnessMetaPaths` 에 대해선 "값 사본을 적지 마라"고 못 박고 있다 — 자기 원칙과 어긋난다 |
| 5 | QA 모델이 두 곳 (`agents/qa.md` 의 `model: haiku` / `pre-push` 의 `--model haiku`) | 한쪽만 바꾸면 두 QA 경로가 다른 모델로 돈다 (논점 H) |
| 6 | pre-push 의 게이트 **실행** 경로는 워킹트리를 검사한다 | 워킹트리가 dirty 하면 검사 대상 ≠ push 내용. 스킵 경로엔 없는 한계다 (§7.1 주석) |
| 7 | 기존 `dev`·`develop` 브랜치에서 작업하며 `baseBranch` 를 안 바꾸면 | `worktree-add` 가 **`baseBranch` 에서** 잘라 그 브랜치의 작업이 새 worktree 에 없다. `baseBranch` 가 실재하면 경고 없이 성공하므로 **조용하다** |

> 이 저장소는 Turborepo 기반 프로젝트에서 하네스 부분만 분리한 것이다. 분리 과정의 잔여 작업은 `BACKLOG.md` 에 있었으나 항목 대부분이 spec 으로 승격돼 구현·머지된 뒤 그 파일은 삭제됐다(근거는 코드 주석과 커밋에 남아 있다).

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
| 기획을 `main` 체크아웃에서 수행 | **worktree 세션이 기획부터 한다** | spec·index·코드·테스트·qa-checklist 가 같은 브랜치에 쌓여야 `main` 직접 커밋이 사라진다. spec 소유권은 `spec-lock.mjs` + `pre-commit` 이 강제하고, 개정은 `--from` 리비전 브랜치로 뺀다 |

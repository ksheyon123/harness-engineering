# Claude Code 하네스 엔지니어링 설계

역할 기반(기획자 / 개발자 / QA) 문서 주도 개발 워크플로우를, Claude Code hooks + git pre-push 훅으로 자동화하는 설계.

> 이 문서는 초기 "3-hook 게이트/Validator" 초안에서 출발해, 실제 작업 프로세스(역할군)와 결합하는 방향으로 재설계된 결과다. 변경 배경은 문서 끝 [설계 변경 이력](#설계-변경-이력) 참고.

---

## 1. 개요

핵심 철학:

- **설계 의도가 코드보다 먼저 문서로 확립된다** — 기획자가 *기능 목록*을 먼저 작성한다.
- **각 역할은 서로 다른 agent이고, 도구 경계로 역할이 강제된다** (Separation of Duties).
- **AI는 차단/판정하지 않는다.** AI는 한 브랜치에 *산출물 묶음*(기능 목록 / 코드 / 테스트 / QA 체크리스트)을 남기고 push할 뿐이다.
- **사람의 머지 결정이 유일한 권위 게이트다.** 미비한 기능이 있으면 사람이 추가 개발을 요청한다.

이 모델은 "런타임에 무엇을 막는가"가 아니라, **"브랜치마다 리뷰 가능한 산출물을 남기는가"** 에 초점을 둔다.

---

## 2. 역할 모델

| 역할 | 형태 | 트리거 | 도구 경계 | 산출물 |
|------|------|--------|-----------|--------|
| **기획자** | 서브에이전트 `.claude/agents/planner.md` | 작업 시작(수동) | Read/Grep/Glob + Write(`harness/`만). **src 편집 ❌** | `spec.md` — 기능 목록 |
| **개발자** | **메인 세션** | 사용자 | 코드·테스트 전체 편집 | 코드 + 테스트(green) |
| **QA** | 서브에이전트 `.claude/agents/qa.md` (headless 호출) | **git pre-push (자동·강제)** | Read/Grep/Glob + Write(`harness/qa` 등). **src 편집 ❌, 테스트 실행 ❌(읽기만)** | `qa-checklist.md` — 기능 체크리스트 + 커버리지 매트릭스 |
| **사람** | — | PR 리뷰 | — | **머지 결정 (유일한 품질 게이트)** |

분리가 "의미"가 되는 두 원칙:

- **기획자는 코드를 짜지 않는다** — 명세(기능 목록)만. 안 그러면 그냥 개발자다.
- **QA는 코드를 못 고친다** — 자기가 고쳐서 통과시키면 검증이 무의미. 읽기 + 비교 + 리포트만. 단 *리포트 기록*을 위해 `harness/`에는 쓸 수 있다.

> 개발자=메인 세션인 이유: 코딩은 iterative하고 사람과 왕복 대화가 필요한데, 서브에이전트는 비대화형 단발 실행기라 맞지 않는다. 기획자·QA는 fire-and-forget이라 서브에이전트가 맞는다.

---

## 3. 전체 플로우

```
사람 ──▶ 기획자: 기능 목록 작성 (harness/<task>/spec.md)
              │  (Hook1 로더가 개발자 컨텍스트에 spec 주입)
              ▼
        개발자(메인): 코드 + 자기 코드의 테스트 작성, 테스트 green
              │
              ▼ git push  ──────────────┐
        [pre-push 훅 / headless QA]      │
          1. (선택) tsc + 테스트 — red면 fail-fast    │
          2. 입력 해시 비교 — 안 바뀌었으면 스킵         │
          3. QA: 기능 체크리스트 + 커버리지 매트릭스 생성  │
          4. 미커밋 산출물 있으면 exit 1 (커밋 후 재push) │
              │  통과 ◀────────────────┘
              ▼
        브랜치 A에 push — 산출물 4종 포함
              │
              ▼
        사람: PR 리뷰 → 누락 있으면 추가개발 요청 / 충분하면 메인 머지
```

**`[x]` 확정·차단·에스컬레이션 큐는 AI 플로우에 없다.** 완성도 판단은 전적으로 사람의 머지 시점에 일어난다.

---

## 4. 산출물 & 파일 구조

```
harness/
  index.json                ← 브랜치 → spec 경로 매핑 (Hook1 로더용)
  <task>/
    spec.md                 ← 기획자: 기능 목록
    qa-checklist.md          ← QA: 기능 체크리스트 + 커버리지 매트릭스 (+ 입력 해시)
src/  ...                    ← 개발자: 코드
tests/ ...                   ← 개발자: 테스트
.claude/
  agents/planner.md          ← 기획자 에이전트 정의
  agents/qa.md               ← QA 에이전트 정의
  hooks/load-spec.mjs        ← Hook1 로더 (Node)
  settings.json              ← Claude 훅 등록
.git/hooks/pre-push          ← QA 트리거 (또는 husky/lefthook)
```

> 기능 목록(기획자)과 기능 체크리스트(QA)는 **독립 산출물**이라 별도 파일로 분리한다. QA가 기획자 목록을 그대로 상속하지 않고 독립 도출해야, 기획자 목록의 누락까지 잡힌다.

---

## 5. 문서 포맷

### 5.1 `spec.md` — 기획자의 기능 목록

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

### 5.2 `qa-checklist.md` — QA의 기능 체크리스트 + 커버리지 매트릭스

QA가 `spec.md`의 기능 목록으로부터 **독립적으로** 검증 항목을 도출하고, 개발자의 **테스트 코드를 읽어** 커버리지를 대조한다. *판정은 하지 않고, 누락을 사람에게 올린다.*

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
- ...

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| code 1회만 교환 | `callback.test > "exchange once"` | ✅ covered | — |
| StrictMode 이중마운트 1회 | (없음) | ❌ 누락 | **요검토** |
| 에러 메시지 노출 | `callback.test > "shows error"` | △ partial (메시지 내용 미검증) | 요검토 |
```

`❌ 누락` / `△ partial` 행이 **사람에게 올라가는 결정 큐**이며, PR 리뷰에서 처리된다.

---

## 6. 2층 검증 — 객관 / 주관 분리

검증이 두 층으로 갈린다. 둘 다 pre-push에서 일어난다.

| 층 | 무엇 | 실행 주체 | 차단? |
|----|------|-----------|:---:|
| **1층 (객관)** | 결정적 통과 여부 | 결정적 스크립트 (LLM 불필요) | red면 push 중단 |
| **2층 (주관)** | 기능 체크리스트 ↔ 테스트 커버리지 대조 | QA 에이전트 (headless LLM) | ❌ 비차단. 매트릭스에 기록만 |

테스트는 "이거 맞나?"의 객관적 부분을 LLM에서 떼어내 **공짜이고 반복가능한 신호**로 만든다. 그 덕에 QA는 *테스트를 실행할 필요 없이*(Bash 불필요) 정적으로 읽고 커버리지만 평가한다.

### 게이트 대상은 설정 하나에서 온다

1층 객관 게이트가 **무엇을 어디서 도는지는 `harness/config.json` 의 `gate` 가 유일한 출처**다. 실행 진입점도 하나(`node scripts/gate.mjs`)이고, 세션·`pre-commit`·`pre-push` 가 모두 그것을 호출한다. 이 문서에도, `CLAUDE.md` 에도 대상 목록을 옮겨 적지 않는다 — 사본은 강제력을 더하지 않으면서 원본과 어긋나고, **낡은 사본은 없는 것보다 나쁘다**(세션이 틀린 검사를 돌리고 '통과했다' 고 확신한다. 실제로 일어났던 일이다).

QA 도 같은 파일을 Read 해서 러너 유무를 판단한다(QA 는 `Bash` 가 없어 게이트를 실행할 수 없다). 대상에 `test` 항목이 없으면 러너가 없는 것이고, 그때만 커버리지를 '테스트 러너 없음' 으로 기록한다 — **"테스트가 없을 것" 이라고 가정하지 않는다.**

> **이력**: 이 하네스는 테스트 러너 없이 `tsc --noEmit` 만으로 시작해(Phase 1), 나중에 vitest 를 도입하는 2단계 계획이었다. **그 도입은 끝났다** — 지금은 테스트가 1층 게이트에서 실제로 돈다. 왜 그렇게 시작했는지는 [설계 변경 이력](#설계-변경-이력) 참고.

---

## 7. 메커니즘 — 어디서 무엇이 도는가

설정 위치가 둘로 나뉜다. **Claude 훅은 세션 중**, **git 훅은 push 시** 동작한다.

| 위치 | 담당 |
|------|------|
| `.claude/settings.json` | Hook1 로더(기능 목록 주입) — *세션 중* |
| `.git/hooks/pre-push` (husky/lefthook) | 1층 객관 게이트 + QA 생성(headless Claude) — *push 시* |

> Claude Code의 hook 이벤트(UserPromptSubmit/Stop/PostToolUse 등)에는 git 생명주기가 없다. 그래서 QA-at-push는 **git 훅**이고, 그 안에서 headless Claude를 호출한다. 이 분리 덕에 초기 설계에서 막혔던 "Stop hook 무한루프", "agent hook의 Write/Bash 가능 여부" 같은 불확실성이 **전부 사라진다** (QA는 hook의 `type: agent`가 아니라 일반 headless 호출이라 도구 제약이 없다).

### 7.1 Hook 1 — 기능 목록 로더 (UserPromptSubmit, command)

게이트(차단)가 아니라 **주입(로더)** 다. 현재 브랜치의 `spec.md`를 읽어 개발자 컨텍스트에 깐다. → AI가 항상 설계 의도를 보고 코딩한다.

- `command` 타입이라 git·파일 접근이 되어, prompt 타입의 한계(상태 못 읽음)가 없다.
- `jq` 미설치 + Windows를 고려해 **Node 스크립트**로 구현(추가 의존성 없음).

```js
// .claude/hooks/load-spec.mjs  (개념 스케치)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const input = JSON.parse(readFileSync(0, "utf8")); // stdin
let branch = "";
try { branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim(); } catch {}

let ctx = "";
try {
  const index = JSON.parse(readFileSync("harness/index.json", "utf8"));
  const specPath = index.tasks?.[branch];
  if (specPath) ctx = `[기능 목록] ${specPath}\n\n` + readFileSync(specPath, "utf8");
  else ctx = `[하네스] 브랜치 '${branch}'에 등록된 spec이 없습니다. (검증 생략됨)`; // 소프트 경고
} catch { /* index 없음 → 무동작 */ }

if (ctx) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx }
  }));
}
```

> 문서 없는 브랜치는 **하드 차단하지 않고 소프트 경고**만 한다(전제: 기획자가 사전 작성). 강제는 사람이 책임진다.

### 7.3 pre-push — QA 트리거 (git 훅)

push가 곧 마일스톤이다. 슬래시 커맨드와 달리 *"개발자가 깜빡함"이 불가능*하고, 사람/AI 누가 push하든 git이 강제한다. 단 **두 함정**을 반드시 처리한다.

**함정 1 — 타이밍: pre-push에서 만든 산출물은 그 push에 안 들어간다.**
pre-push는 *이미 커밋된 ref*를 보내기 직전에 돈다. 이때 생성한 `qa-checklist.md`는 미커밋 변경일 뿐이다.
→ **재생성 → 미커밋이면 차단 → 커밋 → 재push** 패턴(포매터 훅과 동일). 이 차단은 *"QA 산출물 미커밋"* 에 대한 **패키징 게이트**이지, 커버리지 누락에 대한 품질 게이트가 아니다. **누락/partial은 push를 막지 않는다** → "사람 머지가 유일한 품질 게이트" 유지.

**함정 2 — 비결정성: LLM은 매번 결과가 달라 재push가 영원히 수렴 안 할 수 있다.**
→ **입력 해시 스킵.** `(spec + 테스트)`의 해시를 `qa-checklist.md`에 기록. push 시 해시가 같으면 QA를 스킵하고 통과. 1회차(입력 변경)엔 생성·차단 → 커밋, 2회차엔 입력 불변 → 해시 일치 → 스킵 → 통과. 루프가 끊긴다. (덤으로 WIP push마다 LLM 도는 비용도 차단.)

구현은 **`.githooks/pre-push`** 에 있다(활성화: `git config core.hooksPath .githooks` — `scripts/setup-githooks.mjs` 가 자동 수행). 아래는 그 구조다. 세부는 파일을 보고, **이 문서에 명령을 옮겨 적지 않는다.**

1. **1층 객관 게이트** — `node scripts/gate.mjs` 를 호출한다(대상은 `harness/config.json`). 단 **`pre-commit` 이 이미 검증한 트리면 건너뛴다**: `pre-commit` 이 통과시킨 트리 해시를 git-dir 안 마커에 남기고, `HEAD^{tree}` 가 그것과 같으면 다시 돌지 않는다. 그럼에도 게이트를 없애지 않는 이유는 `pre-commit` 을 거치지 않고 만들어지는 트리가 있기 때문이다 — rebase·자동 머지(각각은 통과하지만 합치면 깨지는 semantic conflict 는 커밋 시점에 존재하지 않았다), `--no-verify`, 다른 클론에서 온 커밋. 마커가 없거나 다르면 **안전 기본값 = 실행**.
2. **spec 조회** — `harness/index.json` 에서 현재 브랜치의 spec 을 찾는다. 없으면 QA 를 생략하고 push 를 허용한다.
3. **입력 해시 스킵** — `node .claude/hooks/qa-hash.mjs <branch>` 의 값과 `qa-checklist.md` frontmatter 의 `input_hash` 가 같으면 QA 를 돌리지 않는다.
4. **QA 생성(headless)** — `claude -p ... --model haiku --permission-mode acceptEdits --allowedTools "Read,Grep,Glob,Edit,Write" --disallowedTools "Bash" < /dev/null`. 역할 정의는 프롬프트에서 `.claude/agents/qa.md` 를 Read 하게 한다(단일 소스). **QA 실행 실패는 push 를 막지 않는다**(비차단) — `claude` CLI 가 없을 때도 마찬가지다.
5. **패키징 게이트** — QA 산출물이 미커밋이면 중단하고 커밋 후 재push 를 안내한다. 이 차단은 *산출물 누락* 에 대한 것이지 커버리지 누락에 대한 것이 아니다.

> **훅 자신의 출력이 훅을 죽이면 안 된다.** 진단 출력은 서브셸 헬퍼(`say()`)로 내보내, 파이프가 닫혀 출력이 실패해도 종료 코드가 그것에 좌우되지 않게 한다. 정보성 메시지도 같은 헬퍼를 쓴다 — 그것 때문에 훅이 죽으면 통과해야 할 push 가 막힌다(거짓 차단).

> **한계(기록)**: 게이트를 *실행하는* 경로에서 `gate.mjs` 는 워킹트리를 검사하지 `HEAD` 의 트리를 체크아웃해 검사하지 않는다. 워킹트리가 dirty 하면 push 되는 내용과 검사 대상이 다를 수 있다. 스킵 경로에는 이 문제가 없다(커밋 시점에 검증된 트리와 `HEAD` 트리가 같음을 확인한다).

**검증된 사항(공식 문서 기준):**
- **`--agent <name>` 플래그는 없다.** 서브에이전트는 description 매칭으로 자동 위임되거나 `--agents '<json>'`로 인라인 전달한다. 훅에선 자동 위임의 비결정성을 피하려고 **직접 헤드리스 호출 + `--allowedTools`로 도구 경계 강제**가 가장 안정적이다.
- **권한**: `--permission-mode acceptEdits`(편집 무프롬프트) + `--allowedTools "Read,Grep,Glob,Edit,Write"` + `--disallowedTools "Bash"` → QA의 "코드 못 고침/테스트 실행 안 함" 경계를 강제. (`tools` 화이트리스트는 실제로 다른 도구를 차단함이 확인됨.)
- **stdin**: `< /dev/null` 없으면 Claude가 pre-push의 ref 입력을 삼켜 충돌한다 — **필수**.
- **인증**: 훅 환경에 `CLAUDE_CODE_OAUTH_TOKEN`(= `claude setup-token` 발급) 또는 `ANTHROPIC_API_KEY` 필요. `--bare`는 OAuth를 읽지 않으므로(API key 전용) 로컬 구독 로그인 훅에선 **`--bare`를 쓰지 않는다**.
- **종료코드**: 0 성공 / 비0 오류 → 셸에서 분기 가능. 출력 형식은 `--output-format`(현재 훅은 `text` 를 쓴다 — 훅이 출력을 파싱하지 않기 때문이다).

---

## 8. settings.json — Claude 훅 등록

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/load-spec.mjs", "timeout": 10 } ] }
    ]
  }
}
```

> 기존 `.claude/settings.json`에는 `permissions`만 있으므로 **`hooks` 키를 병합**한다(덮어쓰지 않는다). QA는 여기 없다 — git pre-push에서 돈다.

---

## 9. 권한 / 경계 모델

도구 경계는 **파일 단위로 하드 강제**, 문서 섹션 소유는 **프롬프트로 소프트 강제**한다.

| 역할 | src 편집 | docs 편집 | 테스트 실행 | 비고 |
|------|:---:|:---:|:---:|------|
| 기획자 | ❌ | ✅ | — | 명세만 작성 |
| 개발자 | ✅ | △ (기능 목록 섹션만) | ✅ | 명세(spec)는 사람·기획자 영역 |
| QA | ❌ | ✅ (`harness/qa`) | ❌ (읽기만) | 자기채점·자기수정 금지 |

문서 영역별 소유(소프트 규약):

| 영역 | 소유자 |
|------|--------|
| `spec.md` 기능 목록(의도/방식/주의/인수기준) | 기획자 |
| `qa-checklist.md` 기능 체크리스트 + 매트릭스 | QA |
| 커버리지 누락 판단 / 추가 개발 요청 | **사람** |

**파괴적/비가역 행위(파일 삭제 등)는 어떤 agent도 직접 하지 않는다** — `spec.md`/리뷰에 명시해 사람이 수행한다.

---

## 10. 확인 완료 / 결정사항

공식 문서로 검증 완료(2026-06-13):

| 항목 | 결론 |
|------|------|
| headless 호출 | `claude -p "<prompt>"`, 출력 `--output-format text\|json\|stream-json`, 종료코드 0/비0 |
| 서브에이전트 지정 | **`--agent <name>` 플래그 없음.** 자동 위임 또는 `--agents '<json>'` 인라인. 훅은 직접 호출 + `--allowedTools`로 경계 강제 |
| 서브에이전트 정의 | `.claude/agents/*.md` frontmatter: `name`/`description`/`prompt`/`tools`/`model`/`permissionMode`. **`tools` 화이트리스트는 미포함 도구를 실제로 차단** |
| 비대화형 권한 | `--permission-mode acceptEdits` + `--allowedTools "..."`(+`--disallowedTools`) → 무프롬프트 |
| stdin 충돌 | pre-push가 ref를 stdin으로 넘김 → **`< /dev/null` 필수** |
| 인증 | `CLAUDE_CODE_OAUTH_TOKEN`(`claude setup-token`) 또는 `ANTHROPIC_API_KEY`. `--bare`는 OAuth 미사용 |

- **테스트 러너** — **결정: 도입 완료.** vitest 가 1층 게이트에서 실제로 돈다. 무엇을 어디서 도는지는 `harness/config.json` 의 `gate` 가 정하고, 실행은 `node scripts/gate.mjs` 하나다. [§6](#게이트-대상은-설정-하나에서-온다) 참고.

여전히 **이 저장소 고유**로 확인할 것:

- Windows git 훅이 git-bash(sh)로 실행되는지(현재 `/usr/bin/bash` 존재 확인됨) + 개발자 셸에 인증 토큰 노출.

---

## 11. 적용 순서

1. `harness/index.json` 초기화 (`{ "tasks": {} }`)
2. `.claude/agents/planner.md`, `.claude/agents/qa.md` 작성 (도구 경계 포함)
3. `.claude/hooks/load-spec.mjs` 작성 + `settings.json`에 hooks 병합
4. `harness/config.json` 작성 — 게이트 대상(`gate`)·`baseBranch`·`installCommand` 등. **이후 모든 검사 대상은 이 파일 하나에서 온다**
5. 첫 태스크: 기획자로 `harness/<task>/spec.md` 작성 + `index.json`의 `tasks`에 브랜치 등록 → `node scripts/worktree-add.mjs <branch> --launch` 로 worktree + 세션
6. 개발자(메인)로 **test-first** 구현: 실패 테스트(RED) → 구현 → 통과(GREEN). `node scripts/gate.mjs` green
7. **인증 토큰 발급**: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`을 개발자 셸 환경에 설정 (헤드리스 훅 전제)
8. `.githooks/pre-commit`·`.githooks/pre-push` 작성 + `git config core.hooksPath .githooks`(`scripts/setup-githooks.mjs` 가 자동 수행) — pre-commit 은 객관 게이트를 하드로 막고 통과한 트리 해시를 남긴다. pre-push 는 그 마커로 게이트를 조건부 스킵하고 headless QA(`< /dev/null`, `--permission-mode acceptEdits`, `--allowedTools`) + 해시 스킵 + 산출물 미커밋 차단을 한다
9. push → QA 산출물 생성/커밋/재push 흐름 확인
10. PR로 사람 리뷰·머지

> 점진 적용 권장: 먼저 1~6(로더 + 설정 + 문서 + 개발 흐름)으로 가치 확인 후, 7~9(git 훅 + QA)를 붙인다.

---

## 설계 변경 이력

초기 초안(3-hook 게이트/Validator)에서 다음이 바뀌었다.

| 초기 초안 | 현재 | 이유 |
|-----------|------|------|
| Hook 1 = 게이트(prompt, 차단) | command **로더**(주입) | prompt 타입은 git·index.json을 못 읽어 게이트 판단 불가. 문서는 기획자가 사전 작성 전제라 차단 불필요 |
| Hook 2 = Stop Validator(agent, 차단) | **삭제** → QA를 pre-push 비차단 단계로 | Stop 차단은 무한루프·4단계→2값 붕괴·agent Write/Bash 불확실성 유발. 사람 머지가 게이트면 차단 자체가 불필요 |
| QA = 검증·판정자 | QA = **독립 커버리지 분석가** | 개발자가 자기 테스트를 green으로 수렴(루프 회피). QA는 기능 체크리스트를 독립 도출해 테스트 커버리지만 대조, 누락은 사람이 판단 |
| 완료표시 `[x]` 자동/수동 확정 | **없음** | AI 플로우엔 확정 단계가 없다. 산출물 push → 사람 머지가 완성도 판단 |
| Telegram 원격 승인(차단 우회) | (불필요) | 차단이 없으므로 원격 승인 개념도 불필요. 필요 시 *알림*(push/누락 통지)으로만 선택 도입 |
| 테스트 러너 **단계적 도입**(Phase 1 = `tsc --noEmit` 만, Phase 2 = vitest) | **완료 — 단계 구분 자체를 없앰** | 원 저장소에 테스트 러너가 없어, 러너 도입을 기다리지 않고 하네스를 먼저 굴리려는 판단이었다(Phase 1 에서도 QA 의 독립 기능 체크리스트와 타입 검사는 신호를 준다). vitest 가 들어와 그 단계는 끝났는데 **서술만 남아 QA 에게 "커버리지 열을 전부 ❌ 로 적으라" 고 지시하고 있었다** — 문서 오타가 아니라 동작하는 오지시였고, 실패 방향이 나쁘다(덮여 있는데 누락으로 기록되면 사람이 틀린 신호로 판단한다). 지금은 러너 유무를 **사실 주장이 아니라 조건부 규칙**으로 쓴다: `harness/config.json` 의 `gate.test` 를 보고 판단한다 |
| Hook 3 = `index-sync`(PostToolUse, 코드↔문서 드리프트 알림) | **삭제** | `index.json` 의 `components` 매핑을 *누가·언제* 등록하는지가 프로토콜 어디에도 없어 80개 task 동안 0개였다 — 한 번도 동작한 적이 없다. 드리프트는 알림으로 따라잡는 대신 **중복 자체를 없애** 단일 출처로 모은다(게이트 대상 → `harness/config.json`). 서술형 설계 문서의 드리프트는 사람이 PR 에서 잡는다. 복원이 필요하면 제거 커밋에서 되살릴 수 있다 |

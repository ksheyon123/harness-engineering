# token-usage

## 목적
하네스(기획자 / 개발자 메인 세션 / QA 서브에이전트 + worktree 병렬)가 **작업(task) 하나를 처리하는 데 토큰을 얼마나 쓰는지**를 사후 측정해, 하네스 설계의 비용을 평가한다. 앱(`apps/`·`packages/`)에는 LLM 호출이 없으므로 측정 대상은 **Claude Code 세션 자체의 토큰 소모**다. 원천 데이터는 로컬 트랜스크립트(`~/.claude/projects/<repo-slug>/**/*.jsonl`)에 이미 쌓여 있고, 각 어시스턴트 메시지의 `message.usage`에 4종 토큰(input / output / cache_creation / cache_read)이 기록돼 있다.

> **비고**: 이건 하네스 메타 도구(`scripts/`)다. `worktree-add.mjs`·`qa-hash.mjs`와 같은 결의 1회성·읽기전용 node 스크립트로 둔다(트랜스크립트를 읽기만 하고 아무것도 쓰지 않는다). 테스트 러너가 없는 루트 스크립트이므로 자동화 테스트는 러너 도입 전까지 보류하고, 순수 함수 export + `node --check`로 검증 가능하게 한다.

## 범위 밖 (명시)
- 실시간 모니터링(OTel/Grafana). 이 spec은 **사후 집계**만 다룬다.
- 앱 런타임의 LLM 호출 계측(현재 앱에 LLM 없음).
- 트랜스크립트 원본 변경·삭제(읽기 전용).

## 기능 목록

### 기능: 트랜스크립트 파싱 (순수 함수)
- **의도**: JSONL 한 줄에서 과금 대상 어시스턴트 usage와 귀속 축(축=task/역할/모델/세션)을 뽑아낸다.
- **방식**: `parseUsageLine(line, filePath)` 순수 함수를 export한다. `type==="assistant"`이고 `message.usage`가 있는 줄만 대상. 추출: `sessionId`, `gitBranch`(=task 축), `model`, 토큰 4종(`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`, 없으면 0), 그리고 dedup 키(`message.id`). **역할(role)**: 파일 경로에 `/subagents/`가 포함되거나 `isSidechain===true`면 `subagent`, 아니면 `main`. 파싱 불가/비대상 줄은 `null`.
- **주의**:
  - **중복 카운팅 방지**: 같은 `message.id`는 한 번만 센다(스트리밍 partial/final이 같은 줄로 여러 번 기록될 수 있음). `message.id`가 없으면 그 줄은 건너뛴다(과금 대상 아님).
  - `<synthetic>` 모델·usage 없는 줄은 비과금으로 제외한다.
- **인수기준**:
  - usage가 있는 assistant 줄을 주면 4종 토큰과 `gitBranch`/`model`/`role`/`message.id`가 담긴 레코드를 반환한다.
  - `/subagents/`가 포함된 경로의 줄은 `role==="subagent"`로 분류된다.
  - `type!=="assistant"`이거나 usage가 없으면 `null`을 반환한다.

### 기능: 비용 계산 (순수 함수 + 단가표)
- **의도**: 4종 토큰을 그냥 더하지 않고 모델별 단가로 가중해 달러 비용을 낸다(캐시 read는 저렴, cache_creation은 write 프리미엄).
- **방식**: 모델별 per-MTok 단가표 `PRICING`을 상수로 두고(입력/출력/cacheWrite/cacheRead), `priceFor(model)`이 접두 매칭으로 단가를 찾고(예: `claude-haiku-4-5-20251001` → `claude-haiku-4-5`), `costOf(tokens, price)`가 `Σ (tokens_i/1e6 × rate_i)`를 반환한다. 단가는 claude-api 기준: opus-4.8 $5/$25, sonnet-5 $3/$15, haiku-4.5 $1/$5; cacheWrite=input×1.25(5분 TTL), cacheRead=input×0.1.
- **주의**:
  - cache_creation은 **5분 TTL 기준(×1.25)** 으로 계산한다(1시간 TTL 구분은 하지 않음 — 근사). 이 가정을 코드 주석과 리포트 각주에 남긴다.
  - 단가표에 없는 모델(예: `<synthetic>`)은 비용 0으로 처리하되 토큰 집계에서는 라벨링해 드러낸다.
  - 단가는 바뀔 수 있으므로 한곳(`PRICING`)에서만 관리하고 쉽게 갱신 가능하게 한다.
- **인수기준**:
  - opus-4.8에서 input 1,000,000 tokens면 비용에 정확히 $5.00가 더해진다.
  - cache_read 1,000,000 tokens는 opus-4.8에서 $0.50(input×0.1)이 더해진다.
  - 접두 매칭으로 날짜 접미사가 붙은 모델 id도 올바른 단가를 찾는다.

### 기능: 집계 + 리포트 CLI (`scripts/token-usage.mjs`)
- **의도**: 위 순수 함수로 프로젝트의 모든 트랜스크립트를 훑어 축별 토큰/비용 리포트를 출력한다.
- **방식**:
  - 대상 디렉터리를 저장소 루트에서 도출한다: `~/.claude/projects/<repo-slug>` (slug = 루트 절대경로의 `/`를 `-`로 치환). `--dir <path>`로 재정의 가능. **(리비전: 기본값은 메인 slug 하나가 아니라 메인 + 모든 worktree sibling slug 합산 — 아래 '크로스-worktree 집계' 참고. `--main-only`로 단일 slug.)**
  - 그 디렉터리를 **재귀**로 훑어 모든 `*.jsonl`을 읽는다(서브에이전트 파일 `<session>/subagents/*.jsonl` 포함). 각 줄을 `parseUsageLine`으로 파싱, `message.id`로 dedup.
  - `--by <task|role|model|session>` (기본 `task`)로 그룹 축을 고른다. `task` 기본 리포트는 각 task 행 아래에 **역할(main/subagent) 서브행**을 들여써서 개발자 세션 vs 서브에이전트 비중을 보여준다.
  - 각 행: input / output / cache_creation / cache_read 토큰 합과 가중 비용($). 마지막에 TOTAL 행.
  - `--json`이면 표 대신 JSON을 출력한다. `--since`/`--until`(YYYY-MM-DD)로 타임스탬프 필터(선택).
  - `.git`이 없거나 대상 디렉터리가 없으면 명확한 메시지와 함께 조용히 종료(치명적 아님).
- **주의**:
  - 순수 함수(parse/price/cost/aggregate)는 import 시 부수효과가 없어야 하고(테스트 가능), 직접 실행일 때만 `main`이 돈다.
  - 대량 파일이라 줄 단위 스트리밍으로 읽어 메모리 폭증을 피한다.
- **인수기준**:
  - 인자 없이 실행하면 task별 리포트 + 역할 서브행 + TOTAL을 출력한다(대상 디렉터리 범위는 '크로스-worktree 집계' 리비전을 따른다 — 메인 + worktree slug 합산).
  - `--by model`이면 모델별로 집계하고, 각 모델의 토큰·비용과 총합이 맞는다(축을 바꿔도 TOTAL은 동일).
  - `node --check scripts/token-usage.mjs`가 통과한다(구문 유효).
  - 같은 `message.id`가 여러 줄에 있어도 한 번만 집계된다(dedup).

### 기능(리비전 2026-07-10): 크로스-worktree 집계 (CLI 기본 동작 변경)
- **배경(문제)**: 하네스는 worktree 병렬로 돈다. 각 worktree 세션은 cwd(=worktree 경로) 기준 slug 디렉터리 `~/.claude/projects/<repo-slug>-<task>/`에 트랜스크립트/로그를 남긴다. 그런데 기존 CLI 기본값은 메인 slug(`<repo-slug>`) **한 디렉터리만** 훑어 **worktree 세션 비용을 통째로 누락**한다 → 프로젝트 전체 비용이 실제보다 작게 나온다(관측 예: 메인 $82만 잡히고 worktree 합 $31 누락).
- **의도**: 인자 없이 실행하면 이 저장소의 **모든** 세션(메인 체크아웃 + 모든 worktree)을 합산해 정확한 프로젝트 총액을 낸다. 메인/worktree 어디서 돌리든 동일 결과.
- **방식**:
  - **메인(주 워크트리) 루트**를 git으로 도출한다: `git rev-parse --path-format=absolute --git-common-dir`의 `dirname`. 링크드 worktree에서 실행해도 공용 `.git`의 부모(=메인 루트)를 얻는다. 실패(구버전 git 등) 시 `--show-toplevel`로 폴백(그 경우 단일 slug = 기존 동작).
  - 메인 루트로 canonical `<repo-slug>`를 만들고, `~/.claude/projects/` 아래에서 이름이 **`<repo-slug>` 정확 일치이거나 `<repo-slug>-`로 시작**하는 디렉터리를 모두 후보로 모아 각각 재귀로 훑는다. dedup(`message.id`)은 전 디렉터리에 걸쳐 공유한다.
  - 순수 함수 `candidateSlugDirs(entryNames, mainSlug)`로 필터 규칙을 분리한다(부수효과 없음 → 어서션/테스트 가능).
  - **플래그**: `--main-only` = 메인 slug 한 곳만(기존 동작 보존). `--dir <path>` = 그 경로만(명시 오버라이드, 크로스-worktree 병합 안 함, 최우선).
- **주의**:
  - prefix 매칭상 `<repo>-<task>` worktree slug는 정확히 잡힌다. 우연히 이름이 `<repo>-…`로 시작하는 **다른** 저장소를 별도 세션으로 열었다면 함께 잡힐 수 있으나, worktree 규약(`<repo>-<task>` 형제 디렉터리)상 사실상 이 저장소의 세션이다(허용 오차, 필요 시 `--main-only`).
  - 세션 로그(`session-cost.mjs`)의 **기록 위치는 바꾸지 않는다** — 각 세션은 계속 자기 cwd-slug 디렉터리에 남기고, 이 리비전은 **읽기 측에서** 합산해 문제를 푼다(기록 규약 불변, 비침습).
- **인수기준**:
  - 인자 없이 실행하면 메인 slug + 모든 `<repo-slug>-*` worktree slug의 트랜스크립트가 TOTAL에 합산된다(worktree 세션 비용 포함).
  - worktree 디렉터리에서 실행해도 메인 루트를 도출해 동일한 전체 집계를 낸다(메인/worktree 실행 결과 동일).
  - `--main-only`는 메인 slug 한 곳만 집계한다(리비전 이전 동작).
  - `--dir <path>`는 그 경로만 집계한다(worktree 병합 없음).
  - `candidateSlugDirs`는 `<mainSlug>`와 `<mainSlug>-*`만 반환하고 무관한 디렉터리는 제외한다.
  - 전 디렉터리에 걸쳐 같은 `message.id`는 한 번만 집계된다(dedup 유지).

### 기능(리비전 2026-07-10): `session-cost.mjs` 로그 위치 주석 정정
- **문제**: 주석/헤더가 로그 경로를 `<projectDir>/session-costs.log`라 표기하나, 실제는 `dirname(transcript)` = `~/.claude/projects/<cwd-slug>/session-costs.log`다(저장소 dir 아님). 오해 소지.
- **방식**: 동작은 그대로 두고 주석 문구만 실제 위치로 정정한다(문서성 수정, 코드 로직 불변).
- **인수기준**: `session-cost.mjs` 주석이 실제 기록 위치(`~/.claude/projects/<slug>/session-costs.log`)를 정확히 서술한다. `node --check` 통과.

### 기능: 세션 종료 요약 훅 (`.claude/hooks/session-cost.mjs`, SessionEnd)
- **의도**: 세션이 끝날 때 **그 세션의 토큰/비용 요약**을 자동으로 남겨, 매번 `token-usage.mjs`를 수동 실행하지 않아도 세션 단위 비용을 확인하게 한다.
- **방식**: Claude Code `SessionEnd` 훅으로 `node .claude/hooks/session-cost.mjs`를 건다. 훅은 stdin JSON에서 `transcript_path`(없으면 `session_id`+`cwd`로 유도)를 받아 **그 세션의 트랜스크립트 + `<session>/subagents/*.jsonl` 만** 읽는다(전체 프로젝트 아님 → 가볍다). `token-usage.mjs`의 `parseUsageLine`/`aggregate`/`humanTokens`를 import해 단가·집계 로직을 재사용한다(단일 소스). `message.id` dedup.
- **주의**:
  - **읽기 전용 + 항상 exit 0** — 어떤 실패도 세션 종료를 막지 않는다(load-spec와 동일 방어).
  - **출력 이중화**: SessionEnd는 종료 중이라 stdout/systemMessage가 화면에 안 보일 수 있다 → 요약을 `<projectDir>/session-costs.log`에 **한 줄 append(보증)** 하고, `{"systemMessage": …}`도 emit(가능한 서피스에서 표시).
  - `token-usage.mjs`의 `main`은 직접 실행 가드가 있어 import 시 부수효과 없음.
- **인수기준**:
  - 합성 SessionEnd 페이로드(실제 `transcript_path` 포함)를 stdin으로 주면, 그 세션의 in/out/cache 토큰·비용과 main/subagent 분리 요약을 산출해 `systemMessage`로 출력하고 로그에 기록한다.
  - `transcript_path`가 없거나 usage 레코드가 0이면 조용히 exit 0(아무것도 안 함).
  - `.claude/settings.json`의 `SessionEnd`에 훅이 등록돼 있고 `node --check .claude/hooks/session-cost.mjs`가 통과한다.

## 사람 확인 필요
- 단가 정확도: 인트로 프로모션가(예: sonnet-5 $2/$10)나 1시간 캐시 TTL을 반영할지는 사람이 정한다. 기본값은 표준가 + 5분 TTL.
- SessionEnd stdout 가시성: 화면 표시가 서피스마다 다를 수 있어 로그 파일을 1차 산출물로 둔다(systemMessage는 보조).

## 테스트 메모
- 루트 스크립트라 테스트 러너가 없다 → 자동화 테스트는 러너 도입 전까지 보류. 검증은 순수 함수 export, `node --check`, 실제 트랜스크립트에 대한 리포트 실행 결과로 한다.

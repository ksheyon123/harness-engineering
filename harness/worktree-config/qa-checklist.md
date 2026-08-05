---
input_hash: 284f15150c74f0a124e851b57c4a854b1913bad8d79c65b0da3b2f12ec524a39
generated: 2026-08-05
spec: harness/worktree-config/spec.md
---

# QA 기능 체크리스트 — worktree-config

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- `loadConfig` 함수가 `installCommand` 필드를 지원하고 기본값 처리 및 타입 검증을 수행한다
- `resolveBaseRef` 순수 함수가 로컬/원격 ref를 탐색하고, 둘 다 없을 시 명확한 에러를 발생시킨다
- `worktreeAddArgs` 순수 함수가 새 브랜치(with `-b`) 및 기존 브랜치(without `-b`) 경우를 구분하여 인자를 조합한다
- `installCommandFor` 순수 함수가 플랫폼별 쉘 명령으로 설치 안내를 생성하고, 경로 및 명령의 따옴표를 정확히 처리한다
- `worktree-add.mjs`의 기존 순수 함수들(`taskFromBranch`, `worktreePathFor`, `assertOutsideRepo`, `parseWorktreeList`, `parseArgs`, `seedPromptFor`, 셸 인용 함수들)이 동작을 유지한다
- `worktree-add.mjs`의 `main()` 함수가 `harness/config.json`에서 `baseBranch`를 읽어 분기 기준으로 사용한다
- `worktree-add.mjs`의 `main()` 함수가 `harness/config.json`에서 `installCommand`를 읽어 설치 명령으로 사용한다
- `.claude/CLAUDE.md`의 worktree 관련 서술이 `dev` 하드코딩을 제거하고 `harness/config.json` 설정 포인터로 변경한다
- `README.md`의 설치/브랜치 관련 서술이 설정에서 읽도록 안내하고 하드코딩을 제거한다

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| `loadConfig`가 `installCommand` 필드를 지원 | `scripts/gate.test.mjs` > "installCommand가 없으면 기본값 'npm install' 이다", "명시된 installCommand를 그대로 돌려준다", "installCommand가 문자열이 아니거나 빈 문자열이면 throw 한다" | ✅ covered | — |
| `resolveBaseRef`가 ref를 탐색하고 에러 처리 | `scripts/worktree-add.test.mjs` > "로컬 ref 가 있으면 그 이름을 쓴다", "로컬이 없고 origin 만 있으면 origin/<base> 를 쓴다", "둘 다 없으면 throw 하고, 메시지가 기준 브랜치와 설정 파일을 가리킨다" | ✅ covered | — |
| `worktreeAddArgs`가 git 인자를 조합 | `scripts/worktree-add.test.mjs` > "브랜치가 없으면 -b 와 기준 ref 로 새로 분기한다", "브랜치가 이미 있으면 -b 도 기준 ref 도 넣지 않는다" | ✅ covered | — |
| `installCommandFor`가 안내 문구를 생성 | `scripts/worktree-add.test.mjs` > "설정 명령을 안내 문구에 넣는다", "npm 하드코딩이 남아 있지 않다", "기본값을 넘기면 기존 동작(npm install)과 같다", "경로의 따옴표를 플랫폼 규칙대로 이스케이프한다" | ✅ covered | — |
| 기존 순수 함수들의 동작 유지 | `scripts/worktree-add.test.mjs` > taskFromBranch (라인 96–115), worktreePathFor (라인 117–130), assertOutsideRepo (라인 132–144), parseWorktreeList (라인 146–179), parseArgs (라인 181–199), seedPromptFor (라인 201–208), 셸 인용 함수들 (라인 210–230) | ✅ covered | — |
| `main()` 함수가 `config.json`에서 `baseBranch`를 읽는다 | (없음 — 부수효과가 있어 순수 함수 테스트 외 포함 안 함) | ❌ 누락 | 실제 git 명령 실행 및 worktree 생성은 수동 테스트/개발자 검증 대상 |
| `main()` 함수가 `config.json`에서 `installCommand`를 읽는다 | (없음 — 부수효과가 있어 순수 함수 테스트 외 포함 안 함) | ❌ 누락 | 실제 npm/pnpm 등 설치 명령 실행은 수동 테스트/개발자 검증 대상 |
| `.claude/CLAUDE.md`에서 `dev` 하드코딩이 제거됨 | (문서; 자동화된 테스트 불가) | ✅ 코드 리뷰 완료 | 라인 35, 59–62 설정 포인터 확인; 분기 기준 값으로 `dev` 리터럴 미검출 |
| `README.md`에서 설정 포인터 명시됨 | (문서; 자동화된 테스트 불가) | ✅ 코드 리뷰 완료 | 라인 72, 85 설정 포인터 확인; `installCommand` 및 `baseBranch` 설명이 `harness/config.json` 참조 |

## 부가 관찰

### 부수효과 있는 부분의 테스트 전략 (의도적 설계)
Spec 주석(라인 84)에 명시: "부수효과가 있는 함수는 순수 함수를 주입받는 형태(`resolveBaseRef(base, { refExists })`)로 갈라 둔다 — `gate.mjs` 의 `planGate(config, { dirExists })` 와 같은 관례다."

- `main()` 함수와 실제 git/npm 호출 부분은 순수 함수 테스트 외 포함되지 않음
- 이는 테스트 누락이 아니라, 하네스의 일관된 철학(부수효과 테스트는 수동·통합 테스트 영역)
- Spec의 "사람 확인 필요" 섹션(라인 119–122)에서도 최초 worktree 수동 생성을 인정

### 기존 함수 특성 테스트 커버리지
`worktree-add.test.mjs`의 특성 테스트(characterization test)는 다음 함수들의 현재 동작을 고정한다:
- `taskFromBranch`: 형식 검증, 마지막 세그먼트 추출
- `worktreePathFor`: 형제 디렉터리 경로 생성 (플랫폼 독립)
- `assertOutsideRepo`: 저장소 외부 경로 검증
- `parseWorktreeList`: git porcelain 출력 파싱 (CRLF 안정성 포함)
- `parseArgs`: 플래그 파싱 (--seed 값 토큰 오인 방지)
- `seedPromptFor`: seed 프롬프트 생성
- 셸 인용 함수들: POSIX·PowerShell·AppleScript 플랫폼별 이스케이핑

### 문서 일관성
- `.claude/CLAUDE.md` 라인 35, 59–62, 73: 분기 기준을 `harness/config.json`의 `baseBranch`로 명시
- `.claude/CLAUDE.md` 라인 60: 설치 명령을 `harness/config.json`의 `installCommand`로 명시
- `README.md` 라인 72, 85: 동일한 설정 포인터 포함

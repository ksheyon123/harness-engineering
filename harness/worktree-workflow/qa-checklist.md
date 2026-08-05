---
input_hash: 4f333952590f1368718a3aaf2517b4e4638d2b0681053903dcc84635b3987355
generated: 2026-06-30
spec: harness/worktree-workflow/spec.md
---

# QA 기능 체크리스트 — worktree-workflow

## 기능 체크리스트 (기획 의도로부터 독립 도출)

- CLAUDE.md에 worktree 동시작업 규약의 다섯 가지 세부항목이 각각 명확한 문장으로 문서화되어 있는가?
  - (1) 생성 위치: 저장소 밖 형제 디렉터리(`../<repo>-<task>`)
  - (2) 분기 기준: 최신 `dev` 에서 분기
  - (3) node_modules 정책: worktree별 `npm install` 필요
  - (4) index.json 편집 규약: 한 시점에 한 세션만
  - (5) 정리 방법: `git worktree remove <path>`
- CLAUDE.md에 "저장소 내부에 worktree를 두지 않는다"는 금지 문장이 존재하는가?
- `scripts/worktree-add.mjs`의 순수 함수 export (`taskFromBranch`, `worktreePathFor`, `assertOutsideRepo`)가 정상 작동하는가?
  - `taskFromBranch`: 브랜치명 → 마지막 세그먼트(task) 추출, 유효성 검사
  - `worktreePathFor`: repo root + branch → 저장소 부모 아래의 형제 경로(`<parent>/<reponame>-<task>`)
  - `assertOutsideRepo`: 산출 경로가 저장소 내부면 에러 발생
- `scripts/worktree-add.mjs`를 인자 없이 실행했을 때 사용법(usage)을 출력하고 exit 1로 종료하는가?
- `scripts/worktree-add.mjs`가 `git worktree add -b <branch> <path> dev`를 호출하여 dev 분기를 수행하는가?
- `scripts/worktree-add.mjs`의 `--install` 플래그가 npm install 단계를 선택적으로 실행하고, 실패 시에도 worktree는 유지되는가?
- `scripts/worktree-add.mjs`가 .git 환경 부재 시 조용히 종료(exit 0)하는가?
- `scripts/worktree-add.mjs`의 구문이 유효하여 `node --check scripts/worktree-add.mjs`가 통과하는가?
- `.gitignore`에 `.claude/worktrees/` 항목이 추가되어 worktree 배치 정책(저장소 밖 원칙)을 설정 수준에서 강제하는가?
- CLAUDE.md의 worktree 규약과 `.gitignore` 정책이 일치하는가?
- CLAUDE.md에 harness/index.json 동시 편집 규약(단일 세션, dev 기준, 즉시 머지)이 명문화되어 있는가?

## 커버리지 매트릭스

| QA 기능 항목 | 개발자 테스트 | 커버리지 | 사람 판단 |
|-------------|--------------|:---:|----------|
| CLAUDE.md 규약: 생성 위치(형제 디렉터리) | (없음) | ❌ 누락(테스트 없음) | 정적 확인: `grep` 등으로 문서 키워드 검증 필요 |
| CLAUDE.md 규약: 분기 기준(dev) | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 문서 존재 확인 필요 |
| CLAUDE.md 규약: node_modules 정책 | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 문서 존재 확인 필요 |
| CLAUDE.md 규약: index.json 편집 규약 | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 문서 존재 확인 필요 |
| CLAUDE.md 규약: 정리 명령(git worktree remove) | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 문서 존재 확인 필요 |
| CLAUDE.md에 저장소 내부 금지 문장 | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 문서 존재 확인 필요 |
| `taskFromBranch` 순수 함수 기능 | (없음) | ❌ 누락(테스트 없음) | 코드 리뷰: 함수 로직 검증 필요 |
| `worktreePathFor` 순수 함수 기능 | (없음) | ❌ 누락(테스트 없음) | 코드 리뷰: 형제 경로 산출 로직 검증 필요 |
| `assertOutsideRepo` 순수 함수 기능 | (없음) | ❌ 누락(테스트 없음) | 코드 리뷰: 경로 검증 로직 검증 필요 |
| 인자 없을 때 usage 출력 및 exit 1 | (없음) | ❌ 누락(테스트 없음) | 수동 테스트: `node scripts/worktree-add.mjs`로 확인 필요 |
| git worktree add 호출 (dev 분기) | (없음) | ❌ 누락(테스트 없음) | 수동 테스트: 실제 worktree 생성으로 확인 필요 |
| `--install` 플래그 기능 | (없음) | ❌ 누락(테스트 없음) | 수동 테스트: `--install` 옵션으로 실행 후 확인 필요 |
| .git 부재 시 조용한 종료 | (없음) | ❌ 누락(테스트 없음) | 코드 리뷰: try-catch 로직 검증 필요 |
| `node --check` 구문 유효성 | (없음) | ❌ 누락(테스트 없음) | 수동 테스트: `node --check scripts/worktree-add.mjs` 실행 필요 |
| `.gitignore`에 `.claude/worktrees/` 항목 | (없음) | ❌ 누락(테스트 없음) | 정적 확인: 파일 내용 검증 필요 |
| CLAUDE.md와 `.gitignore` 정책 일치 | (없음) | ❌ 누락(테스트 없음) | 정책 검증: 두 문서의 일관성 확인 필요 |
| harness/index.json 동시 편집 규약 | (없음) | ❌ 누락(테스트 없음) | 정적 확인: CLAUDE.md 문서 존재 확인 필요 |

## 주석

**테스트 부재 사유**: 이 spec의 구현 대상이 루트 스크립트(`scripts/worktree-add.mjs`), 문서(`.claude/CLAUDE.md`), 설정(`.gitignore`)이므로, 테스트 러너가 있는 패키지(`packages/ui` = vitest)에만 자동화 테스트를 작성할 수 있다. worktree-add.mjs의 순수 함수는 추후 테스트 가능하도록 export되어 있으나, **현재 루트 레벨 테스트 러너 부재로 자동화 테스트는 보류 상태(Phase 2 예정)**.

**검증 전략**: spec의 "테스트 메모"에 따라, 다음 방식으로 인수기준을 검증한다:
- **문서 검증**: CLAUDE.md의 규약 섹션이 5개 항목 + 금지 문장을 포함하는지 grep 등으로 확인
- **코드 정적 검증**: 순수 함수의 export 존재, 함수 서명, 로직 리뷰로 커버
- **구문 검증**: `node --check scripts/worktree-add.mjs` 수행
- **수동 테스트**: CLI 인자 처리, worktree 생성, install 플래그 등은 사람 또는 E2E 환경에서 검증
- **설정 검증**: `.gitignore` 파일 내용 확인

**누락 사항**: 자동화 테스트 파일이 없으므로 모든 기능 항목이 `❌ 누락(테스트 없음)` 상태. 이는 **테스트 부재**를 신호화하는 것이며, 완성도 판단과 추가 개발 요청은 사람이 PR에서 결정한다.

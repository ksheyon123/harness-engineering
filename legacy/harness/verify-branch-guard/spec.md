# verify-branch-guard

## 목적

`verify-branch` 훅의 판정에 결함 3건이 확인됐다. 훅을 직접 실행해 재현한 것이고 추정이 아니다.

**① 훅은 '대상 파일'이 아니라 '세션'만 본다** — 브랜치·worktree 여부를 전부 `input.cwd` 에서 뽑는다. 그래서 **메인 체크아웃 세션이 다른 worktree 안의 제품 소스를 편집해도 막지 못한다.**

```
cwd=<메인 체크아웃>(main), file_path=<worktree>/scripts/gate.mjs
→ ask ("보호 브랜치입니다")     # deny 가 아니다
```

이 하네스에서 실제로 일어난 일이다. 메인 세션이 worktree 의 테스트 파일을 편집하려 했고, 훅은 세우지 못했다(사람이 세웠다). 이 경로로 진행되면 `load-spec` 도 spec 을 주입하지 않으므로 **"worktree 에서 작업 중"이라는 전제만 거짓이 된 채** 코드가 쓰인다.

**② 면제 판정이 부분 문자열 매칭이라 오탐이 있다** — `isHarnessMeta` 가 `file.includes("/harness/")` 형태다. 판정식을 그대로 복제해 평가한 결과:

| 판정 | 경로 | |
|---|---|---|
| 면제 | `apps/web/harness/foo.ts` | **제품 코드가 뚫린다** |
| 면제 | `vendor/.claude/x.ts` | 같은 이유 |
| 제품소스 | `.githooks/pre-push` | CLAUDE.md 는 "훅 면제"라고 적혀 있다 |
| 제품소스 | `harness-engineering.md` | 설계 전문이 제품 소스 취급 |
| 제품소스 | `BACKLOG.md` | 하네스 메타 문서인데 미면제 |

**오탐 쪽이 더 위험하다.** 도입 프로젝트의 제품 트리에 `harness/` 나 `.claude/` 라는 이름의 디렉터리가 있으면 worktree 강제가 그 경로에서 무력화되고, 실패가 조용하다(막히는 게 아니라 통과된다).

**③ `deny` 메시지가 부정확하다** — *"제품 소스(apps/·packages/)는 …"* 라고 적는데 이 저장소엔 그 디렉터리가 없다. 분리 이전 저장소의 잔재다.

## 배경 — BACKLOG #7 의 전제를 수정한다

BACKLOG #7 은 *"`scripts/`·`.githooks/` 가 차단되니 면제에 추가"* 라고 적었다. **채택하지 않는다.**

훅을 실행해 확인한 판정 순서는 이렇고, 3·4 에서 **조기 반환**한다:

```
1. git 아님          → 통과
2. index.json 없음   → 통과
3. main/dev/master   → ask   ← 반환
4. 미등록 브랜치      → ask   ← 반환
5. harness/·.claude/ → 통과
6. 링크드 worktree 아님 → deny
7. 그 외             → 통과
```

즉 `deny` 는 "등록된 task 브랜치를 **메인 체크아웃에 체크아웃해서** 작업" 할 때만 발동한다. **worktree 안에서는 `scripts/` 편집이 이미 자유롭다**(실측 확인). 규약대로 작업하면 부딪히지 않는다.

그리고 `scripts/` 를 면제하면 이 저장소는 제품 소스가 거의 전부 `scripts/` 라 worktree 강제가 사라진다 — 그 강제 덕분에 `#3` 을 worktree 에서 진행했고, 그래서 `#8`(CRLF, P0)이 드러났다. 면제는 **넓히는 게 아니라 정확하게** 만든다.

## 범위 밖 (명시)

- **`harness/`·`BACKLOG.md`·`harness-engineering.md`·`.githooks/` 를 `.claude/` 아래로 옮기는 구조 변경.** 별도 task 로 뗀다 — 경로가 코드 8곳 이상(`load-spec`·`qa-hash`·`verify-branch`·`gate.mjs` 의 `CONFIG_PATH`·`pre-push`·`worktree-add`·`qa.md`·`settings.json`)에 박혀 있어, 훅 로직 수정과 섞으면 문제가 났을 때 원인 분리가 안 된다. 이 task 는 **현재 레이아웃 위에서** 판정을 정확하게 만든다. 구조가 바뀌면 설정값만 바꾸면 되도록 설계한다.
- `harness-engineering.md` 의 §7.x 훅 서술 갱신. 그 파일은 `#2`(Phase 1 서술 제거)가 이미 손대므로 충돌을 피해 그쪽에 맡긴다.
- `PROTECTED` 목록(`main`/`dev`/`master`)의 설정화. "어디서 분기하나"가 아니라 "어디에 쓰면 안 되나"의 안전 규칙이라 값으로 빼지 않는다.
- 보호·미등록 브랜치의 `ask` 동작. 그대로 둔다.

---

## 기능 목록

### 기능 A: 교차 워킹트리 편집을 차단한다

- **의도**: 위 ①. 세션이 속한 워킹트리와 **대상 파일이 속한 워킹트리가 다르면** 그것은 규약 위반이다. 훅이 판단 근거를 하나 더(대상 파일) 갖게 한다.
- **방식**: 대상 파일 쪽에서도 git 컨텍스트를 뽑아 세션 것과 비교한다. 실측으로 판별 가능함을 확인했다:

  | | `--show-toplevel` | `--path-format=absolute --git-common-dir` |
  |---|---|---|
  | 세션 cwd | `…/harness-engineering` | `…/harness-engineering/.git` |
  | `<worktree>/scripts` | `…-worktree-config` | `…/harness-engineering/.git` |

  판정:
  - **common-dir 같음 + toplevel 다름** → 같은 저장소의 다른 워킹트리 → **`deny`**
  - **common-dir 다름** → 아예 다른 저장소 → **`ask`** (다중 저장소 작업은 정당할 수 있다 — 차단은 과하다)
  - 대상이 git 밖(스크래치패드 등) → 통과
  - 세션·대상 toplevel 같음 → 기존 판정으로 진행
- **주의**:
  - **신규 파일은 아직 존재하지 않는다.** `dirname` 부터 시작해 **존재하는 상위 디렉터리로 올라가며** `git -C` 를 시도한다. 파일 존재를 전제하면 Write 신규 생성에서 오작동한다.
  - `--path-format=absolute` 는 git 2.31+ 다. 실패하면 `--absolute-git-dir` 로 폴백한다.
  - 경로 비교는 Windows 대소문자 차이를 흡수해야 한다. `worktree-add.mjs` 의 `samePath` 가 이미 그 로직(`normalize`+`resolve`+win32 소문자화)을 갖고 있으니 **그것을 export 해 재사용한다** — 사본을 만들지 않는다.
  - 이 검사는 **다른 모든 판정보다 먼저** 온다. 보호 브랜치 `ask` 가 조기 반환하면 교차 편집이 `ask` 로 새어 나간다(현재 증상이 정확히 그것이다).
  - git 호출 실패는 전부 **통과**로 처리한다. 훅이 작업을 깨지 않는다는 기존 방침을 지킨다.
- **인수기준**:
  - 세션 cwd 가 메인 체크아웃이고 대상이 링크드 worktree 안의 파일이면 `deny` 다.
  - 세션과 대상이 같은 워킹트리면 기존 판정과 동일하게 동작한다.
  - 대상이 다른 저장소면 `deny` 가 아니라 `ask` 다.
  - 대상이 git 저장소 밖이면 간섭하지 않는다.
  - 아직 존재하지 않는 파일 경로에도 위 판정이 동작한다.

### 기능 B: 면제 판정을 저장소 루트 기준으로 앵커링한다

- **의도**: 위 ②의 오탐. `includes("/harness/")` 는 경로 어디에 있든 매칭된다. 면제는 **저장소 루트 바로 아래의 그 디렉터리**여야 한다.
- **방식**:
  - 대상 파일을 **저장소 루트 상대경로로 정규화**한 뒤(`path.relative(toplevel, file)`, 구분자 `/` 통일), 면제 목록의 접두어로 **시작하는지**로 판정한다.
  - 면제 목록을 `harness/config.json` 의 `harnessMetaPaths` 로 뺀다. 기본값은 `["harness/", ".claude/"]` — **현재 동작과 동일**. `gate.mjs` 의 `DEFAULTS`/`loadConfig` 에 필드를 추가한다(`installCommand` 와 같은 방식). 배열이 아니거나 원소가 문자열이 아니면 throw.
  - 이 저장소의 설정에는 `.githooks/`·`harness-engineering.md`·`BACKLOG.md` 를 **추가**한다. 문서가 "훅 면제"라고 약속한 것을 실제로 성립시키고, 설계 문서·백로그가 제품 소스 취급되는 것을 없앤다.
- **주의**:
  - `verify-branch.mjs` 는 훅이다. 설정이 없거나 깨져도 **조용히 죽으면 안 된다** — `qa-hash.mjs` 와 같은 방침으로 `DEFAULTS` 에 물러선다. 설정 오류를 알리는 것은 `gate.mjs` 의 몫이다.
  - 목록 항목이 디렉터리 접두어(`harness/`)인지 단일 파일(`BACKLOG.md`)인지 구분해야 한다. 접두어 매칭 하나로 처리하되, `BACKLOG.md` 같은 항목이 `BACKLOG.md.bak` 을 면제하지 않도록 **정확 일치 또는 `/` 로 끝나는 접두어**로 규칙을 정한다.
  - `scripts/` 는 넣지 않는다. 이유는 위 '배경' 절.
- **인수기준**:
  - `apps/web/harness/foo.ts` 와 `vendor/.claude/x.ts` 가 **면제되지 않는다**(현재는 면제된다).
  - `harness/index.json`·`.claude/CLAUDE.md` 는 계속 면제된다.
  - 설정에 `.githooks/` 를 넣으면 `.githooks/pre-push` 가 면제된다.
  - `harnessMetaPaths` 가 없는 설정에서 판정이 현재와 동일하다.
  - 설정 파일이 없거나 JSON 이 깨져도 훅이 기본값으로 계속 동작한다.

### 기능 D: `deny` 메시지를 일반화한다

- **의도**: 위 ③. 메시지가 `apps/·packages/` 를 지목하는데 이 저장소엔 없다. 특정 저장소의 디렉터리 이름을 훅에 박아두면 도입 프로젝트마다 틀린 안내를 한다.
- **방식**: 디렉터리 이름을 부르지 않는다. "면제 경로 밖의 파일" 로 일반화하고, 면제 목록이 `harness/config.json` 의 `harnessMetaPaths` 에 있음을 안내한다. 교차 워킹트리 차단(A)은 **다른 메시지**를 쓴다 — 원인이 다르므로 안내도 달라야 한다("worktree 를 만들어라" vs "그 worktree 의 세션에서 편집하라").
- **인수기준**:
  - `deny` 메시지에 `apps/`·`packages/` 가 등장하지 않는다.
  - 교차 워킹트리 차단과 메인 체크아웃 차단의 메시지가 서로 구별된다.

### 기능 E: 판정 로직을 순수 함수로 분리하고 테스트한다

- **의도**: `verify-branch.mjs` 는 지금 전부 최상위 부수효과 코드(stdin 파싱 → `decide` → `process.exit`)라 **테스트가 불가능하다.** 이번 변경이 판정의 핵심을 바꾸므로 지금 분리한다. `#1` 이 `gate.mjs` 에서 세운 관례(순수 함수 + 주입)를 따른다.
- **방식**:
  - `isHarnessMeta(relPath, metaPaths)` → boolean. 저장소 루트 상대경로를 받는다.
  - `classifyLocation({ sessionTop, sessionCommon, targetTop, targetCommon })` → `"same" | "other-worktree" | "other-repo" | "outside"`. 부수효과 없음 → 이 함수가 테스트의 주 대상이다.
  - git 호출·stdin 파싱은 `main()` 에만 남긴다.
  - `worktree-add.mjs` 의 `samePath` 를 export 해 두 곳이 같은 비교 규칙을 쓰게 한다.
- **주의**: 훅의 입출력 계약(stdin JSON → 결정 JSON, 어떤 실패에도 exit 0)은 바꾸지 않는다.
- **인수기준**:
  - `.claude/hooks/verify-branch.test.mjs` 가 `npx vitest run` 에서 실행되고 통과한다.
  - `classifyLocation` 이 네 가지 경우를 모두 구분한다.
  - `isHarnessMeta` 가 상대경로·역슬래시 경로에 대해 같은 결과를 낸다.
  - 게이트 설정(`harness/config.json` 의 `testFilePatterns`)이 `.claude/` 아래 테스트 파일도 잡는지 확인하고, 안 잡으면 패턴을 넓힌다.

---

## 완료 후 판정

```
0. 대상이 세션과 다른 워킹트리(같은 저장소)  → deny   ← 신규(A)
0. 대상이 다른 저장소                        → ask    ← 신규(A)
1. git 아님 / index.json 없음               → 통과
2. main/dev/master                          → ask
3. 미등록 브랜치                             → ask
4. 루트 기준 harnessMetaPaths 접두어          → 통과   ← 앵커링(B)
5. 링크드 worktree 아님                      → deny   ← 메시지 일반화(D)
6. 그 외                                     → 통과
```

## 사람 확인 필요

- **BACKLOG #7 의 '바꿀 것' 과 결론이 다르다.** 원안은 `scripts/`·`.githooks/` 면제였으나 이 spec 은 `scripts/` 를 의도적으로 제외한다(근거는 '배경' 절). BACKLOG 항목도 이 결론으로 갱신해야 한다.
- 이 task 는 `.claude/`·`harness/` 파일이 대부분이라 면제 대상이지만, **규약대로 worktree 에서 진행한다.** 예외를 만들면 그 예외가 기본이 된다.

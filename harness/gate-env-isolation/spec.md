# gate-env-isolation

## 목적

게이트가 git 훅 안에서 돌기 때문에, 게이트가 스폰하는 테스트 프로세스가 **진짜 저장소를 가리키는 `GIT_*` 환경변수를 상속**한다. 그래서 임시 저장소를 겨냥해 쓴 테스트가 **이 저장소를 조작한다.**

**가설이 아니다. 이 저장소를 실제로 망가뜨렸다.**

```
git commit
 └ .githooks/pre-commit          ← git 이 GIT_DIR·GIT_INDEX_FILE 등을 export
    └ node scripts/gate.mjs         (진짜 저장소를 가리킨다)
       └ npx vitest run
          └ verify-branch.test.mjs
             └ git -C <임시경로> checkout -B feat/solo   ← 진짜 저장소에 적용됨
```

핵심은 이것이다: **`GIT_DIR` 이 설정돼 있으면 `-C` 는 무시된다.** `-C` 는 작업 디렉터리만 바꾸고, 저장소 탐색은 `GIT_DIR` 이 있으면 아예 건너뛴다. `cwd` 옵션을 정확히 줘도 막히지 않는다 — 환경변수가 그 위에 있다.

실제 피해:

| 테스트가 의도한 것 | 실제로 벌어진 일 |
|---|---|
| `git init <tmp>` | 진짜 저장소를 bare 로 재초기화 → `core.bare=true`, 워킹트리 소실 |
| `git -C tmp commit -qm "init"` | 진짜 저장소에 `7d97f5c init` 커밋 |
| `git -C tmp checkout -B feat/solo` | 진짜 `feat/solo` 생성 + `main` 을 픽스처 커밋으로 리셋 |
| `git -C tmp worktree add …` | 진짜 저장소에 temp 를 가리키는 worktree 등록 |

복구는 됐다(reflog → `branch -f` → `core.bare false` → `symbolic-ref` + mixed reset). 워킹트리 파일과 원격은 무손상이었다.

## 배경 — 왜 테스트가 아니라 하네스를 고치는가

그 테스트는 **이미 스스로 방어를 넣었다.** `GIT_*` 를 걸러낸 `ENV` 를 자식에게 넘기고, 임시 저장소를 정말 보고 있는지 `--show-toplevel` 로 단언한다. 즉 이 사고는 "방어를 몰라서" 난 게 아니라 **방어를 넣기 전에 한 번 돌았기 때문에** 났다.

그리고 그 방어는 **그 파일 안에만** 있다. 게이트가 훅 안에서 도는 구조가 그대로인 한:

- git 을 호출하는 **모든 미래의 테스트**가 같은 함정에 빠진다.
- 이 하네스를 도입하는 **모든 프로젝트**가 그 함정을 그대로 물려받는다.
- 방어가 **테스트 작성자의 규율**에 의존한다 — 그 규율은 이미 한 번 실패했고, 실패의 대가가 저장소 손상이다.

`#1` 이 게이트에 대해 내린 결론을 그대로 적용한다: **실행 진입점이 하나면 방어도 한 곳이면 된다.** `scripts/gate.mjs` 가 유일한 스폰 지점이므로 거기서 막는다.

## 범위 밖 (명시)

- `pre-push` 가 스폰하는 headless QA(`claude`). QA 는 `--disallowedTools "Bash"` 라 git 을 호출할 수 없다. 다만 아래 '주의' 에 근거를 남긴다.
- `.claude/hooks/qa-hash.mjs`·`verify-branch.mjs` 의 git 호출. 전부 읽기 전용(`rev-parse`)이고 훅 컨텍스트에서 도는 것이 오히려 정상이다.
- `verify-branch.test.mjs` 의 기존 방어 제거. **남겨 둔다** — 이중 방어이고, 그 테스트가 다른 러너로 단독 실행될 수도 있다.
- 손상된 저장소 복구. 이미 완료했다.

---

## 기능 목록

### 기능: `scrubGitEnv` — 자식 프로세스 환경에서 `GIT_*` 를 제거한다

- **의도**: 게이트가 스폰하는 어떤 프로세스도 훅의 git 컨텍스트를 물려받지 않게 한다.
- **방식**:
  - `scripts/gate.mjs` 에 순수 함수 `scrubGitEnv(env)` 를 추가하고 export 한다. 입력 객체를 변형하지 않고 **새 객체**를 반환한다(`process.env` 를 직접 건드리면 gate.mjs 자신의 이후 git 호출까지 바뀐다).
  - **접두어 `GIT_` 인 키를 전부 제거한다.**
- **주의**:
  - **왜 개별 지정(denylist)이 아니라 접두어 전체인가**: 위험한 변수는 `GIT_DIR` 하나가 아니다 — `GIT_WORK_TREE`·`GIT_INDEX_FILE`·`GIT_COMMON_DIR`·`GIT_OBJECT_DIRECTORY`·`GIT_ALTERNATE_OBJECT_DIRECTORIES`·`GIT_NAMESPACE`·`GIT_CEILING_DIRECTORIES` 가 각자 다른 방식으로 대상 저장소를 바꾼다. 목록 방식은 **fail-open** 이다: git 이 새 변수를 추가하거나 우리가 하나를 빠뜨리면 조용히 구멍이 남고, 그 실패는 저장소 손상으로 나타난다. 접두어 방식은 **fail-closed** 다.
  - `GIT_EXEC_PATH` 도 함께 사라진다. git 은 이 값이 없으면 컴파일 시 기본 경로를 쓰므로 정상 동작한다 — 제거해도 안전하다는 판단을 주석에 남긴다.
  - `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 도 사라진다. 테스트가 커밋을 만든다면 자기 저장소에 `user.email`/`user.name` 을 설정해야 하는데, **그것이 옳은 방향**이다(훅 실행자의 신원이 테스트 픽스처에 새어 들어가면 안 된다).
  - `GIT_*` 가 아닌 것은 **건드리지 않는다.** `PATH`·`NODE_*`·`APPDATA` 등이 사라지면 Windows 에서 `npx` 가 뜨지 않는다.
- **인수기준**:
  - `scrubGitEnv({ GIT_DIR: "x", GIT_INDEX_FILE: "y", PATH: "p" })` 가 `GIT_*` 를 제거하고 `PATH` 를 보존한다.
  - 입력 객체가 변형되지 않는다(원본에 `GIT_DIR` 이 그대로 남는다).
  - `GIT` 로 시작하지만 `GIT_` 가 아닌 키(예: `GITHUB_TOKEN`)는 **보존된다**.

### 기능: 게이트가 스폰하는 모든 프로세스에 적용한다

- **의도**: 함수만 있고 쓰이지 않으면 의미가 없다. 스폰 지점을 빠짐없이 덮는다.
- **방식**:
  - `runOne()` 의 `execSync(cmd, { cwd, stdio })` 에 `env: scrubGitEnv(process.env)` 를 넘긴다.
  - `repoRoot()`·`mergeBase()` 의 git 호출에도 같은 env 를 쓴다. 읽기 전용이라 위험하진 않지만, **게이트 안의 git 해석이 한 가지여야** 한다 — `GIT_DIR` 이 있을 때와 없을 때 `--show-toplevel` 이 다른 값을 낼 수 있다.
  - 계산은 한 번 하고 재사용한다(호출마다 `process.env` 를 복사하지 않는다).
- **주의**:
  - `repoRoot()` 를 스크럽된 env 로 부르면 저장소 탐색이 **cwd 기준**이 된다. 훅에서 gate.mjs 는 항상 저장소 안에서 실행되므로 결과는 같지만, 링크드 worktree 의 훅에서도 그런지 **실제로 확인**한다(worktree 의 pre-commit 에서 게이트를 돌려 `[gate]` 출력의 대상 경로가 그 worktree 인지 본다).
  - `stdio: "inherit"` 은 그대로 둔다(`gate-pipeline` spec 의 결정).
- **인수기준**:
  - `GIT_DIR` 을 설정한 상태에서 `node scripts/gate.mjs` 를 실행해도 게이트가 정상 동작한다.
  - 게이트가 스폰한 프로세스에서 `process.env.GIT_DIR` 이 `undefined` 다.
  - 링크드 worktree 에서 `git commit` 시 게이트가 그 worktree 를 대상으로 돈다.

### 기능: 회귀 테스트 — 사고를 안전하게 재현한다

- **의도**: 이 방어가 나중에 조용히 사라지지 않게 못을 박는다. 단위 테스트만으로는 "`runOne` 이 실제로 그 env 를 쓰는가"를 보장하지 못한다.
- **방식**:
  - `scrubGitEnv` 단위 테스트(위 인수기준).
  - **엔드투엔드 성격의 테스트 하나**: `GIT_DIR` 이 오염된 env 로 자식을 스폰해, 자식이 그 값을 보지 못함을 확인한다. 실제 git 조작을 하지 않고 `node -e "console.log(process.env.GIT_DIR ?? 'unset')"` 로 확인하면 **저장소를 건드리지 않고** 검증된다.
- **주의**:
  - **이 테스트 자체가 git 을 조작해서는 안 된다.** 사고를 재현하려다 사고를 내는 것을 피한다 — 환경변수가 자식에게 전달되는지만 본다.
  - 이 저장소의 테스트는 `harness/config.json` 의 `testFilePatterns` 로 잡힌다. 새 파일이 그 패턴에 걸리는지 확인한다.
- **인수기준**:
  - `npx vitest run` 이 새 테스트를 실행하고 통과한다.
  - 스크럽을 되돌리면(방어를 임시로 제거하면) 그 테스트가 실패한다 — 즉 테스트가 실제로 이 성질을 지키고 있다.

### 기능: 테스트에서 git 을 부를 때의 규약을 `.claude/rules/` 에 남긴다

- **의도**: 게이트 방어는 **게이트를 거치는 경로**만 덮는다. 개발자가 `npx vitest run` 을 직접 돌릴 때는 `GIT_*` 가 없어 안전하지만, 다른 러너·CI·에디터 통합에서 어떻게 될지는 보장할 수 없다. 이중 방어를 규약으로 남긴다.
- **방식**: `.claude/rules/test-git.md` 를 만든다. `paths:` frontmatter 로 테스트 파일에만 매칭시킨다(무관한 세션의 컨텍스트를 먹지 않게 — 이 저장소의 rules 규약).
  - 임시 저장소를 겨냥한 git 호출은 자식 env 에서 `GIT_*` 를 제거한다.
  - 픽스처를 만든 직후 `rev-parse --show-toplevel` 로 **의도한 경로인지 단언**하고, 아니면 시끄럽게 실패시킨다.
  - `-C` 와 `cwd` 는 `GIT_DIR` 을 이기지 못한다는 사실을 근거로 명시한다.
- **주의**: 이 저장소의 `.claude/rules/` 는 지금 템플릿만 있고 실사용 규칙이 없다. **`paths:` 를 빠뜨리면 매 세션 로드돼 분리한 의미가 사라진다**(README 의 경고).
- **인수기준**:
  - `.claude/rules/test-git.md` 가 `paths:` frontmatter 를 갖는다.
  - 규칙이 `verify-branch.test.mjs` 가 이미 하고 있는 방어와 어긋나지 않는다.

### 기능: BACKLOG #9 를 완료로 정리한다

- **방식**: #9 항목에 취소선 + **완료** + 커밋 해시. 우선순위 표에서 P0 을 내린다.
- **인수기준**: BACKLOG #9 가 완료로 표시되고, 사고 경위와 방어 위치가 항목 안에서 읽힌다.

---

## 사람 확인 필요

- **이 task 가 끝날 때까지 git 을 호출하는 테스트를 게이트로 돌리지 않는다.** `fix/verify-branch-guard` 세션은 그 테스트를 갖고 있으므로 **이 task 머지 이후 재개**한다. 그 전에 커밋을 시도하면 `pre-commit` → 게이트 → 같은 사고가 재현될 수 있다(그 파일의 자체 방어가 막아줄 가능성이 높지만, 그 가능성에 저장소를 걸지 않는다).
- 이 task 자체는 `scripts/gate.mjs` 를 고치므로 **worktree 에서 진행한다**. 다만 그 worktree 에서 커밋할 때도 게이트가 도는데, 이 저장소의 현재 테스트(`gate.test.mjs`·`worktree-add.test.mjs`)는 git 을 호출하지 않으므로 안전하다.

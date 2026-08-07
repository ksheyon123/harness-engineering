# 하네스 설계 노트 — 역할 격리와 강제 지점

> **상태**: 논의 정리. spec 이전 단계의 설계 근거 기록이다.
> **대상**: fan-out / fan-in 하네스 재작성. 구 버전은 `legacy/` 에 아카이브돼 있다.

## 1. 목표 파이프라인

```
planner    ──▶  spec.md (기능 목록)
developer  ──▶  테스트 코드 + 개발 코드
qa         ──▶  qa-checklist.md (spec 기반 독립 도출 + 커버리지 대조)
게이트     ──▶  vitest + tsc
push
```

목표는 **의도하지 않은 동작을 구조적으로 막는 것**이다. 각 단계가 "알아서 잘 하기를"
기대하지 않고, 할 수 없게 만든다.

## 2. 지켜야 할 불변식

1. **각 에이전트는 자신의 워킹트리 안에서만 파일을 다룬다.**
2. **`main` / `dev` 에는 커밋도 push 도 되지 않는다.**
3. **게이트를 통과하지 않은 결과는 회수되지 않는다.**
4. **spec 없이 코드가 쓰이지 않는다.**

## 3. 구 하네스의 오진 — verify-branch 는 commit/push 를 막은 적이 없다

`legacy/claude/hooks/verify-branch.mjs` 는 `PreToolUse: Edit|Write` 훅이다. 즉
**파일 편집만** 본다. `git commit` 과 `git push` 는 Bash 로 나가므로 이 훅의 시야에
들어오지 않는다.

`main` 보호가 성립하는 것처럼 보였던 이유는 이렇다:

- 판정 2(보호 브랜치 → `ask`)가 `main` 에서 *파일 편집*을 막아 → 커밋할 내용이 안 생김
- `legacy/githooks/pre-commit` 은 브랜치를 보지 않는다(부분 스테이징 · spec-lock · 게이트만)
- 결국 "main/dev 에 커밋하지 않는다"는 **CLAUDE.md 의 문장뿐**이었다

**불변식 2는 한 번도 하드로 강제된 적이 없다.** 이것이 재설계의 출발점이다.

## 4. 강제 지점은 층이 다르고, 각 층이 볼 수 있는 것도 다르다

| 층 | 볼 수 있는 것 | 맞는 질문 |
|---|---|---|
| agent `tools:` 화이트리스트 | 도구 유무 | **능력 자체의 제거** |
| `PreToolUse(Edit\|Write)` | 파일 경로 | **경로 소유권** |
| `PreToolUse(Bash)` | 명령 **문자열** | 취약 — fail-open |
| `permissions.deny` | 도구/패턴 접두어 | 방어선이지 봉인이 아님 |
| git `pre-commit` / `pre-push` | 실제 브랜치 · ref · 트리 | **브랜치 보호** |

**브랜치 보호에 맞는 층은 git 훅뿐이다.** `git commit` 은 표기가 무한하지만
(`git -C x commit`, `--amend`, alias, `&&` 체인, 변수 치환) 훅은 *결과*를 본다.
특히 `pre-push` 는 stdin 으로 `<local ref> <sha1> <remote ref> <sha1>` 를 받으므로
`refs/heads/main` 을 정확히 거절할 수 있다 — 명령을 파싱할 필요가 없다.

반대로 **git 훅으로는 "자기 worktree 만" 을 막을 수 없다.** `git -C ../다른-worktree commit`
을 하면 훅은 그 worktree 안에서 돌고 거기 브랜치는 정상이니 통과시킨다. 훅은 누가
불렀는지 모른다. 브랜치 보호와 worktree 소유권은 **다른 문제이고 같은 층에서 풀리지 않는다.**

## 5. 핵심 — Bash 는 스코프를 매길 수 없는 유일한 도구

하네스가 나눠주는 다른 도구는 전부 **인자 모양으로 판정된다.** `Edit`/`Write` 는
`file_path` 를 받으므로 `PreToolUse` 훅이 그것을 그대로 읽고 결정할 수 있다 —
구 `verify-branch` 가 순수 함수로 그 판정을 했고 실제로 견고했다.

Bash 는 **불투명한 문자열**을 받는다. 어떤 훅도 신뢰성 있게 판정할 수 없다. 그리고
결정적으로:

```sh
printf 'x' > ../worktrees/agent-9f2/src/foo.ts
```

이 한 줄에 `PreToolUse(Edit|Write)` 는 **발동하지 않는다.** 즉 어떤 역할에 Bash 를 주면
git 이 추가되는 것이 아니라, **그 역할에 대한 경로 소유권 보장 전체가 규약으로 강등된다.**

이 저장소에 이미 그 사례가 있다 — 테스트가 상속받은 `GIT_*` 환경변수로 저장소를 bare 로
재초기화하고 `main` 을 픽스처 커밋으로 덮은 사고(`legacy/claude/rules/test-git.md` 참고).
그것은 Edit/Write 가 아니라 **Bash 로 왔다.**

> **결론**: 문제는 git 이 아니다. 문제는 *파일을 고칠 이유가 있는 세션이 동시에 Bash 를
> 갖는 것*이다. 그러면 경로 층이 장식이 된다.

## 6. 객관 게이트는 훅이고, 주관 판단만 에이전트다

게이트를 돌리기 위해 developer 에게 Bash 를 줄 필요가 없다. **agent frontmatter 가
`hooks:` 를 지원한다** — 31개 이벤트 전부, 그리고 서브에이전트에서 `Stop` 은 자동으로
`SubagentStop` 으로 변환된다. 스코프는 그 에이전트의 수명뿐이고 끝나면 정리된다.

그리고 `SubagentStop` 은 **차단할 수 있다**:

```json
{ "decision": "block", "reason": "<게이트 출력>" }
```

즉 단순 검증이 아니라 **강제 루프**가 된다.

```
developer 가 끝났다고 선언
   → 훅이 게이트를 돌린다
   → red 면 종료를 거부하고 출력을 되돌려준다
   → 같은 developer 가, 같은 worktree 에서, 자기 컨텍스트를 그대로 들고 이어서 고친다
```

**훅은 에이전트의 도구 제약을 받지 않는다.** 훅은 하네스 인프라이고 에이전트는
피검사자다. 게이트를 훅으로 내리는 순간 "게이트를 돌리려면 그 역할에 Bash 를 줘야 한다"는
전제 자체가 사라진다.

객관 게이트(`vitest run`, `tsc`)에는 **독립적으로 판단할 것이 없다.** 돌리기만 하면 되고
답은 하나다. 독립적 시각이 필요한 것은 주관 판단뿐이고 그것은 QA 가 맡는다.

> **객관 = 훅. 주관 = 에이전트.**

## 7. 경계 절단 규칙 — 실패는 경계를 넘기지 않는다

`tester` 를 별도 에이전트로 두면 다음이 무너진다: developer 가 끝나고 컨텍스트가 소멸한
뒤에 tester 가 돌고, red 가 나면 수리할 주체가 없다. 새 developer 를 부르면 남이 쓴 코드를
처음 보는 상태이며, **어느 spec 의 어느 인수기준을 겨냥한 코드인지조차 모른다.**

여기서 일반 규칙이 나온다.

> **핸드오프가 완결된 산출물일 때만 경계를 자른다. 실패는 경계를 넘기지 않는다.**

| 경계 | 자를 수 있나 | 이유 |
|---|:---:|---|
| spec.md → developer | ✅ | spec 은 완결된 문서다. 앞사람의 사고 과정이 필요 없다 |
| 코드+테스트 → qa | ✅ | qa 는 **모르는 게 낫다** — 독립 도출이 그 역할의 값어치다 |
| red → 수리 | ❌ | 수리는 '무엇을 왜 시도했는가' 를 요구하고, 그것은 그 에이전트 컨텍스트에만 있다 |

## 8. 확정 구조

```
오케스트레이터   Agent/Read/Grep/Glob/Bash   메인 체크아웃   git 전담 · 스폰 · 회수 · push
planner          Read/Grep/Glob/Write/Edit   worktree        Bash ❌
developer        Read/Grep/Glob/Write/Edit   worktree        Bash ❌  + SubagentStop 게이트
qa               Read/Grep/Glob/Write/Edit   worktree        Bash ❌
```

```
층 0  agent tools              세 역할에 Bash 없음 → 셸·git 자체가 불가
층 1  PreToolUse(Edit|Write)   세션 밖 파일 편집 deny → 경로 소유권
층 2  git pre-commit/pre-push  main·dev 커밋·push 거부
```

**층 1이 처음으로 완전 방어가 된다.** 세 작업 역할에게 Edit/Write 가 파일을 바꾸는
유일한 경로이므로, 거기 붙인 경로 소유권 훅에 우회로가 없다. 불변식 1이 강제 가능한
문장이 되는 것은 이 조건 아래서다.

**층 2가 필수인 이유**: 오케스트레이터가 유일하게 규제되지 않는 주체이고, 그것은 도구
경계로 막을 수 없다(스폰과 회수를 하려면 Bash 가 있어야 한다). git 훅만이 오케스트레이터를
본다. 역할 배치를 어떻게 바꾸든 이 층은 면제되지 않는다.

게이트는 **서로 다른 트리를 보는 두 지점**에서 돈다:

| 지점 | 대상 트리 | 묻는 것 |
|---|---|---|
| `SubagentStop` 훅 | 각 developer 의 worktree | 개별 작업이 green 인가 |
| git `pre-commit` | 머지된 task 브랜치 | 합친 결과도 green 인가 |

둘은 중복이 아니다. developer 를 병렬로 돌리면 각자의 worktree 에서는 전부 green 인데
합치면 깨질 수 있고, **그 조합은 어느 developer 의 훅도 본 적이 없다.**

## 9. 검토했으나 배제한 것

### committer 에이전트 (커밋·push 전담 역할)

- **격리를 가질 수 없다.** `isolation: worktree` 를 주면 HEAD 에서 잘린 자기 사본을 받으므로
  developer 의 worktree 를 볼 수 없고, 자기 사본에 커밋해봐야 아무 데도 도달하지 않는다.
  메인 체크아웃에서 돌아야 하고, 그것은 불변식 1의 명시적 예외가 된다.
- **사려던 성질을 이미 갖고 있다.** "git 을 만질 수 있는 세션이 정확히 하나" 는 오케스트레이터로
  이미 참이다. committer 는 그 하나를 *옮기는* 것이지 *줄이는* 것이 아니다.
- **대가가 실하다.** 오케스트레이터와 HEAD 를 놓고 다투고(두 task 동시 진행 시 경합),
  커밋마다 스폰·보고 왕복이 붙는다.
- **강제력을 더하지 않는다.** committer 도 프롬프트로 "main 에 커밋하지 마라" 를 받을 뿐이고,
  그것은 CLAUDE.md 문장과 정확히 같은 층이다. 층 2를 면제해주지 않는다.

### tester 에이전트

§7 참고. 실패가 경계를 넘어가 컨텍스트를 잃는다.

### PreToolUse(Bash) 로 명령을 파싱해 경계를 검증하는 방식

셸 한 줄의 표현 공간이 너무 넓어(변수 치환, 서브셸, 심볼릭 링크, `pushd`) fail-open 이다.
경로 하나를 판정하는 구 `verify-branch` 가 279줄이었다.

## 10. legacy 와 달라지는 지점

**developer 가 스스로 커밋하지 않는다.** legacy 에서는 developer 가 Bash 로 자기 브랜치에
커밋했고, 그것이 `pre-commit` 을 트리거해 '커밋된 것은 green' 을 보장했다. 보장 경로가 바뀐다:

```
legacy    developer 가 커밋 → pre-commit 게이트 → green 아니면 커밋 실패
새 구조   SubagentStop 훅 → red 면 종료 차단
          오케스트레이터가 worktree 를 겨냥해 커밋 → pre-commit 이 다시 확인
```

보장이 유지될 뿐 아니라 앞당겨진다. legacy 는 '커밋에 실패하면 그 작업은 버린다' 였는데,
새 구조는 **버릴 일이 생기지 않게** 붙잡아 둔다.

회수는 legacy 가 planner·qa 에 쓰던 방식을 세 역할 전부에 똑같이 적용한다:

```sh
git -C <역할 worktree> add -A
git -C <역할 worktree> commit -F <메시지 파일>
```

`core.hooksPath` 는 worktree 가 공유하므로 `pre-commit` 이 **그 worktree 안에서** 돈다 —
검사 대상과 커밋 대상이 일치한다.

회수 경로에 대한 관찰: `worktree.baseRef: "head"` 라 역할 브랜치는 task 브랜치의 **직계
자손**이다. 따라서 `git fetch . <역할 브랜치>:<task 브랜치>` 로 워킹트리 없이 fast-forward
회수가 가능하다(`--no-ff` 는 포기). developer 를 병렬로 여러 개 돌리면 두 번째부터는
fast-forward 가 아니므로 그때만 checkout + merge 가 필요하다.

## 11. 미결 사항

1. **SubagentStop 루프의 상한.** 무조건 차단하면 developer 가 못 고치는 원인(외부 의존성,
   spec 자체의 모순)에서 무한 루프에 빠진다. 훅이 시도 횟수를 세고(worktree 의 `.git` 안에
   카운터), 상한을 넘으면 차단을 풀어 developer 가 '게이트 red · 자력 해결 불가 · 원인은
   이것' 으로 종료하게 해야 한다.

2. **게이트의 실행 단위.** developer 는 이제 반복 중에 테스트를 개별로 돌릴 수 없고 턴이
   끝나야 판정을 받는다. 한 번의 반복 비용이 매번 전체 게이트다. 변경 파일 기준으로 좁혀
   돌릴지, 전체를 돌릴지 정해야 한다.

3. **`pre-push` 의 main 차단 범위.** 사람의 직접 push 도 막을 것인가. PR 로만 들어가야 한다면
   막는 것이 맞고, `--no-verify` 가 탈출구로 남는다. 정책 결정이다.

4. **tsc 의 실체.** 목표는 'Vitest & tsc' 인데 이 저장소는 전부 `.mjs` 이고 tsconfig 도
   `typescript` 의존성도 없다. legacy 의 `harness/config.json` 은 `gate.typecheck: []` 로
   비어 있었다 — **한 번도 실행된 적 없는 경로다.** 이 저장소에 TypeScript 를 도입할지,
   아니면 적용 대상 프로젝트에서 설정만 채우면 도는 상태로 두고 그 경로가 실제로 동작하는지만
   검증할지 정해야 한다.

5. **미등록 브랜치 판정의 처리.** worktree 안의 브랜치는 `worktree-agent-<난수>` 라
   '등록된 task 브랜치인가' 검사가 항상 실패한다(구 `verify-branch` 판정 3의 구조적 오탐).
   빼는 쪽이 맞아 보인다 — 그 판정이 지키려던 불변식 4는 파이프라인 순서가 이미 보장한다.

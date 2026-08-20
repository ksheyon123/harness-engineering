---
branch: fix/hookspath-compare
---

# `init` 의 `core.hooksPath` 충돌 판정을 해석된 경로로 고친다

## 목적

`harness init` 이 `core.hooksPath` 를 **철자로** 비교해서, 이미 A 자신의 `.githooks` 를 **절대경로로** 가리키고 있는 저장소에서 설치를 거부한다. 판정을 **가리키는 곳**으로 바꾸고, 그 판정을 `smoke` 와 한 곳에서 공유한다. 진짜 충돌일 때의 메시지도 근거 없는 단정을 빼고 처방을 붙인다.

## 배경

실제로 막힌 저장소가 있다(`C:\Users\enliple\projects\eznote-front`). 그 저장소의 `.git/config` 는

```
hooksPath = C:\\Users\\enliple\\projects\\eznote-front\\.githooks
```

즉 **하네스가 심으려는 바로 그 디렉터리**를 절대경로로 적어 두었다. 그런데 `install/init.mjs:262` 는

```js
if (current === want) return { ... state: "same" };   // want = ".githooks"
```

문자열을 비교하므로 어긋나고, 곧장 `conflict` 로 떨어져 설치가 통째로 멈춘다. 출력은 `(husky·lefthook 을 쓰고 있을 것이다)` 라고 단정하는데 그 저장소에는 `.husky` 도 `.githooks` 도 **없다** — 지킬 훅이 없는 자리에서 방어선이 자기 자신을 막았다.

같은 판정이 `install/smoke.mjs:396` 에는 **이미 제대로 들어 있다**:

```js
if (normalize(resolve(tree, hooksPath)) !== normalize(join(tree, ".githooks"))) { ... }
```

바로 위 주석이 *"물어야 할 것은 표기가 아니라 어디를 가리키는가"* 이고, `docs/measured.md:48` 이 **절대경로는 정상**임을 실측으로 확정해 두었다. 그 결론이 `smoke` 에만 반영되고 `init` 에는 오지 않았다. 그래서 지금 **같은 저장소를 두 명령이 반대로 읽는다** — `init` 은 "남의 것이다" 하며 멈추고, `smoke` 는 "정상이다" 한다. 이번 버그의 원인은 판정 규칙이 틀린 것이 아니라 **판정이 두 곳에 따로 적혀 어긋난 것**이다.

부수적으로 `hooksPathStep(tree, git)` 은 `tree` 를 인자로 받아놓고 한 번도 쓰지 않는다 — 경로를 풀 의도가 있었다가 빠진 자리다.

## 기능 목록

### 기능: `core.hooksPath` 판정을 해석된 경로로 통일한다

- **의도**: `init` 과 `smoke` 가 같은 저장소를 반대로 읽는 것을 끝낸다. 충돌의 기준은 **표기가 아니라 가리키는 곳**이고, 그 규칙은 한 곳에만 있어야 한다.
- **방식**:
  - `install/smoke.mjs` 가 판정 함수 하나를 `export` 한다 — `(tree, value) => boolean`, "이 값이 `<tree>/.githooks` 를 가리키는가". 내부 구현은 지금 `layerTwo` 가 쓰는 식 그대로다(`normalize(resolve(tree, value)) === normalize(join(tree, ".githooks"))`).
  - `smoke.mjs` 의 `layerTwo` 와 `init.mjs` 의 `hooksPathStep` **둘 다** 그 함수를 쓴다. 어느 쪽에도 같은 식을 두 번 적지 않는다.
  - 새 모듈을 만들지 않는다. `init.mjs` 는 이미 `smoke.mjs` 에서 넷(`BROKEN`·`COMMITTED_CHECK`·`inspect`·`report`)을 import 하고 있으므로 의존 방향이 이미 서 있다.
  - `hooksPathStep` 이 받아만 두고 안 쓰던 `tree` 를 실제로 쓰게 된다.
- **주의**:
  - **디렉터리 실재 여부는 판정에 넣지 않는다.** `<A>/.githooks` 가 아직 없어도 충돌이 아니고(곧 우리가 만든다), `.husky/_` 가 지금 없어도 충돌이다. husky 는 `prepare` 가 `npm install` 때 `.husky` 를 되살리므로 "없다"는 "안 쓴다"가 아니다.
  - **가리키는 곳이 같고 철자만 다르면 `state: "same"` 이다** — `.githooks` 로 다시 쓰지 않는다. `apply` 는 `state === "same"` 인 step 을 건너뛰므로, 이 판정만 맞으면 A 의 절대경로 표기는 그대로 남는다. 두 표기는 같은 뜻이 아니다(아래 `## 버린 대안`).
  - `init.mjs` 의 자기 `normalize` 는 `main()` 의 self-check(`process.argv[1]` 비교)가 계속 쓰므로 **지우지 않는다.** 없애는 것은 `hooksPathStep` 안의 중복 비교식뿐이다.
  - `smoke` 의 층 2 검사는 **동작이 바뀌지 않는다.** 같은 판정을 함수 뒤로 옮기는 것뿐이고, 기존 `smoke` 테스트가 전부 그대로 통과해야 한다.
- **인수기준**: `plan(tree, git)` 이 `core.hooksPath` 값에 따라 아래를 낸다. 표의 `<abs>` 는 `join(tree, ".githooks")` 가 준 값이다 — 구분자가 플랫폼마다 다르므로 리터럴로 적지 않는다.

  | `core.hooksPath` | `blockers` | hooksPath step 의 `state` |
  |---|:---:|---|
  | 설정되지 않음 | 0개 | `set` |
  | `.githooks` | 0개 | `same` |
  | `./.githooks` | 0개 | `same` |
  | `<abs>` | 0개 | `same` |
  | `.husky/_` | 1개 | `conflict` |

  - 위 다섯 줄은 **`<tree>/.githooks` 디렉터리가 실재하든 안 하든 동일하다.**
  - `.husky/_` 는 **그 디렉터리가 실재하든 안 하든** `conflict` 다.
  - `<abs>` 로 `plan` 을 돌렸을 때 반환된 step 중 `kind: "config"` 인 것의 `state` 는 `same` 이고, 같은 저장소에 `apply` 를 돌리면 **`git config` 를 호출하지 않는다**(호출 목록에 `["config","--local","core.hooksPath",...]` 가 없다).
  - `.husky/_` 로 `apply` 를 돌리면 `applied` 가 빈 배열이고 `.claude/hooks/path-ownership.mjs` 가 생기지 않는다(기존 동작 유지).
  - 판정식은 저장소에 **한 번만** 나타난다 — `install/` 안에서 `resolve(` 로 `.githooks` 를 푸는 비교가 `smoke.mjs` 의 export 된 함수 안에만 있다.

### 기능: 진짜 충돌일 때의 메시지에서 단정을 빼고 처방을 붙인다

- **의도**: 지금 메시지는 **확인하지 않은 사실을 단정한다** — `(husky·lefthook 을 쓰고 있을 것이다)`. 막힌 사람은 그 말을 믿고 없는 husky 를 찾으러 간다. 그리고 무엇을 해야 풀리는지 한 줄도 없다.
- **방식**:
  - 원인 추정을 **가능성**으로 낮춘다. husky·lefthook 을 예로 드는 것은 유용하니 남기되, "쓰고 있을 것이다" 같은 단정문으로 쓰지 않는다.
  - 사람이 취할 조치를 **한 줄** 붙인다. `posttest` 충돌이 이미 쓰는 어법(*"직접 이어 붙여라"*)에 맞춘다 — 그쪽 훅에서 하네스의 것을 부르게 잇거나, 그쪽을 걷어내고 `core.hooksPath` 를 지운 뒤 `harness init` 을 다시 돌린다.
- **주의**: **가리키는 디렉터리가 실재하는지를 메시지에 찍지 않는다.** 판정에 쓰지 않기로 한 사실을 출력에 얹으면 읽는 사람은 그것을 근거로 행동한다("없다니 그냥 빼앗아도 되겠네"). 판정과 출력이 보는 사실은 같아야 한다.
- **인수기준**:
  - `.husky/_` 로 `plan` 했을 때 `blockers[0].detail` 이 현재 값 `.husky/_` 를 그대로 포함한다.
  - 그 `detail` 이 `harness init` 을 다시 돌리라는 처방을 포함한다(문자열 `harness init` 이 들어 있다).
  - **`<tree>/.husky/_` 를 실제로 만든 뒤 같은 `plan` 을 돌린 `detail` 이, 만들지 않았을 때의 `detail` 과 문자열까지 완전히 동일하다.**
  - `detail` 에 `쓰고 있을 것이다` 라는 문구가 없다.
  - 충돌이 아닌 경우(위 기능의 `same`·`set` 다섯 줄)에는 `blockers` 가 비어 있어 이 메시지가 아예 만들어지지 않는다.

### 기능: `docs/implementation.md` 의 두 행을 판정에 맞춘다

- **의도**: 그 문서는 **남의 저장소에 하네스를 세우는 절차**다. 거기 적힌 충돌 조건이 코드보다 좁으면, 읽는 사람은 절대경로 저장소가 왜 막혔는지 문서에서 답을 못 찾는다. 낡은 사본은 없는 것보다 나쁘다.
- **방식**: 두 곳을 고친다.
  - `### 있는 것을 빼앗지 않는다` 표의 행 — 지금 `` `core.hooksPath` 가 husky·lefthook 을 가리킨다 ``. 조건을 **"`<A>/.githooks` 가 아닌 곳을 가리킨다"** 로 바꾸고, **절대경로로 우리 `.githooks` 를 가리키는 것은 충돌이 아니라는 것**을 같은 행에 명시한다.
  - 문서 끝 트러블슈팅 표의 행 — 지금 `` `init` 이 멈추고 `core.hooksPath` 를 말한다 `` → `husky·lefthook 이 이미 차지했다`. 같은 기준으로 고치고, 처방이 위 기능의 메시지와 어긋나지 않게 한다.
- **주의**: `docs/measured.md` 는 **건드리지 않는다.** 이번에 새로 잰 것이 없다 — 48행의 실측이 이미 이 결론이고, 그것이 한쪽에만 반영돼 있었을 뿐이다.
- **인수기준**:
  - `docs/implementation.md` 에 `husky·lefthook 을 가리킨다` 와 `husky·lefthook 이 이미 차지했다` 라는 표현이 남아 있지 않다.
  - 두 행 모두에서 충돌 조건이 **가리키는 곳**으로 서술된다 — 절대/상대 같은 **표기**를 충돌 근거로 적은 문장이 없다.
  - 위쪽 표의 행이 "우리 `.githooks` 를 절대경로로 가리키는 것은 충돌이 아니다"를 명시한다.
  - 트러블슈팅 행이 사람에게 무엇을 하라고 하는지, 위 기능의 `detail` 이 안내하는 것과 같다.

## 버린 대안

- **디렉터리가 실재하지 않으면 빼앗는다.** eznote-front 가 딱 그 모양이라 유혹이 있었다. 그러나 husky 는 `prepare` 스크립트가 `npm install` 때 `.husky` 를 **다시 만든다** — 갓 클론한 저장소에서 그 디렉터리가 없는 것은 "husky 를 안 쓴다"가 아니라 "아직 설치 전"이다. 없다는 이유로 빼앗으면 다음 `npm install` 에서 한쪽이 다른 쪽을 덮고, 어느 쪽이든 **조용하다.** 그리고 eznote-front 는 **이 예외 없이도 풀린다** — 가리키는 곳이 남이 아니라 우리 자신이기 때문이다.
- **가리키는 곳이 같으면 `.githooks` 로 다시 써서 표기를 통일한다.** 두 표기는 같은 뜻이 아니다. `docs/measured.md:48` 대로 상대 `.githooks` 는 **링크된 worktree 안에서 그 사본의 훅**을 부르고, 절대경로는 본체 것을 부른다. 이 저장소가 절대경로를 쓰는 것이 바로 그 의도다(`.claude/hooks/harness-config.mjs:19`). 둘 다 성립하므로 A 가 골라 둔 쪽을 설치 도구가 뒤집을 근거가 없고, 그것이 `init.mjs` 머리주석이 내건 **"덮어쓰지 않는다"** 원칙이다.
- **판정을 새 모듈 `install/hooks-path.mjs` 로 뺀다.** `init` → `smoke` 의존이 이미 서 있어 새로 생기는 것이 없고, 함수 하나 때문에 **아무도 안 찾는 집**이 하나 는다. 이 판정의 원래 주인은 `smoke` 의 층 2 검사다.
- **충돌 메시지에 "그 디렉터리는 지금 없다" 같은 관찰을 같이 찍는다.** 존재 여부를 판정에서 뺀 결정과 어긋난다. 판정에 안 쓰는 사실을 출력하면 읽는 사람이 그것을 근거로 행동한다.
- **`.githooks/` 안에 A 의 기존 훅이 있으면 막는다.** 실재하는 구멍이다 — `init.mjs:94-96` 은 A 가 직접 만든 `.githooks/pre-commit` 을 `state: "update"` 로 보고 아무 말 없이 우리 shim 으로 덮는다. 그러나 이번 task 에 넣지 않는다. `docs/backlog.md` 의 **"충돌 전수(survey) 확장"** 이 정확히 이것을 짚고 있고, 거기서 함께 드러나는 `.claude/hooks/*.mjs`·`agents/*.md` 이름 충돌까지 **같은 성질**이라 `.githooks` 만 급히 막으면 나머지 절반은 여전히 조용히 덮인다. 이번 버그는 "판정이 두 곳에 따로 적혀 어긋났다" 이고 저것은 "충돌 목록이 좁다" 라 원인이 다르다.
- **`reap-worktrees.mjs` 까지 포함해 `normalize` 를 한 곳으로 모은다.** 세 벌 있는 것은 사실이나(`init.mjs:389`·`smoke.mjs:747`·`reap-worktrees.mjs`), 다른 파일을 여는 값이 이 버그와 무관하다.

## 범위 밖

- **`C:\Users\enliple\projects\eznote-front` 를 고치지 않는다.** 사용자가 명시적으로 제외했다. 이 task 의 산출물은 하네스 수정 하나이고, 그 저장소를 다시 설치할지는 사람이 정한다.
- `.githooks/`·`.claude/hooks/`·`.claude/agents/` 안의 **기존 파일**을 덮는 것에 대한 보호(위 `## 버린 대안` 참고 — backlog 항목이다).
- `reap-worktrees.mjs` 의 `normalize` 통합.
- `docs/measured.md` 수정.
- `smoke` 층 2 검사의 **동작** 변경. 판정을 함수 뒤로 옮기는 리팩터일 뿐이고, 기존 `install/smoke.test.mjs` 는 한 줄도 안 고치고 통과해야 한다.
- `core.hooksPath` 를 `--global`·`--system` 에서 읽는 것. 지금도 `--local` 만 보고, 그 범위를 넓히는 것은 별개 결정이다.

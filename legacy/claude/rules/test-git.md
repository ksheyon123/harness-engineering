---
paths:
  - "**/*.test.{ts,tsx,js,mjs}"
  - "**/*.spec.{ts,tsx,js,mjs}"
---

# 테스트에서 git 을 호출할 때

테스트가 임시 저장소(픽스처)를 겨냥해 git 을 부를 때는 아래를 지킨다. **`scripts/gate.mjs` 가 이미
`GIT_*` 를 씻어서 자식을 스폰하므로 게이트를 거치는 경로는 덮여 있다.** 이 규칙은 그 바깥
(개발자가 직접 돌리는 러너, CI, 에디터 통합)을 위한 이중 방어다.

## 1. 자식 env 에서 `GIT_*` 를 제거한다

```js
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
execFileSync("git", ["init", "-q", tmp], { env: ENV });
```

접두어 전체를 지운다. 개별 지정(denylist)은 **fail-open** 이다 — `GIT_DIR` 만 막아도
`GIT_WORK_TREE`·`GIT_INDEX_FILE`·`GIT_COMMON_DIR`·`GIT_OBJECT_DIRECTORY`·
`GIT_ALTERNATE_OBJECT_DIRECTORIES`·`GIT_NAMESPACE`·`GIT_CEILING_DIRECTORIES` 가 각자 다른 방식으로
대상 저장소를 바꾼다.

## 2. `-C` 와 `cwd` 는 `GIT_DIR` 을 이기지 못한다

`git -C <tmp>` 는 **작업 디렉터리만** 바꾼다. `GIT_DIR` 이 설정돼 있으면 git 은 저장소 탐색을
아예 건너뛰므로 `-C` 도 `{ cwd }` 도 대상을 바꾸지 못한다. 경로를 정확히 줬다는 사실은
안전의 근거가 되지 않는다 — 환경변수가 그 위에 있다.

## 3. 픽스처를 만든 직후 대상을 단언한다

```js
const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: tmp, env: ENV })
  .toString()
  .trim();
if (resolve(top) !== resolve(tmp)) throw new Error(`픽스처가 아닌 저장소를 가리킨다: ${top}`);
```

단언 없이 진행하면 실패가 조용하다 — 테스트는 통과하고, 대신 **개발자의 저장소가 바뀐다.**

## 4. 커밋을 만든다면 신원을 픽스처에 설정한다

`GIT_AUTHOR_*`/`GIT_COMMITTER_*` 도 함께 사라지므로, 픽스처 저장소에 `user.name`/`user.email` 을
직접 설정한다(`git -c user.email=... -c user.name=...` 또는 `git config`). 훅 실행자의 신원이
테스트 픽스처로 새어 들어가지 않는 것이 옳은 방향이다.

## 5. 방어를 검증하는 테스트는 git 을 조작하지 않는다

환경 격리 자체를 검증할 때는 실제 git 호출 대신 자식이 본 환경변수만 확인한다
(`scripts/gate-env.test.mjs` 참고). 사고를 재현하려다 사고를 내지 않는다.

<!--
  근거: BACKLOG #9. 게이트가 git 훅 안에서 돌던 중 픽스처를 겨냥한 테스트가 이 저장소를
  bare 로 재초기화하고 main 을 픽스처 커밋으로 덮었다. 방어가 테스트 파일 하나 안에만 있었고,
  그 파일에 방어를 넣기 *전에* 한 번 실행된 것이 원인이다.
-->

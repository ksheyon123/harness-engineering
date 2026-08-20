---
generated: 2026-08-20
spec: harness/fix-hookspath-compare/spec.md
---

# QA 커버리지 체크리스트 — fix-hookspath-compare

## 요약
인수기준 18개 — ✅ 17 · △ 1 · ❌ 0

## 커버리지 매트릭스

| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|
| 판정 통일 | `core.hooksPath` 미설정 → `blockers` 0개, step `state: "set"` (`.githooks` 실재·미실재 양쪽) | ✅ | `install/init.test.mjs > core.hooksPath 는 표기가 아니라 가리키는 곳으로 판정한다 > .githooks 가 아직 없다/이미 있다 > "설정되지 않았으면 우리가 심는다"` | — |
| 판정 통일 | `.githooks` / `./.githooks` → `blockers` 0개, `state: "same"` | ✅ | `install/init.test.mjs > ... > "`%s` 는 같은 곳이라 건드릴 것이 없다"` (it.each) | — |
| 판정 통일 | `<abs>`(`join(tree, ".githooks")`) → `blockers` 0개, `state: "same"` | ✅ | `install/init.test.mjs > ... > "절대경로로 우리 `.githooks` 를 가리키는 것도 같은 곳이다"` | — |
| 판정 통일 | `.husky/_` → `blockers` 1개, `state: "conflict"` | ✅ | `install/init.test.mjs > ... > "남의 곳을 가리키면 멈춘다"` 및 `"core.hooksPath` 가 남의 것이면 멈춘다"` | — |
| 판정 통일 | 위 다섯 줄은 `<tree>/.githooks` 디렉터리 실재 여부와 무관하게 동일하다 | ✅ | `install/init.test.mjs:139-172` — `describe("`.githooks` 가 아직 없다")`·`describe("`.githooks` 가 이미 있다")` 두 케이스로 위 네 항목을 각각 반복 | — |
| 판정 통일 | `.husky/_` 는 그 디렉터리 실재 여부와 무관하게 항상 conflict | ✅ | `install/init.test.mjs > "`.husky/_` 가 실재해도 안 해도 충돌이다 — 없다는 것은 안 쓴다는 뜻이 아니다"` | — |
| 판정 통일 | `<abs>` 로 `plan` 시 `kind:"config"` step 의 `state` 는 `same`, 같은 저장소에 `apply` 시 `git config` 호출 없음 | ✅ | `install/init.test.mjs > "절대경로면 `git config` 로 다시 쓰지 않는다 — A 가 고른 표기를 뒤집지 않는다"` | — |
| 판정 통일 | `.husky/_` 로 `apply` 시 `applied` 빈 배열, `.claude/hooks/path-ownership.mjs` 안 생김 | ✅ | `install/init.test.mjs > "멈췄으면 아무것도 만들지 않는다"` | — |
| 판정 통일 | 판정식이 저장소에 한 번만 나타난다 (`resolve(` + `.githooks` 조합이 `smoke.mjs` 에만) | ✅ | `install/init.test.mjs > "판정식은 저장소에 한 번만 있다"` — `hits[0].startsWith("smoke.mjs:")` 검사 | — |
| 메시지 처방화 | `.husky/_` 로 `plan` 시 `blockers[0].detail` 이 현재 값 `.husky/_` 를 그대로 포함 | ✅ | `install/init.test.mjs > 충돌 메시지는 단정하지 않고 처방한다 > "현재 값을 그대로 보여준다"` | — |
| 메시지 처방화 | `detail` 이 `harness init` 재실행 처방을 포함 | ✅ | `install/init.test.mjs > ... > "무엇을 해야 풀리는지 말한다"` | — |
| 메시지 처방화 | `<tree>/.husky/_` 실재/미실재와 무관하게 `detail` 문자열이 완전히 동일 | ✅ | `install/init.test.mjs > ... > "가리키는 디렉터리의 실재 여부를 찍지 않는다"` — `detail(...만든 것)`과 `detail(tree())` 를 `toBe` 로 완전 동일 비교 | — |
| 메시지 처방화 | `detail` 에 `쓰고 있을 것이다` 문구가 없다 | ✅ | `install/init.test.mjs > ... > "확인하지 않은 사실을 단정하지 않는다"` — 소스도 `install/init.mjs:278` 에서 `"쓰는 것이 있을 수 있다"` 로 되어 있어 단정문이 아님을 확인 | — |
| 메시지 처방화 | 충돌 아닌 경우(`same`·`set` 다섯 줄) `blockers` 가 비어 이 메시지가 만들어지지 않는다 | ✅ | `install/init.test.mjs > ... > "충돌이 아니면 아예 만들어지지 않는다"` | — |
| 문서 정합 | `docs/implementation.md` 에 `husky·lefthook 을 가리킨다`·`husky·lefthook 이 이미 차지했다` 표현이 남아있지 않다 | ✅ | `install/init.test.mjs > docs/implementation.md 가 판정과 같은 것을 말한다 > "husky·lefthook 을 충돌의 조건으로 적지 않는다"` | — |
| 문서 정합 | 두 행 모두에서 충돌 조건이 **가리키는 곳**으로 서술되고, 절대/상대 표기를 근거로 적은 문장이 없다 | △ | `install/init.test.mjs > ... > "충돌 조건을 가리키는 곳으로 적는다"` — `row("빼앗으면 A 의 기존 훅")`(있는 것을 빼앗지 않는다 표) 한 행만 `가리키는 곳` 문구 존재를 검사한다. 트러블슈팅 표 행(`row("`init` 이 멈추고 `core.hooksPath`")`, `docs/implementation.md:191`)은 `"트러블슈팅 행의 처방이 `init` 이 찍는 것과 같다"` 테스트에서 `harness init`·`unset`·`이어 붙` 세 문구만 검사하고, `가리키는 곳` 표현이나 절대/상대를 근거로 삼지 않는지는 검사하지 않는다 | developer 에게 트러블슈팅 행에도 `가리키는 곳`/절대·상대 비근거 검증을 추가하도록 요청 |
| 문서 정합 | 위쪽 표(`있는 것을 빼앗지 않는다`)의 행이 "절대경로로 우리 `.githooks` 를 가리키는 것은 충돌이 아니다"를 명시 | ✅ | `install/init.test.mjs > ... > "절대경로로 우리 `.githooks` 를 가리키는 것은 충돌이 아님을 명시한다"` | — |
| 문서 정합 | 트러블슈팅 행의 처방이 위 기능(`hooksPathStep`)의 `detail` 이 안내하는 것과 같다(`harness init`·`unset` 명령·`이어 붙` 어법 일치) | ✅ | `install/init.test.mjs > ... > "트러블슈팅 행의 처방이 `init` 이 찍는 것과 같다"` — `plan(tree(), fakeGit(".husky/_")).blockers[0].detail` 과 문서 행을 같은 세 needle 로 대조 | — |

## 사람이 볼 것
- `docs/implementation.md:191` (트러블슈팅 표 행)은 육안으로는 "가리키는 곳" 기준으로 정확히 서술돼 있고 절대/상대를 근거로 쓰지 않는다(`그 값이 <A>/.githooks 아닌 곳을 가리킨다`). 다만 이를 자동으로 고정하는 테스트가 없어, 이후 누군가 그 행을 다시 "절대경로라서/상대경로라서" 식으로 되돌려도 게이트가 잡지 못한다. developer 에게 해당 행에 대한 검증 추가를 요청할지는 사람이 판단.

## 판정하지 못한 것
없음 — spec 의 모든 인수기준 문장에 대응하는 테스트 또는 그 부재를 확인했다.

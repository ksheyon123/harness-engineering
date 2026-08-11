---
generated: 2026-08-11
spec: harness/convex-hull/spec.md
---

# QA 커버리지 체크리스트 — convex-hull

## 요약
인수기준 25개 — ✅ 25 · △ 0 · ❌ 0

러너: `package.json` 의 `scripts.test = "vitest run"`. `vitest.config.mjs` 는 `exclude` 만 지정하고 기본 `include`(`**/*.{test,spec}.?(c|m)[jt]s?(x)`)를 쓰므로 `src/convex-hull.test.mjs` 가 대상에 포함된다.

## 커버리지 매트릭스

| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|
| convexHull — monotone chain | 정사각형 + 내부점(2,2) → 내부점 제외한 정사각형 4꼭짓점 | ✅ | `src/convex-hull.test.mjs > "내부점을 빼고 정사각형 꼭짓점을 CCW 순서로 돌려준다"` | — |
| convexHull — monotone chain | 삼각형은 세 점 그대로 | ✅ | `src/convex-hull.test.mjs > "삼각형은 세 점 그대로다"` | — |
| convexHull — monotone chain | 정사각형+내부점 입력의 순서를 임의로 섞어도 결과 배열 원소 순서까지 동일 | ✅ | `src/convex-hull.test.mjs > "입력 순서를 어떻게 섞어도 결과 배열이 원소 순서까지 같다"` — 5원소 전순열(120가지) 전수 검증 | — |
| convexHull — monotone chain | 변 위 공선점(2,0)은 결과에서 빠진다 | ✅ | `src/convex-hull.test.mjs > "변 위의 공선점은 꼭짓점이 아니므로 빠진다"` | — |
| convexHull — monotone chain | 중복 꼭짓점은 한 번만 실린다(길이 3) | ✅ | `src/convex-hull.test.mjs > "중복된 꼭짓점은 한 번만 실린다"` | — |
| convexHull — monotone chain | 결과 첫 원소는 x 최소, 동률이면 y 최소 | ✅ | `src/convex-hull.test.mjs > "첫 원소는 x 가 최소, 동률이면 y 가 최소인 점이다"` — x=0 동률인 두 점 중 y 최소를 검증 | — |
| convexHull — monotone chain | 결과가 반시계 방향(연속 세 점 외적 > 0, 순환 포함) | ✅ | `src/convex-hull.test.mjs > "결과가 반시계 방향이다"` | — |
| convexHull — monotone chain | 호출 후에도 입력 배열이 변하지 않는다(개수·순서) | ✅ | `src/convex-hull.test.mjs > "호출 후에도 입력 배열이 변하지 않는다"` | — |
| convexHull — monotone chain | 반환 배열은 입력 배열과 다른 참조 | ✅ | `src/convex-hull.test.mjs > "반환 배열은 입력 배열과 다른 참조다"` | — |
| convexHull — monotone chain | 반환 원소는 입력 원소와 같은 참조, 부가 필드(id) 유지 | ✅ | `src/convex-hull.test.mjs > "반환 원소는 입력 원소와 같은 참조이고 부가 필드가 살아 있다"` | — |
| 퇴화 입력 | `convexHull([])` → `[]` | ✅ | `src/convex-hull.test.mjs > "빈 배열은 빈 배열이다"` | — |
| 퇴화 입력 | 점 하나는 그 점 하나 | ✅ | `src/convex-hull.test.mjs > "점 하나는 그 점 하나다"` | — |
| 퇴화 입력 | 전부 같은 점은 길이 1로 접힘 | ✅ | `src/convex-hull.test.mjs > "전부 같은 점이면 하나로 접힌다"` | — |
| 퇴화 입력 | 점 두 개는 x·y 오름차순 반환 | ✅ | `src/convex-hull.test.mjs > "점 두 개는 x·y 오름차순으로 돌려준다"` | — |
| 퇴화 입력 | 공선 3점은 양 끝만 남는다 | ✅ | `src/convex-hull.test.mjs > "공선 3점은 양 끝만 남는다"` | — |
| 퇴화 입력 | 순서를 섞은 공선 4점도 양 끝만 남는다 | ✅ | `src/convex-hull.test.mjs > "순서를 섞은 공선 4점도 양 끝만 남는다"` | — |
| 퇴화 입력 | 수직 공선은 양 끝만 남는다 | ✅ | `src/convex-hull.test.mjs > "수직 공선은 양 끝만 남는다"` | — |
| 퇴화 입력 | 수평 공선은 양 끝만 남는다 | ✅ | `src/convex-hull.test.mjs > "수평 공선은 양 끝만 남는다"` | — |
| TypeError 즉시 실패 | `null`·`undefined`·`"abc"`·`{}` 각각 TypeError | ✅ | `src/convex-hull.test.mjs > "배열이 아닌 값을 거부한다"` — 4가지 모두 개별 assert | — |
| TypeError 즉시 실패 | `[{x:0,y:0}, null]` → TypeError | ✅ | `src/convex-hull.test.mjs > "null 원소를 거부한다"` | — |
| TypeError 즉시 실패 | `[{x:0,y:0}, [1,1]]` → TypeError | ✅ | `src/convex-hull.test.mjs > "배열 원소를 거부한다"` | — |
| TypeError 즉시 실패 | `[{x:"0",y:0}]` → TypeError | ✅ | `src/convex-hull.test.mjs > "문자열 좌표를 거부한다"` | — |
| TypeError 즉시 실패 | `NaN`·`Infinity`·`-Infinity` 좌표 각각 TypeError | ✅ | `src/convex-hull.test.mjs > "NaN·Infinity 좌표를 거부한다"` — 세 케이스 모두 개별 assert | — |
| TypeError 즉시 실패 | 에러 메시지에 문제 원소 인덱스(2) 포함 | ✅ | `src/convex-hull.test.mjs > "에러 메시지에 문제 원소의 인덱스가 들어 있다"` | — |
| TypeError 즉시 실패 | x·y 외 부가 속성은 검사 없이 통과, 길이 3 반환 | ✅ | `src/convex-hull.test.mjs > "x·y 외의 부가 속성은 검사하지 않고 통과시킨다"` | — |

## 사람이 볼 것
없음. 모든 인수기준이 spec 에 적힌 입력값·기대값 그대로를 사용하는 테스트로 1:1 대응되어 있다.

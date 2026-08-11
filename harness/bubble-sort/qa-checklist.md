---
generated: 2026-08-11
spec: harness/bubble-sort/spec.md
---

# QA 커버리지 체크리스트 — bubble-sort

## 요약

인수기준 17개 — ✅ 17 · △ 0 · ❌ 0

## 커버리지 매트릭스

| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|
| bubbleSort — 비파괴 정렬 | `bubbleSort([5,3,8,1,9,2])` → `[1,2,3,5,8,9]` | ✅ | `src/bubble-sort.test.mjs > "bubbleSort — 숫자 배열을 오름차순으로 비파괴 정렬한다" > "뒤섞인 배열을 오름차순으로 정렬한다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([])` → `[]` (루프 경계가 음수 길이로 흘러 예외가 나지 않는다) | ✅ | `src/bubble-sort.test.mjs > "..." > "빈 배열은 빈 배열이 된다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([42])` → `[42]` | ✅ | `src/bubble-sort.test.mjs > "..." > "길이 1 배열은 그 값 하나를 담은 배열이 된다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([1,2,3])` → `[1,2,3]` (이미 정렬된 입력) | ✅ | `src/bubble-sort.test.mjs > "..." > "이미 정렬된 입력의 순서를 그대로 둔다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([3,2,1])` → `[1,2,3]` (역순 입력) | ✅ | `src/bubble-sort.test.mjs > "..." > "역순 입력을 오름차순으로 뒤집는다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([3,1,3,2,1])` → `[1,1,2,3,3]` (중복 값 보존, 길이 5 유지) | ✅ | `src/bubble-sort.test.mjs > "..." > "중복 값을 보존하고 길이를 유지한다"` — 결과값과 `toHaveLength(5)` 를 둘 다 검증해 한쪽만 덮어쓰는 교환 버그도 잡는다 | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([0,-5,10,-1])` → `[-5,-1,0,10]` (음수) | ✅ | `src/bubble-sort.test.mjs > "..." > "음수가 섞인 배열을 정렬한다"` | — |
| bubbleSort — 비파괴 정렬 | `bubbleSort([1.5,-0.5,1.25])` → `[-0.5,1.25,1.5]` (소수) | ✅ | `src/bubble-sort.test.mjs > "..." > "소수가 섞인 배열을 정렬한다"` | — |
| bubbleSort — 비파괴 정렬 | 원본 불변: `const a=[3,1,2]; bubbleSort(a);` 후 `a` 는 `[3,1,2]` 그대로다 | ✅ | `src/bubble-sort.test.mjs > "..." > "원본 배열을 바꾸지 않는다"` | — |
| bubbleSort — 비파괴 정렬 | 새 배열: `bubbleSort(a) !== a` 와 `bubbleSort(e) !== e` (빈 배열 포함) 가 참이다 | ✅ | `src/bubble-sort.test.mjs > "..." > "항상 원본과 다른 배열 객체를 반환한다"` — 일반 배열과 빈 배열 둘 다 `.not.toBe()` 로 검증 | — |
| bubbleSort — 비파괴 정렬 | 조기 종료: 이미 오름차순인 길이 50,000 배열을 1초 안에 정렬한다 | ✅ | `src/bubble-sort.test.mjs > "..." > "이미 오름차순인 길이 50,000 배열을 1초 안에 정렬한다"` — `elapsed < 1000` 과 결과 값 검증. spec 의 "버린 대안" 절이 이 간접(시간 상한) 방식을 명시적으로 채택한 검증법이다 | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort('321')` 은 `TypeError` 를 던진다 | ✅ | `src/bubble-sort.test.mjs > "bubbleSort — 배열이 아닌 입력은 TypeError 로 거부한다" > "문자열을 거부한다"` | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort(null)` 은 `TypeError` 를 던진다 | ✅ | `src/bubble-sort.test.mjs > "..." > "null 을 거부한다"` | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort(undefined)` 는 `TypeError` 를 던진다 | ✅ | `src/bubble-sort.test.mjs > "..." > "undefined 를 거부한다"` | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort()` (인자 없음) 은 `TypeError` 를 던진다 | ✅ | `src/bubble-sort.test.mjs > "..." > "인자가 없으면 거부한다"` | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort(123)` 은 `TypeError` 를 던진다 | ✅ | `src/bubble-sort.test.mjs > "..." > "숫자를 거부한다"` | — |
| 배열이 아닌 입력은 TypeError 로 거부 | `bubbleSort({0:1, length:1})` 은 `TypeError` 를 던진다 (유사 배열도 배열이 아니다) | ✅ | `src/bubble-sort.test.mjs > "..." > "유사 배열 객체를 거부한다"` | — |

## 참고 — 인수기준 목록 밖이지만 spec 의 "방식"/"주의" 에 명시돼 테스트가 존재하는 항목

이 둘은 spec 의 `## 인수기준` 불릿에는 없어 위 매트릭스·요약 집계에는 넣지 않았지만, `## 방식`·`## 주의` 에 명시된 하드 요구사항이고 실제로 테스트가 있어 참고로 남긴다.

- **named export, default export 없음** — `src/bubble-sort.test.mjs > "..." > "named export 로 내보내고 default export 는 두지 않는다"` (`typeof bubbleSort === 'function'` 과 `bubbleSortModule.default` 가 `undefined` 인지 검증)
- **`Array.prototype.sort` 미사용** — `src/bubble-sort.test.mjs > "..." > "Array.prototype.sort 를 호출하지 않는다"` (`vi.spyOn(Array.prototype, "sort")` 로 호출 여부 검증)

## 사람이 볼 것

없음 — 17개 인수기준 모두 각각을 정확히 겨냥한 단정문이 있고, 값·길이·불변성·성능 상한까지 개별 검증된다.

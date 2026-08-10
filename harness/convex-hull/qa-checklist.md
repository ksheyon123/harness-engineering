---
generated: 2026-08-10
spec: harness/convex-hull/spec.md
---

# QA 커버리지 체크리스트 — convex-hull

## 요약
인수기준 19개 — ✅ 19 · △ 0 · ❌ 0

러너 확인: `package.json` 의 `scripts.test` = `"vitest run"`. `vitest.config.mjs` 는 `defaultExclude` 만 확장(`.claude/worktrees/**` 제외)하므로 기본 include 패턴(`**/*.{test,spec}.?(c|m)[jt]s?(x)`)이 그대로 적용되고, `src/convex-hull.test.js` 가 잡힌다.

## 커버리지 매트릭스

| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|
| QuickHull 코어 | 정사각형 꼭짓점 4개 + 내부 점 1개 → 정사각형 4점만 반환 | ✅ | `src/convex-hull.test.js > "정사각형 꼭짓점 4개 + 내부 점 1개 → 정사각형 4점만 반환한다"` — `toEqual([p(0,0), p(4,0), p(4,4), p(0,4)])` | — |
| QuickHull 코어 | 원 위의 점 n개(전부 껍질 위) → n점 전부 반환 | ✅ | `src/convex-hull.test.js > "원 위의 점 n 개(전부 껍질 위) → n 점이 전부 반환된다"` — `toHaveLength(CIRCLE.length)` + `toEqual(CIRCLE_CCW)`(12점) | — |
| QuickHull 코어 | 5×5 격자 25점 → 모서리 4점만(공선 변 위 점 제외) | ✅ | `src/convex-hull.test.js > "5×5 격자 25점 → 모서리 4점만 반환한다(변 위의 점은 공선이라 제외)"` — `toHaveLength(4)` + `toEqual([p(0,0),p(4,0),p(4,4),p(0,4)])` | — |
| QuickHull 코어 | 호출 후 입력 배열 length·각 원소 x·y 가 호출 전과 동일(입력 비변형) | ✅ | `src/convex-hull.test.js > "입력 배열과 그 원소를 변형하지 않는다"` — length 및 좌표 스냅샷 전후 비교 | — |
| QuickHull 코어 | 반환된 모든 점은 입력에 존재하는 좌표와 일치(새 좌표 생성 없음) | ✅ | `src/convex-hull.test.js > "반환된 모든 점은 입력에 존재하는 좌표다 — 새 좌표를 만들어내지 않는다"` — 반환 각 점이 입력 좌표 집합에 포함되는지 전수 검사 | — |
| QuickHull 코어 | 입력 크기가 커도 무한재귀·스택오버플로로 죽지 않음(동일 좌표 대량 중복) | ✅ | `src/convex-hull.test.js > "동일 좌표가 대량 중복돼도 무한재귀 없이 정상 반환한다"`(내부점 100중복) + `> "껍질 위에 중복 극점이 대량으로 있어도 무한재귀 없이 정상 반환한다"`(극점 100중복×2) — 둘 다 정상 반환 단언 | — |
| 출력 규약 | `[(0,0),(1,0),(2,0),(2,2),(0,2)]` → `[(0,0),(2,0),(2,2),(0,2)]`, `(1,0)` 없고 length 4 | ✅ | `src/convex-hull.test.js > "변 위의 공선점을 제외한다"` — `toEqual(...)` + `toHaveLength(4)` + `not.toContainEqual(p(1,0))`, 스펙 예시와 입력·기대값 동일 | — |
| 출력 규약 | 첫 원소는 x 최소·(동률 시) y 최소인 꼭짓점 | ✅ | `src/convex-hull.test.js > "첫 원소는 x 최소·(동률 시) y 최소인 꼭짓점이다"` — x=-5 동률 두 점 중 y 최소인 `(-5,-2)` 가 첫 원소임을 단언 | — |
| 출력 규약 | shoelace signed area 양수(CCW) | ✅ | `src/convex-hull.test.js > "shoelace signed area 가 양수다(CCW)"` — CIRCLE·grid5x5·COLLINEAR_ON_EDGE 세 도형에 대해 `signedArea(...)` `toBeGreaterThan(0)` | — |
| 출력 규약 | 마지막 원소가 첫 원소와 같은 좌표가 아님(열림) | ✅ | `src/convex-hull.test.js > "마지막 원소가 첫 원소와 같은 좌표가 아니다(열림)"` — CIRCLE·grid5x5·COLLINEAR_ON_EDGE 각각 `hull.at(-1)` `not.toEqual(hull[0])` | — |
| 출력 규약 | 같은 점 집합을 서로 다른 순서(최소 3가지 순열)로 넣어도 반환이 전부 동일 | ✅ | `src/convex-hull.test.js > "입력 순서를 섞어도 반환 배열이 전부 동일하다"` — 원본·역순·회전·y정렬·x역정렬 5가지 순열 전부 `toEqual(results[0])` | — |
| 출력 규약 | 정사각형 꼭짓점에 중복 좌표(각 2번씩)를 섞어도 반환은 4점 | ✅ | `src/convex-hull.test.js > "중복 좌표가 섞여도 같은 좌표가 두 번 나오지 않는다"` — `[...square, ...square]` 입력에 `toEqual(square)` + `toHaveLength(4)` | — |
| 퇴화 입력 | `[]` → `[]` | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "빈 입력"` — `convexHull([])` `toEqual([])` | — |
| 퇴화 입력 | `[{x:1,y:1}]` → `[{x:1,y:1}]`(length 1) | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "1점"` | — |
| 퇴화 입력 | 서로 다른 두 점 → 그 두 점(length 2), 시작점 규칙 순서 | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "서로 다른 두 점"`(x 로 갈림) + `"두 점 — x 동률이면 y 최소가 먼저"`(y 타이브레이크) — 시작점 규칙의 두 분기 모두 검증 | — |
| 퇴화 입력 | 전부 공선(`(0,0),(1,1),(2,2)`) → 양 끝 두 점만(length 2) | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "전부 공선"` + `"전부 공선 — 입력 순서가 섞여도 양 끝"` — `toEqual([p(0,0), p(2,2)])` | — |
| 퇴화 입력 | 전부 동일점(`(3,3)×3`) → 한 점(length 1) | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "전부 동일점"` — `toEqual([p(3,3)])` | — |
| 퇴화 입력 | 모든 x 가 같은 수직 공선 입력 → 양 끝 두 점(length 2) | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "수직 공선(모든 x 가 같다)"` — `[(0,0),(0,1),(0,2)]` → `toEqual([p(0,0), p(0,2)])`. QuickHull 초기 분할(x 최소=x 최대)이 성립 안 되는 경로를 정확히 겨냥 | — |
| 퇴화 입력 | 위 모든 퇴화 경우에서 throw 하지 않음 | ✅ | `src/convex-hull.test.js > it.each DEGENERATE "%s — throw 하지 않는다"` — DEGENERATE 표의 모든 행(빈 입력·1점·2점×2·전부공선×2·전부동일·수직공선·수평공선)에 대해 `expect(() => convexHull(input)).not.toThrow()` | — |

## 사람이 볼 것
없음. 19개 인수기준 전부 spec 의 구체 예시(좌표·기대 배열·length)와 정확히 일치하는 단언으로 덮여 있고, 각 테스트가 `toEqual`/`toHaveLength`/`not.toContainEqual` 등으로 결과를 정확히 고정한다(범위만 확인하는 느슨한 단언 없음).

부수 관찰(구현 읽기 기반, 판정에는 반영 안 함): `src/convex-hull.js` 는 `hullBetween` 재귀에서 `cross(...) < 0` 필터로 far point 와 공선점(거리 0)을 모두 제외해 spec 의 "무한재귀 방지"·"공선점 제외" 주의사항과 일치하고, `dedupe` 를 껍질 계산 앞에 둬 "중복 극점이 양쪽 분할에 들어가는" 문제를 회피한다. `rotateToStart` 를 별도 정규화 단계로 분리한 것도 spec 이 명시적으로 권고한 방식과 일치한다.

테스트 파일에 스펙이 요구하지 않는 보너스 케이스(수평 공선 행, 극점 대량 중복 케이스, 퇴화 입력 비변형 테스트)가 더 있으나 이는 커버리지를 넓히는 방향이라 문제 삼지 않았다.

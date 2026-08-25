---
generated: 2026-08-25
spec: harness/delaunay/spec.md
---

# QA 커버리지 체크리스트 — 2D 들로네 삼각분할 모듈

## 요약
인수기준 21개 — ✅ 21 · △ 0 · ❌ 0

러너: `package.json` 의 `scripts.test` = `vitest run`. `vitest.config.mjs` 는 `defaultExclude` 만 확장하므로 `src/**/*.test.mjs` 가 그대로 잡힌다. 테스트 파일 5개(`predicates.test.mjs`, `index.test.mjs`, `cavity.test.mjs`, `topology.test.mjs`, `property.test.mjs`) 를 전부 읽었다.

## 커버리지 매트릭스

| 기능 | 인수기준 | 판정 | 근거 | 사람이 시킬 일 |
|---|---|:---:|---|---|
| 기하 술어 | `orient2d(0,0,1,0,0,1)>0`, `orient2d(0,0,0,1,1,0)<0`, `orient2d(0,0,1,1,2,2)===0` | ✅ | `predicates.test.mjs > "orient2d > CCW 는 양수 · CW 는 음수 · 공선은 정확히 0 이다"` — 세 단언 모두 정확히 그 값으로 존재 | — |
| 기하 술어 | CCW 삼각형 `(0,0),(1,0),(0,1)` 기준 `incircle(...,0.2,0.2)>0`, `incircle(...,5,5)<0`, `incircle(...,1,1)===0` | ✅ | `predicates.test.mjs > "incircle > CCW 삼각형 기준으로 내부는 양수다"` · `"외부는 음수다"` · `"외접원 위의 점은 정확히 0 이다"` — 동일 `ccw` 배열로 세 값 모두 검증 | — |
| 기하 술어 | `circumcenter(0,0,2,0,0,2)` 는 `{x:1,y:1}` | ✅ | `predicates.test.mjs > "circumcenter > 직각이등변 삼각형의 외심은 빗변의 중점이다"` — `toEqual({x:1,y:1})` | — |
| 기하 술어 | `circumcenter(0,0,1,1,2,2)` 는 `null` | ✅ | `predicates.test.mjs > "circumcenter > 공선이면 null 이다"` | — |
| 들로네 삼각분할 | 정사각형 4점 → `triangles.length===6`, `hull` 은 네 점 전부·길이 4 | ✅ | `index.test.mjs > "delaunay — 기본 삼각분할 > 정사각형은 삼각형 2개와 네 점짜리 껍질을 낸다"` | — |
| 들로네 삼각분할 | 삼각형 하나 → `triangles.length===3`, `hull.length===3` | ✅ | `index.test.mjs > "delaunay — 기본 삼각분할 > 점 3개는 삼각형 1개다"` | — |
| 들로네 삼각분할 | 모든 삼각형이 CCW 다(임의 입력) | ✅ | `index.test.mjs > "delaunay — 기본 삼각분할 > 모든 삼각형이 CCW 다"`(고정 6점 입력) + `property.test.mjs > "무작위 점 200개 · 시드 %i > 모든 삼각형이 CCW 다"`(시드 1·42, 각 200점) — 고정 예시와 무작위 성질 검증 이중으로 덮는다 | — |
| 들로네 삼각분할 | `halfedges.length===triangles.length` 이고 `halfedges[e]!==-1` 인 모든 `e` 에 `halfedges[halfedges[e]]===e` | ✅ | `index.test.mjs > "delaunay — halfedges > \`triangles\` 와 길이가 같다"` · `"짝 관계가 대칭이다"`(paired>0 도 확인) | — |
| 들로네 삼각분할 | `halfedges[e]===-1` 개수 === `hull.length` | ✅ | `index.test.mjs > "delaunay — halfedges > 짝 없는 반쪽변의 개수가 \`hull.length\` 와 같다"` | — |
| 들로네 삼각분할 | `hull` 은 CCW·첫 원소가 최소 인덱스, 예: 정사각형 → `[0,1,2,3]` | ✅ | `index.test.mjs > "delaunay — hull > CCW 이고 껍질 정점 중 최소 인덱스에서 시작한다"`(정확히 스펙의 예시 입력·기댓값과 동일) + `"내부 점은 껍질에 들어가지 않고, 껍질은 CCW 다"`(부호 있는 넓이로 CCW 검증) + `"최소 인덱스가 껍질 위에 없으면 그다음으로 작은 껍질 정점에서 시작한다"` | — |
| 들로네 삼각분할 | 캐비티 경계가 단순 다각형을 이루지 못하면 `Error`(메시지에 불변식 위반이 드러남) | ✅ | `cavity.test.mjs > "정점 하나만 공유하는 두 삼각형은 던진다"` · `"떨어져 있는 두 삼각형은 던진다"` · `"빈 캐비티는 던진다"` — 모두 `/불변식이 깨졌다/` 매칭. spec 자신이 "깨진 캐비티는 정상 입력으로 재현 불가 → 공개 API 로는 검증 불가"(`cavity.mjs` 주석)라 명시해 유닛 레벨 검증을 정당화한다 | — |
| 축퇴 입력 처리 | `delaunay([])` → `{triangles:[],halfedges:[],hull:[]}` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > 빈 입력은 전부 빈 결과다"` | — |
| 축퇴 입력 처리 | `delaunay([[3,4]])` → `triangles:[]`, `hull:[0]` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > 점 1개는 그 점 하나짜리 껍질이다"` | — |
| 축퇴 입력 처리 | `delaunay([[0,0],[1,1],[2,2]])` → `triangles:[]`, `hull:[0,2]` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > 전부 공선이면 던지지 않고 양 끝점만 껍질로 낸다"` | — |
| 축퇴 입력 처리 | `delaunay([[0,0],[1,0],[1,0],[0,1]])` → 인덱스 2 는 `triangles`·`hull` 어디에도 없고 `triangles.length===3`, 남은 인덱스 `0,1,3` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > 중복점은 계산에서 빠지되 살아남은 점의 원본 인덱스는 그대로다"` — 동일 입력·동일 단언 | — |
| 축퇴 입력 처리 | `delaunay([[0,0],[NaN,1],[2,2]])` 는 `TypeError` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > NaN 좌표는 TypeError 다"` — 동일 입력 | — |
| 축퇴 입력 처리 | `delaunay([[0,0],[1,0],[0,1],"nope"])` 는 `TypeError` | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > 점이 아닌 원소는 TypeError 다"` — 동일 입력 | — |
| 축퇴 입력 처리 | 정사각형 4점(cocircular) 던지지 않고 삼각형 2개(대각선 미단언) | ✅ | `index.test.mjs > "delaunay — 축퇴 입력 > cocircular 4점은 던지지 않고 삼각형 2개를 낸다"` — `triangles.length===6` 만 확인, 대각선 조합은 단언하지 않음(스펙 지시와 일치) | — |
| 성질 기반 검증 | 시드 1·42 각각 200개 무작위 점의 삼각분할에서 어떤 삼각형의 외접원 내부에도 다른 점이 없다 | ✅ | `property.test.mjs > "무작위 점 200개 · 시드 %i > 어떤 삼각형의 외접원 내부에도 다른 점이 없다"`(`describe.each([1,42])`, `N=200`, mulberry32 PRNG 직접 구현, 실패 시 시드·삼각형·점 인덱스가 메시지에 포함) | — |
| 성질 기반 검증 | 같은 검증에서 검사한 삼각형 수가 0 보다 크다 | ✅ | 동일 테스트 내 `expect(triples.length, ...).toBeGreaterThan(0)` 및 `expect(checkedPoints, ...).toBeGreaterThan(0)` | — |
| 성질 기반 검증 | 같은 입력에 `delaunay()` 를 두 번 부르면 완전히 같은 결과(결정적) | ✅ | `property.test.mjs > "무작위 점 200개 · 시드 %i > 같은 입력에 두 번 부르면 완전히 같은 결과다"` — `toEqual` 로 두 번 호출 결과와 최초 결과를 비교 | — |

## 사람이 볼 것
없음. 21개 인수기준 전부 정확한 값(스펙에 적힌 입력·기댓값과 동일)으로 대조되는 테스트가 있다. 스펙에 없는 추가 엣지 케이스(Infinity 좌표, 형태 혼합, 배열 아닌 입력, 근접하지만 다른 좌표, `-0`/`0` 처리 등)도 `index.test.mjs`·`topology.test.mjs` 에 더 있어 커버리지가 스펙보다 넓다 — 감점 요인 아님.

## 판정하지 못한 것
없음. 21개 인수기준 모두 문구가 구체적인 입출력 값으로 적혀 있어 대조가 명확했다.

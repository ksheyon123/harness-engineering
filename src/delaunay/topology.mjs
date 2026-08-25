/**
 * 삼각형 목록 위에서 도는 위상 연산 — 반쪽변 · 껍질 · 수리 패스.
 *
 * `index.mjs` 에서 떼어낸 이유는 **직접 테스트할 수 있어야 하기 때문**이다. 수리 패스가
 * 고치는 상황(껍질 근처가 들로네가 아니거나 점이 통째로 빠지는 것)은 정상 입력으로는
 * 좀처럼 만들어지지 않아서, 공개 API 를 통해서는 그 경로를 검증할 방법이 없다.
 *
 * 여기 나오는 `triangles` 는 전부 **정점 인덱스가 3개씩 평평하게 이어진 배열**이고, 각
 * 삼각형은 **CCW** 다. `pts` 는 그 인덱스로 바로 접근하는 `{x, y}` 배열이다.
 *
 * 이 파일은 공개 API 가 아니다.
 */

import { incircle, orient2d } from "./predicates.mjs";

/** 반쪽변 `e` 다음 반쪽변(같은 삼각형 안). */
export const nextHalfedge = (e) => (e % 3 === 2 ? e - 2 : e + 1);

/** 반쪽변 `e` 이전 반쪽변(같은 삼각형 안). 그 시작점이 `e` 의 대각 정점이다. */
export const prevHalfedge = (e) => (e % 3 === 0 ? e + 2 : e - 1);

/**
 * 변(정점 쌍) → 반쪽변 매핑으로 짝을 한 번에 만든다. 캐비티를 다시 채우는 도중에
 * 갱신하려 들지 않는다 — 그 경로가 실수의 원천이다.
 *
 * @returns {number[]} `triangles` 와 같은 길이. 짝이 없으면 `-1`.
 */
export function buildHalfedges(triangles) {
  const byEdge = new Map();

  for (let e = 0; e < triangles.length; e++) {
    byEdge.set(`${triangles[e]},${triangles[nextHalfedge(e)]}`, e);
  }

  const halfedges = new Array(triangles.length).fill(-1);

  for (let e = 0; e < triangles.length; e++) {
    const opposite = byEdge.get(`${triangles[nextHalfedge(e)]},${triangles[e]}`);
    if (opposite !== undefined) halfedges[e] = opposite;
  }

  return halfedges;
}

/**
 * 껍질은 삼각분할에서 **파생한다** — 짝 없는 반쪽변들을 이어 붙인다. 별도의 convex hull
 * 알고리즘을 쓰면 삼각분할과 어긋날 수 있는 두 번째 출처가 생긴다.
 *
 * 삼각형이 CCW 이므로 짝 없는 반쪽변은 껍질을 CCW 로 돈다. 시작점은 껍질 위 정점 중
 * 인덱스가 가장 작은 것으로 고정한다.
 *
 * @throws {Error} 짝 없는 반쪽변들이 하나의 순환을 이루지 못할 때.
 */
export function buildHull(triangles, halfedges) {
  const next = new Map();

  for (let e = 0; e < halfedges.length; e++) {
    if (halfedges[e] !== -1) continue;
    next.set(triangles[e], triangles[nextHalfedge(e)]);
  }

  if (next.size === 0) return [];

  let start = Infinity;
  for (const u of next.keys()) if (u < start) start = u;

  const hull = [];
  let u = start;

  do {
    hull.push(u);
    u = next.get(u);
  } while (u !== undefined && u !== start && hull.length <= next.size);

  if (hull.length !== next.size) {
    throw new Error(
      `들로네 내부 불변식이 깨졌다: 껍질이 하나의 순환을 이루지 못한다 — ` +
        `짝 없는 반쪽변 ${next.size} 개 중 ${hull.length} 개만 이어진다.`,
    );
  }

  return hull;
}

/**
 * 삼각분할에서 **통째로 빠진 점**을 껍질 바깥의 귀(ear)로 되돌린다.
 *
 * 왜 빠지나: super-triangle 은 유한하다. 껍질 위에 아주 얕게 얹힌 정점 `B`(양옆 `A`, `C`
 * 와 거의 공선이라 외접원이 극단적으로 큰 경우)는 그 외접원이 super-triangle 정점을 품을
 * 수 있고, 그러면 귀 `A-B-C` 가 super-triangle 삼각형으로 대체된다. 그것을 걷어내면
 * **`B` 가 어느 삼각형에도 남지 않는다.**
 *
 * super-triangle 을 키우면 확률이 줄지만 정밀도가 날아가고, 어떤 크기로도 0 이 되지는
 * 않는다. 그래서 크기로 다투는 대신 **빠진 것을 되돌린다**: 빠진 점이 어느 껍질 변
 * `(u,v)` 바깥에 있으면 `(u, m, v)` 를 채워 넣는다. 그 방향이 곧 CCW 다.
 *
 * @param {number[]} triangles 제자리에서 늘어난다.
 * @param {Array<{x: number, y: number}>} pts 인덱스로 바로 접근하는 좌표.
 * @param {number[]} wanted 결과에 반드시 나타나야 하는 정점 인덱스들.
 */
export function fillMissingEars(triangles, pts, wanted) {
  // 한 번에 하나씩 채우므로 빠진 점 수만큼이면 충분하다.
  for (let round = 0; round <= wanted.length; round++) {
    const present = new Set(triangles);
    const missing = wanted.filter((i) => !present.has(i));
    if (missing.length === 0) return;

    const halfedges = buildHalfedges(triangles);
    let added = false;

    for (const m of missing) {
      for (let e = 0; e < halfedges.length && !added; e++) {
        if (halfedges[e] !== -1) continue; // 껍질 변만 본다.

        const u = triangles[e];
        const v = triangles[nextHalfedge(e)];
        const a = pts[u];
        const b = pts[v];
        const p = pts[m];

        // `(u, m, v)` 가 CCW 라는 것이 곧 "m 이 껍질 변 (u,v) 바깥에 있다" 는 뜻이다.
        if (orient2d(a.x, a.y, p.x, p.y, b.x, b.y) <= 0) continue;

        triangles.push(u, m, v);
        added = true;
      }
      if (added) break;
    }

    // 채울 자리를 못 찾았다 — 빠진 점이 껍질 바깥이 아니다. 여기서 할 수 있는 것이 없다.
    if (!added) return;
  }
}

/**
 * Lawson 뒤집기로 **국소 들로네**를 강제한다 — 인접한 두 삼각형이 이루는 사각형에서
 * 대각선이 잘못 그어져 있으면 반대 대각선으로 바꾼다.
 *
 * "모든 내부 변이 국소적으로 들로네이면 삼각분할 전체가 들로네다"(Delaunay lemma). 그래서
 * 이 패스가 끝나면 **어떤 삼각형의 외접원 안에도 다른 점이 없다**는 성질이 선다 —
 * super-triangle 을 얼마나 크게 잡았는지와 무관하게.
 *
 * 뒤집을 때마다 `halfedges` 가 낡으므로 다시 만든다. 뒤집기는 보통 0~몇 번이라 비용이
 * 문제가 되지 않는다.
 *
 * @param {number[]} triangles 제자리에서 고쳐진다.
 * @param {Array<{x: number, y: number}>} pts 인덱스로 바로 접근하는 좌표.
 * @returns {number} 뒤집은 횟수.
 */
export function repairLocalDelaunay(triangles, pts) {
  // 부동소수점 때문에 A→B→A 로 순환할 가능성을 상한으로 닫는다.
  const limit = triangles.length * 4 + 32;
  let flips = 0;

  for (;;) {
    const halfedges = buildHalfedges(triangles);
    let flipped = false;

    for (let e = 0; e < halfedges.length; e++) {
      const o = halfedges[e];
      if (o === -1 || o < e) continue; // 껍질 변은 뒤집을 수 없고, 내부 변은 한 번만 본다.

      // 삼각형 (u, v, w1) 은 CCW 다. w2 는 공유 변 (u,v) 건너편 정점이다.
      const u = triangles[e];
      const v = triangles[nextHalfedge(e)];
      const w1 = triangles[prevHalfedge(e)];
      const w2 = triangles[prevHalfedge(o)];

      const a = pts[u];
      const b = pts[v];
      const c = pts[w1];
      const d = pts[w2];

      if (incircle(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y) <= 0) continue;

      // 사각형 (u, w2, v, w1) 이 볼록할 때만 뒤집을 수 있다. 볼록하지 않은데 뒤집으면
      // 겹치는 삼각형이 생긴다 — 부동소수점으로 판정이 흔들릴 때의 안전장치다.
      if (orient2d(a.x, a.y, d.x, d.y, c.x, c.y) <= 0) continue;
      if (orient2d(d.x, d.y, b.x, b.y, c.x, c.y) <= 0) continue;

      const ta = e - (e % 3);
      const tb = o - (o % 3);
      triangles[ta] = u;
      triangles[ta + 1] = w2;
      triangles[ta + 2] = w1;
      triangles[tb] = w2;
      triangles[tb + 1] = v;
      triangles[tb + 2] = w1;

      flipped = true;
      break; // halfedges 가 낡았다 — 다시 만든다.
    }

    if (!flipped) return flips;
    if (++flips > limit) return flips;
  }
}

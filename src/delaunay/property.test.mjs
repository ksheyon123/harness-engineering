import { describe, expect, it } from "vitest";

import { delaunay } from "./index.mjs";
import { incircle, orient2d } from "./predicates.mjs";

/**
 * 값 고정 테스트만으로는 "green 인데 얕다" 가 된다. 이 모듈이 진짜 들로네를 계산하는지는
 * **성질**로만 확인된다 — 어떤 삼각형의 외접원 안에도 다른 점이 없다.
 *
 * PRNG 는 외부 의존성 없이 테스트 안에 직접 둔다. 고정 시드라 실패했을 때 같은 입력을
 * 그대로 재현할 수 있다.
 */

/** mulberry32 — 32비트 상태의 고정 시드 PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 격자가 아닌 연속 좌표로 뽑는다 — 격자는 cocircular·공선이 과하게 자주 나온다. */
function randomPoints(seed, n) {
  const random = mulberry32(seed);
  const points = new Array(n);
  for (let i = 0; i < n; i++) points[i] = [random(), random()];
  return points;
}

// O(n·삼각형수) 검증이라 N 을 키우면 급격히 느려진다. 200 을 넘기지 않는다.
const N = 200;
const SEEDS = [1, 42];

describe.each(SEEDS)("무작위 점 200개 · 시드 %i", (seed) => {
  const points = randomPoints(seed, N);
  const { triangles, halfedges, hull } = delaunay(points);

  const triples = [];
  for (let t = 0; t < triangles.length; t += 3) {
    triples.push([triangles[t], triangles[t + 1], triangles[t + 2]]);
  }

  it("어떤 삼각형의 외접원 내부에도 다른 점이 없다", () => {
    const violations = [];
    let checkedPoints = 0;

    for (let k = 0; k < triples.length; k++) {
      const [a, b, c] = triples[k];
      const [ax, ay] = points[a];
      const [bx, by] = points[b];
      const [cx, cy] = points[c];

      for (let p = 0; p < points.length; p++) {
        if (p === a || p === b || p === c) continue;
        checkedPoints++;

        // 삼각형은 CCW 라 `> 0` 이 곧 '엄밀히 내부' 다. cocircular 는 정상이므로
        // `>= 0` 으로 하지 않는다.
        const value = incircle(ax, ay, bx, by, cx, cy, points[p][0], points[p][1]);
        if (value > 0) {
          violations.push(
            `시드 ${seed} · 삼각형 #${k} (${a},${b},${c}) 의 외접원이 ` +
              `점 ${p} (${points[p][0]}, ${points[p][1]}) 를 품는다 (incircle=${value})`,
          );
        }
      }
    }

    // 실패했을 때 어느 시드·어느 삼각형·어느 점인지가 메시지에 나와야 한다.
    expect(violations.slice(0, 5)).toEqual([]);

    // 빈 결과를 통과시키는 검증은 검증이 아니다 — 성공한 판정도 값으로 드러낸다.
    expect(triples.length, `시드 ${seed}: 검사한 삼각형 수`).toBeGreaterThan(0);
    expect(checkedPoints, `시드 ${seed}: 검사한 (삼각형, 점) 조합 수`).toBeGreaterThan(0);
  });

  it("모든 삼각형이 CCW 다", () => {
    const bad = triples.filter(([a, b, c]) => {
      return orient2d(...points[a], ...points[b], ...points[c]) <= 0;
    });

    expect(bad.map(([a, b, c]) => `시드 ${seed}: (${a},${b},${c})`)).toEqual([]);
    expect(triples.length).toBeGreaterThan(0);
  });

  it("모든 인덱스가 유효 범위 안이다", () => {
    for (const i of triangles) {
      expect(Number.isInteger(i) && i >= 0 && i < N, `삼각형 인덱스 ${i}`).toBe(true);
    }
    for (const i of hull) {
      expect(Number.isInteger(i) && i >= 0 && i < N, `껍질 인덱스 ${i}`).toBe(true);
    }
    expect(triangles.length % 3).toBe(0);
  });

  it("halfedges 의 짝 관계가 대칭이다", () => {
    expect(halfedges).toHaveLength(triangles.length);

    let paired = 0;
    for (let e = 0; e < halfedges.length; e++) {
      const o = halfedges[e];
      if (o === -1) continue;
      paired++;
      expect(halfedges[o], `시드 ${seed}: 반쪽변 ${e}`).toBe(e);
    }
    expect(paired).toBeGreaterThan(0);
  });

  it("짝 없는 반쪽변의 수가 `hull.length` 와 같다", () => {
    const unpaired = halfedges.filter((h) => h === -1).length;
    expect(unpaired).toBe(hull.length);
    expect(hull.length).toBeGreaterThan(2);
  });

  it("껍질은 CCW 이고 최소 인덱스에서 시작한다", () => {
    expect(hull[0]).toBe(Math.min(...hull));

    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
      const [x1, y1] = points[hull[i]];
      const [x2, y2] = points[hull[(i + 1) % hull.length]];
      area2 += x1 * y2 - x2 * y1;
    }
    expect(area2, `시드 ${seed}: 껍질의 부호 있는 넓이`).toBeGreaterThan(0);
  });

  it("같은 입력에 두 번 부르면 완전히 같은 결과다", () => {
    expect(delaunay(points)).toEqual(delaunay(points));
    expect(delaunay(points)).toEqual({ triangles, halfedges, hull });
  });
});

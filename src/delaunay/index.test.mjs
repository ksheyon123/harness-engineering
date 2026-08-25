import { describe, expect, it } from "vitest";

import { delaunay } from "./index.mjs";
import { orient2d } from "./predicates.mjs";

/** 결과의 각 삼각형을 `[a,b,c]` 로 끊어 준다. */
const asTriples = ({ triangles }) => {
  const out = [];
  for (let t = 0; t < triangles.length; t += 3) {
    out.push([triangles[t], triangles[t + 1], triangles[t + 2]]);
  }
  return out;
};

describe("delaunay — 기본 삼각분할", () => {
  it("정사각형은 삼각형 2개와 네 점짜리 껍질을 낸다", () => {
    const points = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const { triangles, hull } = delaunay(points);

    expect(triangles).toHaveLength(6);
    expect(hull).toHaveLength(4);
    expect([...hull].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("점 3개는 삼각형 1개다", () => {
    const { triangles, hull } = delaunay([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);

    expect(triangles).toHaveLength(3);
    expect(hull).toHaveLength(3);
  });

  it("`{x,y}` 형태도 `[x,y]` 와 같은 결과를 낸다", () => {
    const tuples = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const objects = tuples.map(([x, y]) => ({ x, y }));

    expect(delaunay(objects)).toEqual(delaunay(tuples));
  });

  it("모든 삼각형이 CCW 다", () => {
    const points = [
      [0, 0],
      [3, 0.5],
      [1.2, 2.4],
      [2.8, 3.1],
      [0.4, 1.7],
      [1.9, 1.1],
    ];
    const result = delaunay(points);

    expect(asTriples(result).length).toBeGreaterThan(0);
    for (const [a, b, c] of asTriples(result)) {
      const o = orient2d(...points[a], ...points[b], ...points[c]);
      expect(o, `삼각형 (${a},${b},${c}) 의 방향`).toBeGreaterThan(0);
    }
  });

  it("`triangles` 에 구멍이 남지 않는다", () => {
    const { triangles } = delaunay([
      [0, 0],
      [3, 0.5],
      [1.2, 2.4],
      [2.8, 3.1],
      [0.4, 1.7],
    ]);

    expect(triangles.length % 3).toBe(0);
    for (const i of triangles) {
      expect(Number.isInteger(i) && i >= 0 && i < 5).toBe(true);
    }
  });
});

describe("delaunay — halfedges", () => {
  const points = [
    [0, 0],
    [3, 0.5],
    [1.2, 2.4],
    [2.8, 3.1],
    [0.4, 1.7],
    [1.9, 1.1],
  ];
  const { triangles, halfedges, hull } = delaunay(points);

  it("`triangles` 와 길이가 같다", () => {
    expect(halfedges).toHaveLength(triangles.length);
  });

  it("짝 관계가 대칭이다", () => {
    let paired = 0;
    for (let e = 0; e < halfedges.length; e++) {
      if (halfedges[e] === -1) continue;
      paired++;
      expect(halfedges[halfedges[e]], `반쪽변 ${e}`).toBe(e);
    }
    expect(paired).toBeGreaterThan(0);
  });

  it("짝이 있는 반쪽변은 같은 변을 반대 방향으로 가리킨다", () => {
    const next = (e) => (e % 3 === 2 ? e - 2 : e + 1);
    for (let e = 0; e < halfedges.length; e++) {
      const o = halfedges[e];
      if (o === -1) continue;
      expect([triangles[e], triangles[next(e)]]).toEqual([triangles[next(o)], triangles[o]]);
    }
  });

  it("짝 없는 반쪽변의 개수가 `hull.length` 와 같다", () => {
    const unpaired = halfedges.filter((h) => h === -1).length;
    expect(unpaired).toBe(hull.length);
  });
});

describe("delaunay — hull", () => {
  it("CCW 이고 껍질 정점 중 최소 인덱스에서 시작한다", () => {
    // 좌하 → 우하 → 우상 → 좌상. 인덱스 0 이 껍질 위에 있으므로 거기서 시작한다.
    expect(
      delaunay([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]).hull,
    ).toEqual([0, 1, 2, 3]);
  });

  it("내부 점은 껍질에 들어가지 않고, 껍질은 CCW 다", () => {
    const points = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2], // 내부
    ];
    const { hull } = delaunay(points);

    expect(hull).not.toContain(4);
    expect(hull).toHaveLength(4);

    // CCW 다각형의 부호 있는 넓이는 양수다.
    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
      const [x1, y1] = points[hull[i]];
      const [x2, y2] = points[hull[(i + 1) % hull.length]];
      area2 += x1 * y2 - x2 * y1;
    }
    expect(area2).toBeGreaterThan(0);
  });

  it("최소 인덱스가 껍질 위에 없으면 그다음으로 작은 껍질 정점에서 시작한다", () => {
    const points = [
      [2, 2], // 내부 — 인덱스 0 이지만 껍질이 아니다
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const { hull } = delaunay(points);

    expect(hull[0]).toBe(Math.min(...hull));
    expect(hull[0]).toBe(1);
  });
});

describe("delaunay — 축퇴 입력", () => {
  it("빈 입력은 전부 빈 결과다", () => {
    expect(delaunay([])).toEqual({ triangles: [], halfedges: [], hull: [] });
  });

  it("점 1개는 그 점 하나짜리 껍질이다", () => {
    expect(delaunay([[3, 4]])).toEqual({ triangles: [], halfedges: [], hull: [0] });
  });

  it("점 2개는 양 끝점 껍질이다 (사전순으로 작은 쪽 먼저)", () => {
    expect(delaunay([
      [5, 1],
      [0, 3],
    ])).toEqual({ triangles: [], halfedges: [], hull: [1, 0] });
  });

  it("전부 공선이면 던지지 않고 양 끝점만 껍질로 낸다", () => {
    expect(delaunay([
      [0, 0],
      [1, 1],
      [2, 2],
    ])).toEqual({ triangles: [], halfedges: [], hull: [0, 2] });
  });

  it("공선 입력의 껍질 순서는 입력 순서가 아니라 좌표 사전순이다", () => {
    expect(delaunay([
      [1, 1],
      [2, 2],
      [0, 0],
    ]).hull).toEqual([2, 1]);
  });

  it("수직으로 공선이면 y 가 작은 쪽이 먼저다", () => {
    expect(delaunay([
      [1, 5],
      [1, 0],
      [1, 3],
    ]).hull).toEqual([1, 0]);
  });

  it("중복점은 계산에서 빠지되 살아남은 점의 원본 인덱스는 그대로다", () => {
    const { triangles, hull } = delaunay([
      [0, 0],
      [1, 0],
      [1, 0], // 인덱스 1 과 완전히 같다
      [0, 1],
    ]);

    expect(triangles).toHaveLength(3);
    expect([...triangles].sort((a, b) => a - b)).toEqual([0, 1, 3]);
    expect(triangles).not.toContain(2);
    expect(hull).not.toContain(2);
    expect([...hull].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it("중복을 걷어내고 점이 1개만 남으면 그 원본 인덱스가 껍질이다", () => {
    expect(delaunay([
      [3, 4],
      [3, 4],
      [3, 4],
    ])).toEqual({ triangles: [], halfedges: [], hull: [0] });
  });

  it("근접한(그러나 다른) 좌표는 중복이 아니다", () => {
    const { triangles } = delaunay([
      [0, 0],
      [1, 0],
      [1, 1e-6],
      [0, 1],
    ]);
    // 허용오차를 두지 않으므로 네 점이 전부 살아 있다.
    expect(new Set(triangles).size).toBe(4);
  });

  it("cocircular 4점은 던지지 않고 삼각형 2개를 낸다", () => {
    // 어느 대각선을 택하든 들로네 성질을 만족한다 — 조합은 단언하지 않는다.
    const { triangles } = delaunay([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(triangles).toHaveLength(6);
  });

  it("NaN 좌표는 TypeError 다", () => {
    expect(() => delaunay([
      [0, 0],
      [NaN, 1],
      [2, 2],
    ])).toThrow(TypeError);
  });

  it("Infinity 좌표는 TypeError 다", () => {
    expect(() => delaunay([
      [0, 0],
      [1, 0],
      [Infinity, 2],
    ])).toThrow(TypeError);
  });

  it("점이 아닌 원소는 TypeError 다", () => {
    expect(() => delaunay([
      [0, 0],
      [1, 0],
      [0, 1],
      "nope",
    ])).toThrow(TypeError);
  });

  it("형태가 섞이면 TypeError 다", () => {
    expect(() => delaunay([
      [0, 0],
      { x: 1, y: 0 },
      [0, 1],
    ])).toThrow(TypeError);
  });

  it("배열이 아닌 입력은 TypeError 다", () => {
    expect(() => delaunay(null)).toThrow(TypeError);
    expect(() => delaunay("points")).toThrow(TypeError);
  });

  it("첫 원소가 점이 아니면 TypeError 다", () => {
    expect(() => delaunay([{ a: 1 }, [1, 0], [0, 1]])).toThrow(TypeError);
  });
});

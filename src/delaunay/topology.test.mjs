import { describe, expect, it } from "vitest";

import { orient2d } from "./predicates.mjs";
import {
  buildHalfedges,
  buildHull,
  fillMissingEars,
  nextHalfedge,
  prevHalfedge,
  repairLocalDelaunay,
} from "./topology.mjs";

/** 삼각형 목록이 쓰는 무방향 변들. */
function edgeKeys(triangles) {
  const keys = new Set();
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      keys.add(u < v ? `${u}-${v}` : `${v}-${u}`);
    }
  }
  return keys;
}

describe("nextHalfedge / prevHalfedge", () => {
  it("삼각형 안에서 순환한다", () => {
    expect([0, 1, 2].map(nextHalfedge)).toEqual([1, 2, 0]);
    expect([3, 4, 5].map(nextHalfedge)).toEqual([4, 5, 3]);
    expect([0, 1, 2].map(prevHalfedge)).toEqual([2, 0, 1]);
    expect([3, 4, 5].map(prevHalfedge)).toEqual([5, 3, 4]);
  });
});

describe("buildHalfedges", () => {
  it("삼각형 하나면 짝이 전부 없다", () => {
    expect(buildHalfedges([0, 1, 2])).toEqual([-1, -1, -1]);
  });

  it("공유 변만 짝을 이루고 그 관계는 대칭이다", () => {
    // 정사각형을 대각선 0-2 로 자른 모양.
    const halfedges = buildHalfedges([0, 1, 2, 0, 2, 3]);

    expect(halfedges).toEqual([-1, -1, 3, 2, -1, -1]);
    expect(halfedges[halfedges[2]]).toBe(2);
  });
});

describe("buildHull", () => {
  it("짝 없는 반쪽변을 이어 CCW 껍질을 만든다", () => {
    const triangles = [0, 1, 2, 0, 2, 3];
    expect(buildHull(triangles, buildHalfedges(triangles))).toEqual([0, 1, 2, 3]);
  });

  it("최소 인덱스에서 시작한다", () => {
    // 같은 삼각분할을 다른 회전으로 적어도 시작점은 그대로다.
    const triangles = [1, 2, 0, 2, 3, 0];
    expect(buildHull(triangles, buildHalfedges(triangles))[0]).toBe(0);
  });

  it("삼각형이 없으면 빈 껍질이다", () => {
    expect(buildHull([], [])).toEqual([]);
  });

  it("경계가 하나의 순환이 아니면 던진다", () => {
    // 떨어져 있는 두 삼각형 — 경계 순환이 둘로 갈린다.
    const triangles = [0, 1, 2, 3, 4, 5];
    expect(() => buildHull(triangles, buildHalfedges(triangles))).toThrow(/불변식이 깨졌다/);
  });
});

describe("fillMissingEars", () => {
  it("껍질 바깥으로 빠진 점을 귀로 되돌린다", () => {
    // 1 은 0 과 2 사이에 아주 얕게 얹힌 껍질 정점이다 — super-triangle 이 유한하면
    // 이런 정점의 귀가 통째로 사라질 수 있다.
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: -0.01 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ];
    const triangles = [0, 2, 3]; // 귀 (0,1,2) 가 빠진 상태

    fillMissingEars(triangles, pts, [0, 1, 2, 3]);

    expect(triangles).toHaveLength(6);
    expect(new Set(triangles)).toEqual(new Set([0, 1, 2, 3]));

    // 되돌린 귀도 CCW 여야 한다.
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
      expect(
        orient2d(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y),
        `삼각형 (${a},${b},${c})`,
      ).toBeGreaterThan(0);
    }

    // 껍질도 다시 닫힌다.
    expect(buildHull(triangles, buildHalfedges(triangles))).toEqual([0, 1, 2, 3]);
  });

  it("빠진 점이 없으면 아무것도 바꾸지 않는다", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ];
    const triangles = [0, 1, 2];

    fillMissingEars(triangles, pts, [0, 1, 2]);

    expect(triangles).toEqual([0, 1, 2]);
  });

  it("빠진 점이 껍질 바깥이 아니면 손대지 않는다", () => {
    // 3 은 삼각형 내부다 — 귀로 붙일 자리가 없다. 조용히 잘못 붙이느니 그대로 둔다.
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
    ];
    const triangles = [0, 1, 2];

    fillMissingEars(triangles, pts, [0, 1, 2, 3]);

    expect(triangles).toEqual([0, 1, 2]);
  });
});

describe("repairLocalDelaunay", () => {
  // 사각형 (0,0) (4,0) (5,3) (0,1). 대각선 0-2 는 들로네가 아니다 —
  // 삼각형 (0,1,2) 의 외접원이 점 3 을 품는다.
  const pts = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 5, y: 3 },
    { x: 0, y: 1 },
  ];

  it("들로네가 아닌 대각선을 뒤집는다", () => {
    const triangles = [0, 1, 2, 0, 2, 3];

    const flips = repairLocalDelaunay(triangles, pts);

    expect(flips).toBe(1);
    expect(edgeKeys(triangles).has("1-3")).toBe(true);
    expect(edgeKeys(triangles).has("0-2")).toBe(false);

    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
      expect(
        orient2d(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y),
        `삼각형 (${a},${b},${c})`,
      ).toBeGreaterThan(0);
    }
  });

  it("이미 들로네면 아무것도 뒤집지 않는다", () => {
    const triangles = [2, 3, 1, 3, 0, 1];
    const before = [...triangles];

    expect(repairLocalDelaunay(triangles, pts)).toBe(0);
    expect(triangles).toEqual(before);
  });

  it("cocircular 는 뒤집지 않는다 — `> 0` 이라 무한 순환이 생기지 않는다", () => {
    // 정사각형 네 점은 한 원 위에 있다. 어느 대각선이든 들로네이므로 손대지 않는다.
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const triangles = [0, 1, 2, 0, 2, 3];

    expect(repairLocalDelaunay(triangles, square)).toBe(0);
    expect(triangles).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("껍질 변은 뒤집지 않는다", () => {
    const triangles = [0, 1, 2];
    expect(repairLocalDelaunay(triangles, pts)).toBe(0);
    expect(triangles).toEqual([0, 1, 2]);
  });
});

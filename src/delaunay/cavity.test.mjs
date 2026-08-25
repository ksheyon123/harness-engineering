import { describe, expect, it } from "vitest";

import { cavityBoundary } from "./cavity.mjs";

describe("cavityBoundary", () => {
  it("삼각형 하나면 그 세 변이 그대로 경계다", () => {
    expect(cavityBoundary([[0, 1, 2]])).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  it("변을 공유하는 두 삼각형은 공유 변을 버리고 4각형 경계를 낸다", () => {
    // 정사각형을 대각선 0-2 로 자른 모양. 0→2 와 2→0 이 짝이라 내부 변이다.
    const boundary = cavityBoundary([
      [0, 1, 2],
      [0, 2, 3],
    ]);

    expect(boundary).toHaveLength(4);
    // 닫힌 순환이다: 각 변의 끝이 다음 변의 시작이다.
    for (let i = 0; i < boundary.length; i++) {
      expect(boundary[i][1]).toBe(boundary[(i + 1) % boundary.length][0]);
    }
    expect(new Set(boundary.map(([u]) => u))).toEqual(new Set([0, 1, 2, 3]));
    // 내부 변은 어느 방향으로도 남지 않는다.
    expect(boundary.some(([u, v]) => (u === 0 && v === 2) || (u === 2 && v === 0))).toBe(false);
  });

  it("정점 하나만 공유하는 두 삼각형은 던진다", () => {
    // 정점 2 에서 경계 변이 둘 나간다 — 단순 다각형이 아니다.
    expect(() =>
      cavityBoundary([
        [0, 1, 2],
        [2, 3, 4],
      ]),
    ).toThrow(/불변식이 깨졌다/);
  });

  it("떨어져 있는 두 삼각형은 던진다", () => {
    // 나가는 변은 정점마다 하나씩이지만 순환이 둘로 갈린다.
    expect(() =>
      cavityBoundary([
        [0, 1, 2],
        [3, 4, 5],
      ]),
    ).toThrow(/불변식이 깨졌다/);
  });

  it("빈 캐비티는 던진다", () => {
    expect(() => cavityBoundary([])).toThrow(/불변식이 깨졌다/);
  });
});

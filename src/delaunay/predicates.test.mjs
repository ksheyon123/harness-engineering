import { describe, expect, it } from "vitest";

import { circumcenter, incircle, orient2d } from "./predicates.mjs";
import * as publicApi from "./index.mjs";

describe("orient2d", () => {
  it("CCW 는 양수 · CW 는 음수 · 공선은 정확히 0 이다", () => {
    expect(orient2d(0, 0, 1, 0, 0, 1)).toBeGreaterThan(0);
    expect(orient2d(0, 0, 0, 1, 1, 0)).toBeLessThan(0);
    expect(orient2d(0, 0, 1, 1, 2, 2)).toBe(0);
  });
});

describe("incircle", () => {
  // 인수기준의 CCW 삼각형. 외접원은 중심 (0.5, 0.5) · 반지름 sqrt(0.5) 이고,
  // (1,1) 이 정확히 그 원 위에 있다.
  const ccw = [0, 0, 1, 0, 0, 1];

  it("CCW 삼각형 기준으로 내부는 양수다", () => {
    expect(incircle(...ccw, 0.2, 0.2)).toBeGreaterThan(0);
  });

  it("외부는 음수다", () => {
    expect(incircle(...ccw, 5, 5)).toBeLessThan(0);
  });

  it("외접원 위의 점은 정확히 0 이다", () => {
    expect(incircle(...ccw, 1, 1)).toBe(0);
  });

  it("삼각형을 CW 로 넘기면 부호가 뒤집힌다 (규약 확인)", () => {
    // 주석에 적힌 규약이 실제로 그렇다는 것을 고정한다. 호출부가 방향을
    // 정규화해야 하는 이유가 여기 있다.
    const cw = [0, 0, 0, 1, 1, 0];
    expect(incircle(...cw, 0.2, 0.2)).toBeLessThan(0);
  });
});

describe("circumcenter", () => {
  it("직각이등변 삼각형의 외심은 빗변의 중점이다", () => {
    expect(circumcenter(0, 0, 2, 0, 0, 2)).toEqual({ x: 1, y: 1 });
  });

  it("공선이면 null 이다", () => {
    expect(circumcenter(0, 0, 1, 1, 2, 2)).toBe(null);
  });
});

describe("공개 API 경계", () => {
  it("술어는 index.mjs 로 내보내지 않는다", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["delaunay"]);
  });
});

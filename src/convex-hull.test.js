import { describe, expect, it } from "vitest";

import { convexHull } from "./convex-hull.js";

const p = (x, y) => ({ x, y });

/** shoelace signed area. 양수면 CCW(수학 좌표계). */
function signedArea(hull) {
  let sum = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 반지름 5 원 위의 정수점 12개. 원 위라 어떤 세 점도 공선이 아니다(정확 산술). */
const CIRCLE = [
  p(5, 0),
  p(4, 3),
  p(3, 4),
  p(0, 5),
  p(-3, 4),
  p(-4, 3),
  p(-5, 0),
  p(-4, -3),
  p(-3, -4),
  p(0, -5),
  p(3, -4),
  p(4, -3),
];

/** 원점에서 시작(x 최소 = -5)해 각도가 증가하는 CCW 순서. */
const CIRCLE_CCW = [
  p(-5, 0),
  p(-4, -3),
  p(-3, -4),
  p(0, -5),
  p(3, -4),
  p(4, -3),
  p(5, 0),
  p(4, 3),
  p(3, 4),
  p(0, 5),
  p(-3, 4),
  p(-4, 3),
];

function grid5x5() {
  const points = [];
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) points.push(p(x, y));
  }
  return points;
}

describe("convexHull — QuickHull 코어", () => {
  it("정사각형 꼭짓점 4개 + 내부 점 1개 → 정사각형 4점만 반환한다", () => {
    const input = [p(0, 0), p(4, 0), p(4, 4), p(0, 4), p(2, 2)];

    expect(convexHull(input)).toEqual([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
  });

  it("원 위의 점 n 개(전부 껍질 위) → n 점이 전부 반환된다", () => {
    const hull = convexHull(CIRCLE);

    expect(hull).toHaveLength(CIRCLE.length);
    expect(hull).toEqual(CIRCLE_CCW);
  });

  it("5×5 격자 25점 → 모서리 4점만 반환한다(변 위의 점은 공선이라 제외)", () => {
    const hull = convexHull(grid5x5());

    expect(hull).toHaveLength(4);
    expect(hull).toEqual([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
  });

  it("입력 배열과 그 원소를 변형하지 않는다", () => {
    const input = [p(0, 0), p(4, 0), p(4, 4), p(0, 4), p(2, 2), p(1, 3)];
    const before = input.map(({ x, y }) => ({ x, y }));
    const lengthBefore = input.length;

    convexHull(input);

    expect(input).toHaveLength(lengthBefore);
    expect(input.map(({ x, y }) => ({ x, y }))).toEqual(before);
  });

  it("반환된 모든 점은 입력에 존재하는 좌표다 — 새 좌표를 만들어내지 않는다", () => {
    const input = [...CIRCLE, p(1, 1), p(0, 0), p(-2, 2)];
    const inputKeys = new Set(input.map(({ x, y }) => `${x},${y}`));

    for (const point of convexHull(input)) {
      expect(inputKeys.has(`${point.x},${point.y}`)).toBe(true);
    }
  });

  it("동일 좌표가 대량 중복돼도 무한재귀 없이 정상 반환한다", () => {
    const input = [
      ...Array.from({ length: 100 }, () => p(1, 1)),
      p(0, 0),
      p(2, 0),
      p(2, 2),
      p(0, 2),
    ];

    expect(convexHull(input)).toEqual([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]);
  });

  it("껍질 위에 중복 극점이 대량으로 있어도 무한재귀 없이 정상 반환한다", () => {
    const input = [
      ...Array.from({ length: 100 }, () => p(2, 2)),
      ...Array.from({ length: 100 }, () => p(0, 0)),
      p(2, 0),
      p(0, 2),
    ];

    expect(convexHull(input)).toEqual([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]);
  });
});

describe("출력 규약 — CCW · 열림 · 공선점 제외 · 결정론적 시작점", () => {
  const COLLINEAR_ON_EDGE = [p(0, 0), p(1, 0), p(2, 0), p(2, 2), p(0, 2)];

  it("변 위의 공선점을 제외한다", () => {
    const hull = convexHull(COLLINEAR_ON_EDGE);

    expect(hull).toEqual([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual(p(1, 0));
  });

  it("첫 원소는 x 최소·(동률 시) y 최소인 꼭짓점이다", () => {
    // x 최소가 둘(-5,-2)·(-5,3) 이라 y 로 갈린다.
    const input = [p(-5, 3), p(2, 4), p(-5, -2), p(3, -1), p(0, 0)];

    expect(convexHull(input)[0]).toEqual(p(-5, -2));
  });

  it("shoelace signed area 가 양수다(CCW)", () => {
    expect(signedArea(convexHull(CIRCLE))).toBeGreaterThan(0);
    expect(signedArea(convexHull(grid5x5()))).toBeGreaterThan(0);
    expect(signedArea(convexHull(COLLINEAR_ON_EDGE))).toBeGreaterThan(0);
  });

  it("마지막 원소가 첫 원소와 같은 좌표가 아니다(열림)", () => {
    for (const input of [CIRCLE, grid5x5(), COLLINEAR_ON_EDGE]) {
      const hull = convexHull(input);

      expect(hull.at(-1)).not.toEqual(hull[0]);
    }
  });

  it("입력 순서를 섞어도 반환 배열이 전부 동일하다", () => {
    const base = [...CIRCLE, p(0, 0), p(1, 1), p(-2, -2), p(2, -1)];
    const permutations = [
      base,
      [...base].reverse(),
      [...base.slice(7), ...base.slice(0, 7)],
      [...base].sort((a, b) => a.y - b.y || a.x - b.x),
      [...base].sort((a, b) => b.x - a.x || b.y - a.y),
    ];

    const results = permutations.map((input) => convexHull(input));

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0]).toEqual(CIRCLE_CCW);
  });

  it("중복 좌표가 섞여도 같은 좌표가 두 번 나오지 않는다", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    const hull = convexHull([...square, ...square]);

    expect(hull).toEqual([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]);
    expect(hull).toHaveLength(4);
  });
});

describe("퇴화 입력 — 살아남은 극점을 반환한다", () => {
  const DEGENERATE = [
    ["빈 입력", [], []],
    ["1점", [p(1, 1)], [p(1, 1)]],
    ["서로 다른 두 점", [p(3, 1), p(1, 5)], [p(1, 5), p(3, 1)]],
    [
      "두 점 — x 동률이면 y 최소가 먼저",
      [p(2, 9), p(2, 4)],
      [p(2, 4), p(2, 9)],
    ],
    ["전부 공선", [p(0, 0), p(1, 1), p(2, 2)], [p(0, 0), p(2, 2)]],
    [
      "전부 공선 — 입력 순서가 섞여도 양 끝",
      [p(1, 1), p(2, 2), p(0, 0)],
      [p(0, 0), p(2, 2)],
    ],
    ["전부 동일점", [p(3, 3), p(3, 3), p(3, 3)], [p(3, 3)]],
    ["수직 공선(모든 x 가 같다)", [p(0, 0), p(0, 1), p(0, 2)], [p(0, 0), p(0, 2)]],
    [
      "수평 공선(모든 y 가 같다)",
      [p(0, 0), p(1, 0), p(2, 0)],
      [p(0, 0), p(2, 0)],
    ],
  ];

  it.each(DEGENERATE)("%s", (_name, input, expected) => {
    expect(convexHull(input)).toEqual(expected);
  });

  it.each(DEGENERATE)("%s — throw 하지 않는다", (_name, input) => {
    expect(() => convexHull(input)).not.toThrow();
  });

  it("퇴화 입력에서도 입력을 변형하지 않는다", () => {
    const input = [p(0, 0), p(1, 1), p(2, 2)];
    const before = input.map(({ x, y }) => ({ x, y }));

    convexHull(input);

    expect(input.map(({ x, y }) => ({ x, y }))).toEqual(before);
  });
});

import { describe, expect, it } from "vitest";

import { convexHull } from "./convex-hull.mjs";

/** 연속 세 점(순환 포함)의 외적이 전부 양수인가 — 반시계 방향 판정. */
function isCounterClockwise(hull) {
  if (hull.length < 3) return false;

  return hull.every((a, i) => {
    const b = hull[(i + 1) % hull.length];
    const c = hull[(i + 2) % hull.length];

    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
  });
}

/** 배열의 모든 순열. 5원소까지만 쓴다(120개). */
function permutations(items) {
  if (items.length <= 1) return [items];

  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

const SQUARE_WITH_INNER = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
  { x: 2, y: 2 },
];

const SQUARE_HULL = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe("convexHull — monotone chain 으로 꼭짓점 껍질을 구한다", () => {
  it("내부점을 빼고 정사각형 꼭짓점을 CCW 순서로 돌려준다", () => {
    expect(convexHull(SQUARE_WITH_INNER)).toEqual(SQUARE_HULL);
  });

  it("삼각형은 세 점 그대로다", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("입력 순서를 어떻게 섞어도 결과 배열이 원소 순서까지 같다", () => {
    for (const shuffled of permutations(SQUARE_WITH_INNER)) {
      expect(convexHull(shuffled)).toEqual(SQUARE_HULL);
    }
  });

  it("변 위의 공선점은 꼭짓점이 아니므로 빠진다", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);

    expect(hull).toEqual(SQUARE_HULL);
    expect(hull).not.toContainEqual({ x: 2, y: 0 });
  });

  it("중복된 꼭짓점은 한 번만 실린다", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toHaveLength(3);
  });

  it("첫 원소는 x 가 최소, 동률이면 y 가 최소인 점이다", () => {
    const hull = convexHull([
      { x: 3, y: 1 },
      { x: 0, y: 5 },
      { x: 0, y: 2 },
      { x: 2, y: 4 },
      { x: 1, y: 0 },
    ]);

    expect(hull[0]).toEqual({ x: 0, y: 2 });
  });

  it("결과가 반시계 방향이다", () => {
    expect(isCounterClockwise(convexHull(SQUARE_WITH_INNER))).toBe(true);
    expect(
      isCounterClockwise(
        convexHull([
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 1 },
        ]),
      ),
    ).toBe(true);
    expect(
      isCounterClockwise(
        convexHull([
          { x: -3, y: -1 },
          { x: 0, y: -4 },
          { x: 5, y: 0 },
          { x: 2, y: 3 },
          { x: -2, y: 2 },
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ),
    ).toBe(true);
  });

  it("호출 후에도 입력 배열이 변하지 않는다", () => {
    const input = [...SQUARE_WITH_INNER];
    const before = [...input];

    convexHull(input);

    expect(input).toHaveLength(before.length);
    input.forEach((point, i) => expect(point).toBe(before[i]));
  });

  it("반환 배열은 입력 배열과 다른 참조다", () => {
    const input = [...SQUARE_WITH_INNER];

    expect(convexHull(input)).not.toBe(input);
  });

  it("반환 원소는 입력 원소와 같은 참조이고 부가 필드가 살아 있다", () => {
    const tagged = { x: 0, y: 0, id: "a" };
    const hull = convexHull([tagged, { x: 4, y: 0 }, { x: 0, y: 4 }]);
    const found = hull.find((point) => point.id === "a");

    expect(found).toBe(tagged);
    expect(found.id).toBe("a");
  });
});

describe("convexHull — 퇴화 입력은 살아남는 꼭짓점만 돌려준다", () => {
  it("빈 배열은 빈 배열이다", () => {
    expect(convexHull([])).toEqual([]);
  });

  it("점 하나는 그 점 하나다", () => {
    expect(convexHull([{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
  });

  it("전부 같은 점이면 하나로 접힌다", () => {
    const hull = convexHull([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);

    expect(hull).toEqual([{ x: 1, y: 1 }]);
    expect(hull).toHaveLength(1);
  });

  it("점 두 개는 x·y 오름차순으로 돌려준다", () => {
    expect(
      convexHull([
        { x: 3, y: 3 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it("공선 3점은 양 끝만 남는다", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it("순서를 섞은 공선 4점도 양 끝만 남는다", () => {
    expect(
      convexHull([
        { x: 2, y: 2 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 3, y: 3 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it("수직 공선은 양 끝만 남는다", () => {
    expect(
      convexHull([
        { x: 1, y: 0 },
        { x: 1, y: 5 },
        { x: 1, y: 2 },
      ]),
    ).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 5 },
    ]);
  });

  it("수평 공선은 양 끝만 남는다", () => {
    expect(
      convexHull([
        { x: 5, y: 2 },
        { x: 0, y: 2 },
        { x: 3, y: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 2 },
      { x: 5, y: 2 },
    ]);
  });
});

describe("convexHull — 잘못된 입력은 TypeError 로 즉시 실패한다", () => {
  it("배열이 아닌 값을 거부한다", () => {
    expect(() => convexHull(null)).toThrow(TypeError);
    expect(() => convexHull(undefined)).toThrow(TypeError);
    expect(() => convexHull("abc")).toThrow(TypeError);
    expect(() => convexHull({})).toThrow(TypeError);
  });

  it("null 원소를 거부한다", () => {
    expect(() => convexHull([{ x: 0, y: 0 }, null])).toThrow(TypeError);
  });

  it("배열 원소를 거부한다", () => {
    expect(() => convexHull([{ x: 0, y: 0 }, [1, 1]])).toThrow(TypeError);
  });

  it("문자열 좌표를 거부한다", () => {
    expect(() => convexHull([{ x: "0", y: 0 }])).toThrow(TypeError);
  });

  it("NaN·Infinity 좌표를 거부한다", () => {
    expect(() => convexHull([{ x: NaN, y: 0 }])).toThrow(TypeError);
    expect(() => convexHull([{ x: 0, y: Infinity }])).toThrow(TypeError);
    expect(() => convexHull([{ x: -Infinity, y: 0 }])).toThrow(TypeError);
  });

  it("에러 메시지에 문제 원소의 인덱스가 들어 있다", () => {
    let thrown;

    try {
      convexHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: NaN, y: 2 }]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown.message).toContain("2");
  });

  it("x·y 외의 부가 속성은 검사하지 않고 통과시킨다", () => {
    expect(
      convexHull([
        { x: 0, y: 0, id: "a" },
        { x: 2, y: 0, label: 1 },
        { x: 1, y: 1, meta: {} },
      ]),
    ).toHaveLength(3);
  });
});

import { describe, expect, it, vi } from "vitest";

import * as bubbleSortModule from "./bubble-sort.js";
import { bubbleSort } from "./bubble-sort.js";

describe("bubbleSort — 숫자 배열을 오름차순으로 비파괴 정렬한다", () => {
  it("named export 로 내보내고 default export 는 두지 않는다", () => {
    expect(typeof bubbleSort).toBe("function");
    expect(bubbleSortModule.default).toBeUndefined();
  });

  it("뒤섞인 배열을 오름차순으로 정렬한다", () => {
    expect(bubbleSort([5, 3, 8, 1, 9, 2])).toEqual([1, 2, 3, 5, 8, 9]);
  });

  it("빈 배열은 빈 배열이 된다", () => {
    // 루프 경계가 음수 길이로 흘러 예외가 나지 않아야 한다.
    expect(bubbleSort([])).toEqual([]);
  });

  it("길이 1 배열은 그 값 하나를 담은 배열이 된다", () => {
    expect(bubbleSort([42])).toEqual([42]);
  });

  it("이미 정렬된 입력의 순서를 그대로 둔다", () => {
    expect(bubbleSort([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("역순 입력을 오름차순으로 뒤집는다", () => {
    expect(bubbleSort([3, 2, 1])).toEqual([1, 2, 3]);
  });

  it("중복 값을 보존하고 길이를 유지한다", () => {
    // 교환이 한쪽만 덮어쓰면 값이 복제되면서도 정렬돼 보인다 — 길이와 원소 전체를 본다.
    const sorted = bubbleSort([3, 1, 3, 2, 1]);

    expect(sorted).toEqual([1, 1, 2, 3, 3]);
    expect(sorted).toHaveLength(5);
  });

  it("음수가 섞인 배열을 정렬한다", () => {
    expect(bubbleSort([0, -5, 10, -1])).toEqual([-5, -1, 0, 10]);
  });

  it("소수가 섞인 배열을 정렬한다", () => {
    expect(bubbleSort([1.5, -0.5, 1.25])).toEqual([-0.5, 1.25, 1.5]);
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const a = [3, 1, 2];

    bubbleSort(a);

    expect(a).toEqual([3, 1, 2]);
  });

  it("항상 원본과 다른 배열 객체를 반환한다", () => {
    const a = [3, 1, 2];
    const e = [];

    expect(bubbleSort(a)).not.toBe(a);
    expect(bubbleSort(e)).not.toBe(e);
  });

  it("Array.prototype.sort 를 호출하지 않는다", () => {
    // 결과만 맞으면 값 인수기준은 통과한다 — 이 task 의 관심사는 버블 정렬의 구현이다.
    const spy = vi.spyOn(Array.prototype, "sort");

    try {
      expect(bubbleSort([5, 3, 8, 1, 9, 2])).toEqual([1, 2, 3, 5, 8, 9]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("이미 오름차순인 길이 50,000 배열을 1초 안에 정렬한다", () => {
    // 조기 종료가 없으면 약 2.5x10^9 회 비교가 돌아 이 상한을 넘는다.
    const sorted = Array.from({ length: 50000 }, (_, i) => i);

    const started = Date.now();
    const result = bubbleSort(sorted);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(result).toHaveLength(50000);
    expect(result[0]).toBe(0);
    expect(result[49999]).toBe(49999);
  });
});

describe("bubbleSort — 배열이 아닌 입력은 TypeError 로 거부한다", () => {
  it("문자열을 거부한다", () => {
    // 인덱스 접근과 length 가 있어 배열처럼 굴러가 버린다.
    expect(() => bubbleSort("321")).toThrow(TypeError);
  });

  it("null 을 거부한다", () => {
    expect(() => bubbleSort(null)).toThrow(TypeError);
  });

  it("undefined 를 거부한다", () => {
    expect(() => bubbleSort(undefined)).toThrow(TypeError);
  });

  it("인자가 없으면 거부한다", () => {
    expect(() => bubbleSort()).toThrow(TypeError);
  });

  it("숫자를 거부한다", () => {
    expect(() => bubbleSort(123)).toThrow(TypeError);
  });

  it("유사 배열 객체를 거부한다", () => {
    expect(() => bubbleSort({ 0: 1, length: 1 })).toThrow(TypeError);
  });
});

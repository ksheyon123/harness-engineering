/**
 * 2차원 점 집합의 볼록 껍질을 Andrew 의 monotone chain 으로 구한다.
 *
 * 껍질의 **꼭짓점만** 반시계 방향(y 축이 위로 증가하는 수학 좌표계 기준)으로 돌려준다.
 * 변 위에 놓인 공선점은 꼭짓점이 아니므로 결과에 넣지 않는다 — 그래야 결과가 유일하게
 * 정해진다. 공선 판정에 epsilon 을 두지 않고 외적 부호를 그대로 본다.
 */

/**
 * 세 점의 외적. 양수면 a→b→c 가 좌회전(반시계), 0 이면 공선이다.
 */
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "Array";

  return typeof value;
}

/**
 * 껍질 계산을 시작하기 전에 입력 전체를 검사한다. 부분 결과를 만들지 않는다.
 * 문제가 된 원소의 인덱스를 메시지에 담는다.
 */
function assertPoints(points) {
  if (!Array.isArray(points)) {
    throw new TypeError(
      `convexHull: 점 배열을 받아야 한다 — 받은 값은 ${typeName(points)} 이다.`,
    );
  }

  points.forEach((point, index) => {
    // typeof null === "object" 라 null 을 따로 걸러야 프로퍼티 접근에서
    // 엉뚱한 TypeError 가 나지 않는다.
    if (point === null || typeof point !== "object") {
      throw new TypeError(
        `convexHull: [${index}] 번 원소가 점 객체가 아니다 — ${typeName(point)} 이다.`,
      );
    }

    // typeof NaN === "number" 다. Number.isFinite 라야 NaN·Infinity·-Infinity 가
    // 함께 걸린다. 배열 원소([0, 0])도 x·y 가 undefined 라 여기서 걸린다.
    for (const axis of ["x", "y"]) {
      if (!Number.isFinite(point[axis])) {
        throw new TypeError(
          `convexHull: [${index}] 번 원소의 ${axis} 가 유한한 수가 아니다 — ${String(point[axis])} 이다.`,
        );
      }
    }
  });
}

/**
 * @param {Array<{x: number, y: number}>} points 점 배열. 원소는 그대로 결과에 실린다.
 * @returns {Array<{x: number, y: number}>} 껍질의 꼭짓점(반시계 방향). 항상 새 배열이다.
 * @throws {TypeError} 배열이 아니거나, 원소가 유한한 x·y 를 가진 객체가 아닐 때.
 */
export function convexHull(points) {
  assertPoints(points);

  // sort 는 제자리 정렬이다. 사본을 만들지 않으면 입력 배열의 순서가 훼손된다.
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  // 정렬 후 중복점은 인접하므로 한 번 훑어 접는다. 남기는 것은 먼저 온 원소의
  // 참조 그대로다.
  const distinct = sorted.filter(
    (point, i) =>
      i === 0 || point.x !== sorted[i - 1].x || point.y !== sorted[i - 1].y,
  );

  // 서로 다른 점이 2개 이하면 체인 두 개가 서로를 완전히 포함해 결과가 어긋난다.
  // 일반 경로에 태우기 전에 분기한다. distinct 는 이미 x·y 오름차순이다.
  if (distinct.length <= 2) return distinct;

  const lower = [];
  for (const point of distinct) {
    // `<= 0` 이라야 공선점이 빠진다. `< 0` 이면 결과에 남는다.
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = distinct.length - 1; i >= 0; i -= 1) {
    const point = distinct[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  // 각 체인의 마지막 원소는 다른 체인의 시작점이다. 빼지 않으면 시작점이 두 번 실린다.
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

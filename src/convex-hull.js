// 2D 볼록 껍질 — QuickHull(분할정복).
//
// 출력 규약: CCW(수학 좌표계, y 가 위로) · 열림(첫 점을 끝에 반복하지 않음) ·
// 공선점 제외(껍질 변 위에 있을 뿐인 점은 버린다) · 시작점은 x 최소, 동률이면 y 최소.
//
// 외적은 정확 비교(`< 0` / `> 0`)로만 판정한다. epsilon 도, robust predicate 도 쓰지 않는다.

/** 사전식(x → y) 비교. 시작점 규칙과 far point 동률 해소에 같은 순서를 쓴다. */
function lexLess(a, b) {
  return a.x < b.x || (a.x === b.x && a.y < b.y);
}

/**
 * o→a 에 대한 b 의 외적. 양수면 b 가 왼쪽(CCW), 음수면 오른쪽(CW), 0 이면 공선.
 * 절댓값은 선분 oa 로부터 b 까지의 거리에 비례하므로 far point 선택에 그대로 쓴다.
 */
function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * 좌표가 같은 점을 하나로 줄인다. 입력 순서상 처음 나온 객체를 남긴다.
 *
 * 중복 제거를 껍질 계산 앞에 두는 이유는 둘이다 — 중복된 극점이 양쪽 분할에 모두
 * 들어가 같은 좌표가 두 번 출력되는 것을 막고, 전부 동일점인 입력이 1점으로 접힌다.
 */
function dedupe(points) {
  const seen = new Set();
  const unique = [];
  for (const point of points) {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

/**
 * 선분 p-q 에서 가장 먼 점. 동률이면 사전식으로 작은 점을 택해 입력 순서와
 * 무관하게 같은 점이 뽑히도록 한다.
 */
function farthestFrom(candidates, p, q) {
  let far = candidates[0];
  let best = Math.abs(cross(p, q, far));
  for (let i = 1; i < candidates.length; i++) {
    const r = candidates[i];
    const distance = Math.abs(cross(p, q, r));
    if (distance > best || (distance === best && lexLess(r, far))) {
      far = r;
      best = distance;
    }
  }
  return far;
}

/**
 * p→q 의 **오른쪽**에 있는 후보들(`candidates`)에서 p 와 q 사이의 껍질 꼭짓점을
 * 순서대로 돌려준다. p 와 q 자신은 포함하지 않는다.
 *
 * 재귀에 넘기는 두 집합은 far 를 제외한 **진부분집합**이다 — far 는 자기 자신과의
 * 외적이 0 이라 `< 0` 필터에서 빠지고, 삼각형 내부의 점과 변 위의 공선점도 함께
 * 빠진다. 그래서 후보 수가 매 단계 최소 1 씩 줄고 재귀가 끝난다.
 */
function hullBetween(candidates, p, q) {
  if (candidates.length === 0) return [];

  const far = farthestFrom(candidates, p, q);
  const outsidePFar = candidates.filter((r) => cross(p, far, r) < 0);
  const outsideFarQ = candidates.filter((r) => cross(far, q, r) < 0);

  return [
    ...hullBetween(outsidePFar, p, far),
    far,
    ...hullBetween(outsideFarQ, far, q),
  ];
}

/**
 * 시작점 규칙(x 최소 → y 최소)에 맞게 회전시킨다. 순환 순서는 그대로 두므로 CCW 는
 * 유지된다.
 *
 * QuickHull 의 자연스러운 출력이 이미 극점에서 시작하지만, 분할 순서가 바뀌어도
 * 시작점이 흔들리지 않도록 정규화를 별도 단계로 둔다.
 */
function rotateToStart(hull) {
  let start = 0;
  for (let i = 1; i < hull.length; i++) {
    if (lexLess(hull[i], hull[start])) start = i;
  }
  if (start === 0) return hull;
  return [...hull.slice(start), ...hull.slice(0, start)];
}

/**
 * 2D 점 집합의 볼록 껍질 꼭짓점을 CCW 순서로 돌려준다.
 *
 * 입력 배열도, 그 안의 점 객체도 변형하지 않는다. 반환 배열은 새 배열이고 원소는
 * 입력 객체를 그대로 재사용한다.
 *
 * 퇴화 입력(0·1·2 점, 전부 공선, 전부 동일)에서도 throw 하지 않고 살아남은 극점을
 * 돌려준다.
 *
 * @param {{x: number, y: number}[]} points
 * @returns {{x: number, y: number}[]}
 */
export function convexHull(points) {
  const unique = dedupe(points);
  // 0·1·2 점은 그 자체가 껍질이다. 3 점 이상이어도 전부 공선이면 아래에서 양 끝만 남는다.
  if (unique.length <= 2) return rotateToStart(unique);

  // 사전식 최소/최대는 항상 껍질 꼭짓점이고, 서로 다른 점이 둘 이상이면 서로 다르다.
  // x 가 전부 같은 수직 입력에서도 y 로 갈리므로 초기 분할이 성립한다.
  let left = unique[0];
  let right = unique[0];
  for (const point of unique) {
    if (lexLess(point, left)) left = point;
    if (lexLess(right, point)) right = point;
  }

  // 외적 0 인 점(left-right 선분 위의 공선점)은 어느 쪽에도 넣지 않는다.
  const below = [];
  const above = [];
  for (const point of unique) {
    const side = cross(left, right, point);
    if (side < 0) below.push(point);
    else if (side > 0) above.push(point);
  }

  // 아래쪽을 왼→오른쪽으로, 위쪽을 오른→왼쪽으로 잇는 것이 수학 좌표계의 CCW 다.
  const hull = [
    left,
    ...hullBetween(below, left, right),
    right,
    ...hullBetween(above, right, left),
  ];

  return rotateToStart(hull);
}

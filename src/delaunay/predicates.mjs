/**
 * 기하 술어 — 삼각분할의 모든 판정이 이 파일 위에 선다.
 *
 * 세 점의 방향(`orient2d`)과 네 번째 점이 외접원 안에 있는가(`incircle`), 둘뿐이다.
 * 여기 격리해 두는 이유는 **정밀도 전략이 바뀔 때 이 파일만 바뀌게** 하기 위함이다 —
 * 지금은 배정밀도 부동소수점을 그대로 쓰지만, 적응 정밀도(Shewchuk)로 갈아끼우게 되면
 * 호출부는 손대지 않는다.
 *
 * **이 파일은 공개 API 가 아니다.** `src/delaunay/index.mjs` 의 `export` 에 들어가지
 * 않는다. 같은 패키지 안이므로 테스트는 이 파일을 직접 import 한다.
 */

/**
 * 세 점 `a → b → c` 의 방향.
 *
 * 2×2 행렬식 `(bx-ax)*(cy-ay) - (by-ay)*(cx-ax)` 그대로다.
 *
 * @returns {number} 양수면 CCW(반시계), 음수면 CW(시계), 0 이면 공선.
 */
export function orient2d(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * 점 `d` 가 삼각형 `a, b, c` 의 외접원 안에 있는가.
 *
 * **부호 규약은 인자 삼각형의 방향에 의존한다.** `a, b, c` 가 **CCW** 일 때
 * 양수면 `d` 가 외접원 **내부**, 음수면 외부, 0 이면 원 위다.
 * 호출부가 CW 삼각형을 넘기면 부호가 통째로 뒤집힌다 — 넘기기 전에 CCW 로
 * 정규화하거나, 넘기는 쪽이 방향을 알고 있어야 한다.
 *
 * `d` 를 원점으로 옮긴 뒤 계산한다. 큰 절댓값 좌표를 그대로 곱하면 유효숫자가
 * 빨리 날아가기 때문이다.
 *
 * @returns {number} CCW 삼각형 기준: >0 내부 · =0 원 위 · <0 외부.
 */
export function incircle(ax, ay, bx, by, cx, cy, dx, dy) {
  const adx = ax - dx;
  const ady = ay - dy;
  const bdx = bx - dx;
  const bdy = by - dy;
  const cdx = cx - dx;
  const cdy = cy - dy;

  const alift = adx * adx + ady * ady;
  const blift = bdx * bdx + bdy * bdy;
  const clift = cdx * cdx + cdy * cdy;

  return (
    adx * (bdy * clift - cdy * blift) -
    ady * (bdx * clift - cdx * blift) +
    alift * (bdx * cdy - cdx * bdy)
  );
}

/**
 * 삼각형 `a, b, c` 의 외심.
 *
 * 세 점이 공선이면 분모가 0 이 되므로 그때는 `null` 이다. **호출부가 `null` 을
 * 무시하면 `NaN` 이 조용히 전파된다** — 반드시 검사해라.
 *
 * @returns {{x: number, y: number} | null}
 */
export function circumcenter(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax;
  const dy = by - ay;
  const ex = cx - ax;
  const ey = cy - ay;

  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  const d = 2 * (dx * ey - dy * ex);

  if (d === 0 || !Number.isFinite(d)) return null;

  const x = ax + (ey * bl - dy * cl) / d;
  const y = ay + (dx * cl - ex * bl) / d;

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

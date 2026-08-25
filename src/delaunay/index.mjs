/**
 * 2D 들로네 삼각분할 — 외부 의존성 없는 순수 ESM 모듈.
 *
 * 공개 API 는 `delaunay(points)` 하나다. 클래스가 아니라 함수형이고 상태를 갖지 않는다.
 * 알고리즘은 Bowyer–Watson 점진 삽입이다.
 *
 * `predicates.mjs` · `cavity.mjs` · `topology.mjs` 는 내부 모듈이라 여기서 다시 내보내지
 * 않는다. 테스트는 그 파일들을 직접 import 한다.
 */

import { cavityBoundary } from "./cavity.mjs";
import { incircle, orient2d } from "./predicates.mjs";
import { buildHalfedges, buildHull, fillMissingEars, repairLocalDelaunay } from "./topology.mjs";

/**
 * 점 집합의 들로네 삼각분할.
 *
 * @param {Array<[number, number]> | Array<{x: number, y: number}>} points
 *   `[[x,y], ...]` 또는 `[{x,y}, ...]`. 형태는 **첫 원소로 판정**하고, 섞여 있으면
 *   잘못된 입력이다.
 * @returns {{triangles: number[], halfedges: number[], hull: number[]}}
 *   - `triangles` — 정점 인덱스가 3개씩 평평하게 이어진 배열. 각 삼각형은 **CCW** 다.
 *     인덱스는 **원본 `points` 배열 기준**이다.
 *   - `halfedges` — `triangles` 와 같은 길이. 반쪽변 `e` 의 짝, 없으면 `-1`.
 *     반쪽변 `e` 는 삼각형 `Math.floor(e/3)` 의 정점 `triangles[e]` 에서 시작한다.
 *   - `hull` — 볼록껍질 정점 인덱스. **CCW** 이고 껍질 정점 중 최소 인덱스에서 시작한다.
 * @throws {TypeError} 좌표가 유한한 수가 아니거나, 점이 `[x,y]`/`{x,y}` 어느 형태도 아닐 때.
 * @throws {Error} 내부 불변식(캐비티 경계)이 깨졌을 때.
 */
export function delaunay(points) {
  const normalized = normalizePoints(points);
  // 중복점은 삽입 **전에** 걸러낸다. 중복인 채로 들어가면 캐비티가 비어 경계가 안 나온다.
  // 원본 인덱스는 그대로 들고 다닌다 — 0..k-1 로 다시 매기면 원본 대응이 깨진다.
  const unique = dedupe(normalized);

  if (unique.length === 0) return { triangles: [], halfedges: [], hull: [] };
  if (unique.length === 1) return { triangles: [], halfedges: [], hull: [unique[0].i] };

  // 3점 미만이거나 전부 공선이면 삼각형이 없다. 던지지 않는다 — 호출부에서 흔한 정상 입력이다.
  if (allCollinear(unique)) {
    return { triangles: [], halfedges: [], hull: collinearHull(unique) };
  }

  const triangles = triangulate(unique);

  // super-triangle 은 유한하므로, 그것을 걷어낸 결과가 껍질 근처에서 들로네가 아니거나
  // 얕은 껍질 정점을 통째로 잃을 수 있다. 두 수리 패스가 그것을 되돌린다 — 덕분에
  // **super-triangle 크기 선택과 결과의 정확성이 분리된다**. 근거는 `topology.mjs` 에 있다.
  fillMissingEars(
    triangles,
    normalized,
    unique.map((u) => u.i),
  );
  repairLocalDelaunay(triangles, normalized);

  const halfedges = buildHalfedges(triangles);
  const hull = buildHull(triangles, halfedges);

  return { triangles, halfedges, hull };
}

// ── 입력 정규화 ────────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** `[[x,y], ...]` · `[{x,y}, ...]` 를 `[{x,y}, ...]` 하나로 맞춘다. */
function normalizePoints(points) {
  if (!Array.isArray(points)) {
    throw new TypeError(`delaunay(points): points 는 배열이어야 한다 (받은 것: ${describe(points)}).`);
  }
  if (points.length === 0) return [];

  const first = points[0];
  const tuple = Array.isArray(first);
  if (!tuple && !(isObject(first) && "x" in first && "y" in first)) {
    throw new TypeError(
      `delaunay(points): 점은 [x,y] 또는 {x,y} 여야 한다 (points[0] = ${describe(first)}).`,
    );
  }

  const out = new Array(points.length);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let x;
    let y;

    if (tuple) {
      if (!Array.isArray(p)) {
        throw new TypeError(`delaunay(points): points[${i}] 가 [x,y] 가 아니다 (${describe(p)}).`);
      }
      x = p[0];
      y = p[1];
    } else {
      if (!isObject(p)) {
        throw new TypeError(`delaunay(points): points[${i}] 가 {x,y} 가 아니다 (${describe(p)}).`);
      }
      x = p.x;
      y = p.y;
    }

    // NaN·Infinity 는 프로그래밍 오류다. 조용히 넘기면 결과 전체가 NaN 으로 물든다.
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError(
        `delaunay(points): points[${i}] 의 좌표가 유한한 수가 아니다 (x=${x}, y=${y}).`,
      );
    }

    out[i] = { x, y };
  }

  return out;
}

function describe(v) {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  return typeof v;
}

/**
 * 완전히 같은 좌표(`===`)만 중복으로 본다. 근접 허용오차를 두지 않는다 — 허용오차는
 * 곧 숨은 정책이 되고, 호출부는 자기 점이 왜 사라졌는지 알 수 없다.
 *
 * @returns {Array<{x: number, y: number, i: number}>} 첫 등장 순서 · **원본 인덱스** 유지.
 */
function dedupe(pts) {
  const seen = new Set();
  const out = [];

  for (let i = 0; i < pts.length; i++) {
    // `-0 === 0` 이므로 키에서도 같은 것으로 본다.
    const x = pts[i].x === 0 ? 0 : pts[i].x;
    const y = pts[i].y === 0 ? 0 : pts[i].y;
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y, i });
  }

  return out;
}

/** 판정은 정확히 0 으로 한다. 거의 공선인 입력은 보장 대상이 아니다(범위 밖). */
function allCollinear(unique) {
  if (unique.length < 3) return true;

  const a = unique[0];
  const b = unique[1]; // 중복 제거 뒤라 a 와 다르다.

  for (let k = 2; k < unique.length; k++) {
    const c = unique[k];
    if (orient2d(a.x, a.y, b.x, b.y, c.x, c.y) !== 0) return false;
  }

  return true;
}

/** 공선 집합의 양 끝점. 좌표 사전순(x 우선, 같으면 y)으로 작은 쪽이 먼저다. */
function collinearHull(unique) {
  let lo = unique[0];
  let hi = unique[0];

  for (const p of unique) {
    if (p.x < lo.x || (p.x === lo.x && p.y < lo.y)) lo = p;
    if (p.x > hi.x || (p.x === hi.x && p.y > hi.y)) hi = p;
  }

  return [lo.i, hi.i];
}

// ── Bowyer–Watson ─────────────────────────────────────────────────────────

/**
 * 점진 삽입으로 삼각분할한다.
 *
 * @param {Array<{x: number, y: number, i: number}>} unique 중복이 제거된 점들(3개 이상 · 비공선).
 * @returns {number[]} 원본 인덱스가 3개씩 이어진 CCW 삼각형 배열.
 */
function triangulate(unique) {
  const n = unique.length;
  const xs = new Float64Array(n + 3);
  const ys = new Float64Array(n + 3);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    xs[i] = unique[i].x;
    ys[i] = unique[i].y;
    if (xs[i] < minX) minX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] > maxY) maxY = ys[i];
  }

  // super-triangle 은 바운딩 박스에서 유도한다. 좌표 범위와 무관한 상수(예: 1e9)로 잡으면
  // 정밀도가 날아가고, 너무 작게 잡으면 바깥쪽 점들의 삼각분할이 틀린다.
  //
  // 밑변 `4R` · 높이 `2R` 인 이등변삼각형이고 내접원 반지름이 `0.83R` 이다. 그래서
  // 바운딩 박스(외접원 반지름 ≤ `0.71d`)를 여유롭게 품는다.
  //
  // 배율 `1000` 은 저울질의 결과다. 키우면 super-triangle 정점이 어떤 들로네 외접원에
  // 걸릴 확률이 줄지만 `incircle` 이 4차식이라 유효숫자가 배수로 날아간다. 남는 오차는
  // 수리 패스(`topology.mjs`)가 걷어내므로 **여기서 완벽할 필요는 없다.**
  const d = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const R = 1000 * d;

  xs[n] = midX - 2 * R;
  ys[n] = midY - R; // 좌하
  xs[n + 1] = midX + 2 * R;
  ys[n + 1] = midY - R; // 우하
  xs[n + 2] = midX;
  ys[n + 2] = midY + R; // 상 — 이 순서가 CCW 다.

  /** @type {Array<[number, number, number]>} 언제나 CCW 로 유지한다. */
  let tris = [[n, n + 1, n + 2]];

  for (let p = 0; p < n; p++) {
    const px = xs[p];
    const py = ys[p];

    /** @type {Array<[number, number, number]>} */
    const cavity = [];
    /** @type {Array<[number, number, number]>} */
    const kept = [];

    for (const t of tris) {
      // 삼각형이 CCW 이므로 incircle > 0 이 곧 '외접원 내부' 다.
      const inside =
        incircle(
          xs[t[0]],
          ys[t[0]],
          xs[t[1]],
          ys[t[1]],
          xs[t[2]],
          ys[t[2]],
          px,
          py,
        ) > 0;
      (inside ? cavity : kept).push(t);
    }

    // 경계가 닫힌 단순 다각형이 아니면 여기서 던진다.
    for (const [u, v] of cavityBoundary(cavity)) {
      // 캐비티는 p 에 대해 star-shaped 이므로 (u, v, p) 는 CCW 다. 그래도 검사해서
      // 맞춘다 — 이후 incircle 이 CCW 를 전제하기 때문이다.
      const ccw = orient2d(xs[u], ys[u], xs[v], ys[v], px, py) >= 0;
      kept.push(ccw ? [u, v, p] : [v, u, p]);
    }

    tris = kept;
  }

  // super-triangle 의 세 정점 중 하나라도 쓰는 삼각형을 버리고, 남은 것을 원본 인덱스로
  // 옮긴다. 구멍(`undefined`·`-1`)은 남기지 않는다.
  const out = [];

  for (const t of tris) {
    if (t[0] >= n || t[1] >= n || t[2] >= n) continue;

    let [a, b, c] = t;
    if (orient2d(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) < 0) {
      const swap = b;
      b = c;
      c = swap;
    }

    out.push(unique[a].i, unique[b].i, unique[c].i);
  }

  return out;
}


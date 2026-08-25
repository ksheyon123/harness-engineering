/**
 * 캐비티 경계 추출 — Bowyer–Watson 의 급소.
 *
 * 새 점의 외접원이 품는 삼각형들(캐비티)을 지우고 나면, 그 자리를 다시 채울 **경계**가
 * 필요하다. 캐비티 삼각형들의 변 중 **정확히 한 번만 등장하는 변**이 경계이고, 두 번
 * 등장하는 변은 캐비티 내부라 버린다.
 *
 * 이 계산이 깨지면(경계가 닫힌 단순 다각형을 이루지 못하면) 결과는 삼각분할이 아니게
 * 된다. **조용히 넘어가지 않고 던진다** — 내부 불변식 위반은 버그이지 정상 입력이 아니다.
 *
 * `index.mjs` 에서 분리해 둔 이유는 이것이 **직접 테스트할 수 있어야 하기 때문**이다.
 * 깨진 캐비티는 정상 입력으로는 만들어지지 않으므로, 공개 API 를 통해서는 이 경로를
 * 검증할 방법이 없다.
 *
 * 이 파일은 공개 API 가 아니다.
 */

/** 방향 있는 변의 키. 정점은 정수 인덱스라 문자열 키로 충분하다. */
const key = (u, v) => `${u},${v}`;

/**
 * 캐비티 삼각형들의 경계를 **하나의 닫힌 순환**으로 돌려준다.
 *
 * 입력 삼각형은 전부 **CCW** 여야 한다. 그래야 방향 있는 변 `(u,v)` 가 캐비티 안에서
 * 많아야 한 번 등장하고, 내부 변은 `(u,v)` 와 `(v,u)` 쌍으로 짝지어진다.
 *
 * @param {Array<[number, number, number]>} cavity CCW 삼각형들.
 * @returns {Array<[number, number]>} CCW 순서로 이어진 경계 변들.
 * @throws {Error} 경계가 단순 다각형을 이루지 못할 때.
 */
export function cavityBoundary(cavity) {
  const directed = new Set();
  for (const [a, b, c] of cavity) {
    directed.add(key(a, b));
    directed.add(key(b, c));
    directed.add(key(c, a));
  }

  // 시작 정점 → 끝 정점. 단순 다각형이면 정점마다 나가는 경계 변이 정확히 하나다.
  const next = new Map();
  let count = 0;

  for (const [a, b, c] of cavity) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (directed.has(key(v, u))) continue; // 반대 방향이 있으면 캐비티 내부 변이다.
      if (next.has(u)) {
        throw new Error(
          `들로네 내부 불변식이 깨졌다: 캐비티 경계가 단순 다각형이 아니다 — ` +
            `정점 ${u} 에서 경계 변이 둘 이상 나간다 (${u}→${next.get(u)}, ${u}→${v}).`,
        );
      }
      next.set(u, v);
      count++;
    }
  }

  if (count < 3) {
    throw new Error(
      `들로네 내부 불변식이 깨졌다: 캐비티 경계 변이 ${count} 개뿐이라 다각형을 이루지 못한다.`,
    );
  }

  const start = next.keys().next().value;
  const cycle = [];
  let u = start;

  do {
    const v = next.get(u);
    if (v === undefined) {
      throw new Error(
        `들로네 내부 불변식이 깨졌다: 캐비티 경계가 닫히지 않는다 — 정점 ${u} 에서 끊긴다.`,
      );
    }
    cycle.push([u, v]);
    u = v;
  } while (u !== start && cycle.length <= count);

  if (u !== start || cycle.length !== count) {
    throw new Error(
      `들로네 내부 불변식이 깨졌다: 캐비티 경계가 하나의 순환을 이루지 못한다 — ` +
        `경계 변 ${count} 개 중 ${cycle.length} 개만 이어진다.`,
    );
  }

  return cycle;
}

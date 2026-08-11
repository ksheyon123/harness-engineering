/**
 * 숫자 배열을 오름차순으로 정렬한 **새 배열**을 돌려준다.
 *
 * 비파괴다 — 원본은 읽기만 하고, 복사본 위에서 인접 원소를 비교·교환한다.
 * 한 패스에서 교환이 하나도 없으면 이미 정렬된 것이므로 즉시 끝낸다(정렬된
 * 입력이 O(n) 이 된다).
 *
 * 숫자 배열 전용이다. `compareFn` 을 받지 않고, 요소 타입도 검증하지 않는다.
 *
 * @param {number[]} input 정렬할 배열. 배열이 아니면 `TypeError`.
 * @returns {number[]} 오름차순으로 정렬된 새 배열. 항상 `input` 과 다른 객체다.
 * @throws {TypeError} `input` 이 배열이 아닐 때.
 */
export function bubbleSort(input) {
  // 복사·정렬보다 먼저 판정한다. 문자열·유사 배열은 인덱스와 length 가 있어
  // 그냥 두면 배열처럼 굴러가 버린다 — Array.isArray 만이 이것을 가른다.
  if (!Array.isArray(input)) {
    throw new TypeError("bubbleSort: 배열이 필요하다");
  }

  const result = [...input];

  // end 는 이번 패스에서 비교할 마지막 경계다. 패스마다 최대값 하나가 뒤에
  // 확정되므로 하나씩 줄어든다. 길이 0·1 이면 end 가 -1·0 이라 패스가 아예 돌지
  // 않는다.
  for (let end = result.length - 1; end > 0; end -= 1) {
    let swapped = false;

    for (let i = 0; i < end; i += 1) {
      // `>` 로만 비교한다 — 같은 값끼리는 교환하지 않는다.
      if (result[i] > result[i + 1]) {
        const held = result[i];
        result[i] = result[i + 1];
        result[i + 1] = held;
        swapped = true;
      }
    }

    // 교환이 없었다는 것은 어긋난 인접 쌍이 하나도 없다는 뜻이다.
    if (!swapped) break;
  }

  return result;
}

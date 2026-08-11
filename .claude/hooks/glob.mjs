/**
 * 설정에 적히는 경로 패턴을 판정하는 **최소 글롭**.
 *
 * `dir/**` · `**​/name` · `*` · 정확한 파일명만 쓴다. 라이브러리를 들이지 않는 이유는
 * 훅이 매 편집마다 도는 자리라서다 — 의존성 하나가 곧 시작 비용이 된다.
 *
 * `path-ownership` 과 `doctor` 가 **같은 판정**을 써야 해서 여기로 뺐다. 다르면 doctor 가
 * "이 패턴은 아무것도 안 걸린다" 고 하는데 훅은 걸고 있는(혹은 그 반대인) 상태가 된다.
 * 훅 파일에서 직접 가져올 수는 없다 — 그 파일은 모듈 최상단에서 판정을 내보내고 종료하므로
 * 임포트하는 순간 훅이 실행된다.
 */

/**
 * **한 번의 스캔으로 바꾼다.** 순차 치환하면 앞선 치환이 만든 정규식 메타문자를 뒤의
 * 치환이 또 건드린다 — `**` → `.*` 로 바꾼 뒤 `*` 를 `[^/]*` 로 바꾸면 `.[^/]*` 가 되어
 * 디렉터리 경계를 못 넘는다.
 *
 * @param {string} pattern 설정에 적힌 패턴
 * @param {string} path 저장소 상대 경로 (`/` 구분)
 */
export function matches(pattern, path) {
  const source = pattern.replace(
    /(\*\*\/)|(\*\*)|(\*)|([.+^${}()|[\]\\])/g,
    (_, dirPrefix, deep, single, special) => {
      if (dirPrefix) return "(?:.*/)?";
      if (deep) return ".*";
      if (single) return "[^/]*";
      return `\\${special}`;
    },
  );
  return new RegExp(`^${source}$`).test(path);
}

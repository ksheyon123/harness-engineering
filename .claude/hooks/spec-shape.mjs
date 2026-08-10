/**
 * spec 이 **인계될 수 있는 모양인가**.
 *
 * 세션은 끝나면 닫히고, 그 뒤로 `developer`·`qa`·PR 을 보는 사람은 `spec.md` 만 본다.
 * 그 파일이 깨져 있으면 뒤따르는 단계가 전부 무너진다 — developer 는 요구사항 출처가
 * 없고, qa 는 대조할 기준이 없다.
 *
 * **무엇이 좋은 spec 인가는 판정하지 않는다.** 그것은 사람과 QA 의 몫이다. 여기서는
 * 기계가 확실히 아는 것만 본다 — frontmatter 가 닫히는가, 브랜치가 적혀 있는가,
 * 기능 목록이 있는가.
 *
 * **경로가 아니라 텍스트를 받는다.** `pre-commit` 이 보는 것은 워킹트리가 아니라
 * **스테이징된 내용**이어야 해서다. 검사한 것과 커밋되는 것이 다르면 검사가 무의미하다.
 */

/**
 * @param {string} path 메시지에 실을 경로
 * @param {string} text 검사할 내용 (스테이징된 블롭 또는 파일 내용)
 * @returns {string[]} 문제 목록. 비어 있으면 통과.
 */
export function problemsIn(path, text) {
  if (!text.trim()) return [`\`${path}\` 가 비어 있다.`];

  const problems = [];
  const lines = text.split(/\r?\n/);

  if (lines[0] !== "---") {
    problems.push(`\`${path}\`: 첫 줄이 \`---\` 가 아니다 — frontmatter 가 없다.`);
  } else {
    const close = lines.indexOf("---", 1);
    if (close === -1) {
      problems.push(`\`${path}\`: frontmatter 를 닫는 \`---\` 가 없다.`);
    } else if (!lines.slice(1, close).some((line) => /^branch:\s*\S/.test(line))) {
      problems.push(
        `\`${path}\`: frontmatter 에 \`branch: <task 브랜치>\` 가 없다. ` +
          `\`git branch --show-current\` 로 확인한 실제 값을 적는다 — 추측하지 않는다.`,
      );
    }
  }

  if (!/^##\s+기능 목록\s*$/m.test(text)) {
    problems.push(`\`${path}\`: \`## 기능 목록\` 절이 없다 — developer 가 읽을 것이 없다.`);
  }

  return problems;
}

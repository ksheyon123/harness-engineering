import { describe, expect, it } from "vitest";

import { problemsIn } from "./spec-shape.mjs";

const OK = `---
branch: feat/thing
---

# thing

## 기능 목록

### 기능: 교환
- **인수기준**: 동일 code 로 2회 진입해도 POST 는 1회
`;

describe("spec-shape — 인계될 수 있는 모양인가", () => {
  it("frontmatter 와 기능 목록이 있으면 통과한다", () => {
    expect(problemsIn("harness/thing/spec.md", OK)).toEqual([]);
  });

  it("빈 파일을 잡는다", () => {
    expect(problemsIn("s.md", "   \n\n")).toEqual(["`s.md` 가 비어 있다."]);
  });

  it("frontmatter 가 없으면 잡는다", () => {
    const problems = problemsIn("s.md", "# thing\n\n## 기능 목록\n");

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("frontmatter 가 없다");
  });

  it("frontmatter 가 닫히지 않으면 잡는다", () => {
    const problems = problemsIn("s.md", "---\nbranch: x\n\n## 기능 목록\n");

    expect(problems[0]).toContain("닫는 `---` 가 없다");
  });

  it("branch 가 없으면 잡는다", () => {
    // 이 값이 곧 '이 spec 의 소유자가 누구인가' 의 기록이다.
    const problems = problemsIn("s.md", "---\ntask: thing\n---\n\n## 기능 목록\n");

    expect(problems[0]).toContain("`branch: <task 브랜치>` 가 없다");
  });

  it("branch 키만 있고 값이 없으면 잡는다", () => {
    const problems = problemsIn("s.md", "---\nbranch:\n---\n\n## 기능 목록\n");

    expect(problems[0]).toContain("`branch: <task 브랜치>` 가 없다");
  });

  it("기능 목록 절이 없으면 잡는다", () => {
    const problems = problemsIn("s.md", "---\nbranch: x\n---\n\n# thing\n");

    expect(problems[0]).toContain("`## 기능 목록` 절이 없다");
  });

  it("문제가 여럿이면 전부 모아 돌려준다", () => {
    // 한 번에 다 보여줘야 고치는 쪽이 왕복하지 않는다.
    expect(problemsIn("s.md", "# thing\n")).toHaveLength(2);
  });

  it("CRLF 로 저장된 spec 도 읽는다", () => {
    expect(problemsIn("s.md", OK.replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("내용의 좋고 나쁨은 판정하지 않는다", () => {
    // 인수기준이 검증 불가능해도 통과한다 — 그것은 사람과 QA 의 몫이다.
    const shallow = "---\nbranch: x\n---\n\n## 기능 목록\n\n### 기능: 로그인\n- 잘 된다\n";

    expect(problemsIn("s.md", shallow)).toEqual([]);
  });
});

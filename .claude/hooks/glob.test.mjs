import { describe, expect, it } from "vitest";

import { matches } from "./glob.mjs";

/**
 * 이 매처는 이제 `path-ownership`(무엇을 막을지)과 `doctor`(그 패턴이 뭔가를 걸긴 하는지)
 * 둘이 공유한다. 둘의 판정이 갈리면 doctor 가 "아무것도 안 걸린다" 고 하는데 훅은 막고
 * 있는 상태가 되므로, 계약을 여기서 직접 고정한다.
 */
describe("glob — 설정에 적히는 경로 패턴", () => {
  it("`dir/**` 는 그 아래 전부를 건다", () => {
    expect(matches("src/**", "src/a.js")).toBe(true);
    expect(matches("src/**", "src/deep/nested/a.js")).toBe(true);
    expect(matches("src/**", "other/a.js")).toBe(false);
  });

  it("`**/name` 은 어느 깊이에서든 그 이름을 건다", () => {
    expect(matches("harness/**/qa-checklist.md", "harness/t/qa-checklist.md")).toBe(true);
    expect(matches("harness/**/qa-checklist.md", "harness/a/b/qa-checklist.md")).toBe(true);
    expect(matches("harness/**/qa-checklist.md", "harness/t/spec.md")).toBe(false);
  });

  it("`*` 는 디렉터리 경계를 못 넘는다", () => {
    expect(matches("src/*.js", "src/a.js")).toBe(true);
    expect(matches("src/*.js", "src/deep/a.js")).toBe(false);
  });

  it("정확한 파일명은 그것만 건다", () => {
    expect(matches("package.json", "package.json")).toBe(true);
    expect(matches("package.json", "sub/package.json")).toBe(false);
  });

  it("`.` 은 정규식 메타문자가 아니라 점이다", () => {
    // 이스케이프가 빠지면 `packageXjson` 같은 것이 걸린다.
    expect(matches("package.json", "packageXjson")).toBe(false);
  });

  it("부분 일치가 아니라 전체 일치다", () => {
    expect(matches("src/**", "vendor/src/a.js")).toBe(false);
    expect(matches("package.json", "package.json.bak")).toBe(false);
  });
});

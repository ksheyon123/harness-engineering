import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// 훅 등록의 사실 관계를 지키는 회귀 테스트.
// 훅은 스스로를 테스트하기 어렵다(stdin/프로세스 종료 코드) — 대신 '무엇이 등록돼 있는가' 를 검사한다.
// settings.json 은 JSON 파싱이 깨지면 Claude Code 가 설정 전체를 못 읽으므로 파싱 자체가 인수기준이다.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

describe(".claude/settings.json", () => {
  it("유효한 JSON 이다", () => {
    expect(() => readJson(".claude/settings.json")).not.toThrow();
  });

  // index-sync 가 유일한 PostToolUse 항목이었다. 빈 배열만 남기면
  // '여기 뭔가 있었다' 는 잘못된 신호가 되므로 키 자체가 없어야 한다.
  it("PostToolUse 키가 없다", () => {
    expect(readJson(".claude/settings.json").hooks).not.toHaveProperty("PostToolUse");
  });

  it("등록된 훅 command 가 모두 실존하는 파일을 가리킨다", () => {
    const { hooks } = readJson(".claude/settings.json");
    const commands = Object.values(hooks ?? {})
      .flat()
      .flatMap((entry) => entry.hooks ?? [])
      .map((h) => h.command);

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const script = command.match(/(\S+\.mjs)/)?.[1];
      expect(script, `훅 command 에서 스크립트 경로를 찾지 못함: ${command}`).toBeTruthy();
      expect(existsSync(join(repoRoot, script)), `등록된 훅 파일이 없음: ${script}`).toBe(true);
    }
  });
});

describe("index-sync 훅", () => {
  it("훅 파일이 존재하지 않는다", () => {
    expect(existsSync(join(repoRoot, ".claude/hooks/index-sync.mjs"))).toBe(false);
  });
});

describe("harness/index.json", () => {
  it("유효한 JSON 이다", () => {
    expect(() => readJson("harness/index.json")).not.toThrow();
  });

  // components 는 index-sync 전용 키였다. 훅이 사라졌으므로 읽는 쪽이 없다.
  it("components 키가 없다", () => {
    expect(readJson("harness/index.json")).not.toHaveProperty("components");
  });

  // tasks 는 범위 밖 — load-spec·verify-branch·pre-push·worktree-add 가 쓴다.
  it("tasks 매핑은 그대로 남아 있다", () => {
    const index = readJson("harness/index.json");
    expect(index.tasks).toBeTypeOf("object");
    expect(Object.keys(index.tasks).length).toBeGreaterThan(0);
  });
});

describe("문서", () => {
  // 설계 문서가 존재하지 않는 훅을 서술하면 다음 도입 프로젝트가 그대로 복제한다.
  // 단 '설계 변경 이력' 은 제거 사실을 남기는 자리라 예외다.
  it("harness-engineering.md 는 변경 이력 밖에서 index-sync 를 언급하지 않는다", () => {
    const doc = read("harness-engineering.md");
    const [body, history] = doc.split("## 설계 변경 이력");
    expect(history, "'## 설계 변경 이력' 절을 찾지 못했다").toBeTruthy();
    expect(body).not.toMatch(/index-sync|Hook ?3/);
  });

  it("제거 사실이 설계 변경 이력에 남아 있다", () => {
    const history = read("harness-engineering.md").split("## 설계 변경 이력")[1] ?? "";
    expect(history).toMatch(/index-sync/);
  });

  it("README 는 존재하지 않는 훅 파일을 서술하지 않는다", () => {
    expect(read("README.md")).not.toMatch(/index-sync/);
  });
});

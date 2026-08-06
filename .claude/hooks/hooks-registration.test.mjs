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

// 설계 문서는 README.md 하나다(구 harness-engineering.md 통합 — README '설계 변경 이력' 참고).
// 두 문서가 같은 사실을 각각 서술하면 드리프트가 나므로 검사 대상도 하나다.
describe("문서", () => {
  // 설계 문서가 존재하지 않는 훅을 서술하면 다음 도입 프로젝트가 그대로 복제한다.
  // 단 '설계 변경 이력' 은 제거 사실을 남기는 자리라 예외이고, 제거 작업의 task 이름
  // (index-sync-removal)도 훅을 '있는 것처럼' 서술하는 게 아니라 이력이라 예외다.
  it("README 는 변경 이력 밖에서 index-sync 를 언급하지 않는다", () => {
    const [body, history] = read("README.md").split("## 설계 변경 이력");
    expect(history, "'## 설계 변경 이력' 절을 찾지 못했다").toBeTruthy();
    expect(body).not.toMatch(/index-sync(?!-removal)|Hook ?3/);
  });

  it("제거 사실이 설계 변경 이력에 남아 있다", () => {
    const history = read("README.md").split("## 설계 변경 이력")[1] ?? "";
    expect(history).toMatch(/index-sync/);
  });
});

// BACKLOG.md 는 7b4b47e 로 삭제됐다. 존재하지 않는 파일을 가리키는 링크·면제 항목은
// 이 저장소가 반복해서 경고해 온 '낡은 사본' 그 자체다(pipeline-review 관찰 ⑧).
// 부재 단언이라 문구를 다시 써도 깨지지 않는다.
describe("삭제된 BACKLOG.md 의 잔재", () => {
  it("README 에 ./BACKLOG.md 링크가 없다", () => {
    expect(read("README.md")).not.toMatch(/\]\(\.\/BACKLOG\.md\)/);
  });

  it("harnessMetaPaths 에 BACKLOG.md 가 없다", () => {
    expect(readJson("harness/config.json").harnessMetaPaths).not.toContain("BACKLOG.md");
  });
});

// 커밋 입도는 어떤 하네스 장치도 소비하지 않고 훅으로 검증할 수도 없다 —
// 강제도 소비도 없으면 규약이 아니라 취향이다(pipeline-review §4-5·§4-6).
// 규칙 2 로 '한 브랜치 = spec 하나' 가 강제되므로 '여러 spec 을 한 세션에서' 라는
// 전제 자체도 성립하지 않는다.
describe("CLAUDE.md 의 커밋 입도 문구", () => {
  it("삭제돼 있다", () => {
    expect(read(".claude/CLAUDE.md")).not.toMatch(/spec 1개당 1커밋/);
  });
});

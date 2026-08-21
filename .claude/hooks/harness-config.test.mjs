import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONFIG_FILE, CONFIG_PATHS, DEFAULTS, findConfig, loadConfig } from "./harness-config.mjs";

/** 설정 파일 하나만 든 임시 트리. `content` 가 `null` 이면 파일을 만들지 않는다. */
function tree(content) {
  const dir = mkdtempSync(join(tmpdir(), "harness-config-"));
  if (content !== null) {
    writeFileSync(join(dir, CONFIG_FILE), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

describe("harness-config — 프로젝트마다 달라지는 값의 단일 출처", () => {
  it("설정이 없으면 기본값이다", () => {
    expect(loadConfig(tree(null))).toEqual({ ...DEFAULTS });
  });

  it("적힌 키만 덮고 나머지는 기본값으로 남는다", () => {
    const config = loadConfig(tree({ specRoot: "specs" }));

    expect(config.specRoot).toBe("specs");
    expect(config.gate).toBe(DEFAULTS.gate);
    expect(config.protectedBranches).toEqual(DEFAULTS.protectedBranches);
  });

  it("전부 덮을 수도 있다", () => {
    const config = loadConfig(
      tree({
        gate: "pytest -q",
        source: ["app/**", "lib/**"],
        harnessFiles: [".claude/**"],
        specRoot: "docs/specs",
        protectedBranches: ["trunk"],
      }),
    );

    expect(config).toEqual({
      gate: "pytest -q",
      source: ["app/**", "lib/**"],
      harnessFiles: [".claude/**"],
      specRoot: "docs/specs",
      protectedBranches: ["trunk"],
    });
  });

  it("specRoot 의 뒤 슬래시를 뗀다 — 붙이는 것은 쓰는 쪽 몫이다", () => {
    expect(loadConfig(tree({ specRoot: "specs/" })).specRoot).toBe("specs");
    expect(loadConfig(tree({ specRoot: "specs///" })).specRoot).toBe("specs");
  });

  describe("망가진 값은 그 키만 버린다", () => {
    it("JSON 이 깨졌으면 전부 기본값이다", () => {
      // 여기서 던지지 않는다. PreToolUse 훅이 죽으면 차단이 아니라 통과가 된다.
      expect(loadConfig(tree("{ 이건 JSON 이 아니다"))).toEqual({ ...DEFAULTS });
    });

    it("최상위가 객체가 아니면 전부 기본값이다", () => {
      expect(loadConfig(tree([1, 2, 3]))).toEqual({ ...DEFAULTS });
    });

    it("타입이 어긋난 키만 기본값으로 돌아간다", () => {
      const config = loadConfig(tree({ gate: 42, specRoot: "specs" }));

      expect(config.gate).toBe(DEFAULTS.gate);
      expect(config.specRoot).toBe("specs"); // 옆의 멀쩡한 값은 살아남는다
    });

    it("빈 배열은 오타로 본다 — 아무 경로도 안 지키는 것이 의도일 리 없다", () => {
      expect(loadConfig(tree({ source: [] })).source).toEqual(DEFAULTS.source);
      expect(loadConfig(tree({ harnessFiles: [] })).harnessFiles).toEqual(DEFAULTS.harnessFiles);
    });

    it("배열 안의 쓰레기만 걸러낸다", () => {
      expect(loadConfig(tree({ source: ["app/**", 7, "", "  ", "lib/**"] })).source).toEqual([
        "app/**",
        "lib/**",
      ]);
    });
  });

  it("기본값은 얼려 둔다 — 부르는 쪽이 고쳐도 다음 호출이 오염되지 않는다", () => {
    const config = loadConfig(tree(null));
    config.source.push("망가뜨리기");

    expect(loadConfig(tree(null)).source).toEqual(["src/**"]);
  });
});

/**
 * 설정의 집이 루트에서 `.claude/` 로 옮겨졌다. 하네스가 만드는 것이 **한 접두어 아래**
 * 모여 있어야 A 가 `.gitignore` 에 쓴 한 줄로 커밋 여부를 정할 수 있다.
 *
 * 루트도 계속 읽는다 — 안 읽으면 기존 설치가 **조용히 기본값으로 돌아가고**, 남의
 * 저장소에서 기본값은 곧 틀린 값이다.
 */
describe("설정의 자리 — `.claude/` 우선, 루트 폴백", () => {
  /** 원하는 자리에 설정을 놓은 임시 트리. */
  function at(places) {
    const dir = mkdtempSync(join(tmpdir(), "harness-config-where-"));
    for (const [relative, content] of Object.entries(places)) {
      const full = join(dir, relative);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, JSON.stringify(content));
    }
    return dir;
  }

  it("`.claude/harness.config.json` 을 읽는다", () => {
    const dir = at({ ".claude/harness.config.json": { specRoot: "새자리" } });

    expect(findConfig(dir).relative).toBe(".claude/harness.config.json");
    expect(loadConfig(dir).specRoot).toBe("새자리");
  });

  it("루트에만 있으면 그것을 읽는다 — 기존 설치가 조용히 기본값으로 돌아가면 안 된다", () => {
    const dir = at({ "harness.config.json": { specRoot: "옛자리" } });

    expect(findConfig(dir).relative).toBe("harness.config.json");
    expect(findConfig(dir).legacy).toBe(true);
    expect(loadConfig(dir).specRoot).toBe("옛자리");
  });

  it("둘 다 있으면 `.claude/` 쪽이 이긴다", () => {
    const dir = at({
      ".claude/harness.config.json": { specRoot: "새자리" },
      "harness.config.json": { specRoot: "옛자리" },
    });

    expect(findConfig(dir).legacy).toBe(false);
    expect(loadConfig(dir).specRoot).toBe("새자리");
  });

  it("아무 데도 없으면 `null` 이다", () => {
    expect(findConfig(at({}))).toBeNull();
  });

  it("경로는 `/` 로 적힌다 — 그대로 사람에게 찍히는 값이다", () => {
    // `join` 으로 지으면 Windows 에서 `.claude\…` 가 되어 문서·메시지와 어긋난다.
    for (const path of CONFIG_PATHS) expect(path).not.toContain("\\");
  });
});

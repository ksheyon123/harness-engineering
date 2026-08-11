import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONFIG_FILE, DEFAULTS, loadConfig } from "./harness-config.mjs";

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

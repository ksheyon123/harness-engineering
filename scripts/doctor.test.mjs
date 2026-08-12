import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONFIG_FILE } from "../.claude/hooks/harness-config.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { diagnose, report } from "./doctor.mjs";

/**
 * 설정 하나를 담은 임시 저장소.
 *
 * `git init` 을 부르므로 **`GIT_` 를 씻는다.** `GIT_DIR` 이 상속돼 있으면 임시 디렉터리를
 * 겨냥한 것처럼 보이는 명령이 진짜 저장소를 건드린다.
 */
function repo(config, { files = ["src/a.js"], track = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "doctor-"));

  for (const file of files) {
    const at = join(dir, file);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, "//\n");
  }
  if (config !== null) {
    writeFileSync(join(dir, CONFIG_FILE), typeof config === "string" ? config : JSON.stringify(config));
  }

  if (track) {
    const git = (args) =>
      execFileSync("git", args, { cwd: dir, env: cleanEnv(), stdio: "ignore" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
  }

  return dir;
}

/** 특정 등급의 note 만. */
const only = (notes, level) => notes.filter((n) => n.level === level);
const texts = (notes) => notes.map((n) => n.text).join("\n");

describe("doctor — 설정을 검사해 사람에게 보고한다", () => {
  it("설정이 없으면 참고만 남긴다", () => {
    const notes = diagnose(repo(null));

    expect(only(notes, "error")).toHaveLength(0);
    expect(texts(notes)).toContain("기본값으로 돈다");
  });

  it("멀쩡한 설정에는 아무 말도 하지 않는다", () => {
    const notes = diagnose(
      repo(
        { source: ["src/**"], specRoot: "harness" },
        { files: ["src/a.js", "harness/t/spec.md", "package.json"] },
      ),
    );

    expect(notes).toEqual([]);
  });

  it("목록의 일부만 없는 것은 정상으로 본다", () => {
    // `harnessFiles` 기본값에는 `vitest.config.mjs` 처럼 프로젝트마다 없을 수 있는 것이
    // 섞인다. 하나씩 걸고 넘어지면 멀쩡한 설정이 경고를 넷씩 뱉는다.
    const notes = diagnose(repo({}, { files: ["src/a.js", "harness/t/spec.md", "package.json"] }));

    expect(notes).toEqual([]);
  });

  describe("파일 전체가 무시되는 경우 — 전부 error 다", () => {
    it("JSON 이 깨졌다", () => {
      const notes = diagnose(repo("{ 이건 JSON 이 아니다"));

      expect(only(notes, "error")).toHaveLength(1);
      expect(texts(notes)).toContain("모든 값이 기본값으로 돈다");
    });

    it("최상위가 객체가 아니다", () => {
      expect(only(diagnose(repo([1, 2])), "error")).toHaveLength(1);
    });
  });

  describe("키 단위 문제", () => {
    it("모르는 키는 오타로 의심해 알린다", () => {
      // loadConfig 가 조용히 버리는 값이다 — 이게 doctor 의 존재 이유다.
      const notes = diagnose(repo({ specRoots: "specs" }));

      expect(only(notes, "warning").length).toBeGreaterThan(0);
      expect(texts(notes)).toContain("`specRoots` 는 모르는 키다");
      expect(texts(notes)).toContain("specRoot"); // 쓸 수 있는 키를 같이 보여준다
    });

    it("타입이 어긋나면 error 다 — 그 키는 버려진다", () => {
      const notes = diagnose(repo({ gate: ["npm", "test"], source: "src/**" }));
      const errors = only(notes, "error");

      expect(errors).toHaveLength(2);
      expect(texts(errors)).toContain("`gate` 는 문자열 이어야 하는데 배열 이다");
      expect(texts(errors)).toContain("`source` 는 문자열 배열 이어야 하는데");
    });

    it("빈 문자열도 버려진다", () => {
      expect(texts(only(diagnose(repo({ specRoot: "   " })), "error"))).toContain("비어 있다");
    });

    it("빈 배열은 오타로 본다", () => {
      const notes = diagnose(repo({ source: [] }));

      expect(only(notes, "error")).toHaveLength(1);
      expect(texts(notes)).toContain("오타로 본다");
    });

    it("배열에 섞인 비문자열은 걸러진다고 알린다", () => {
      const notes = diagnose(repo({ source: ["src/**", 7] }));

      expect(only(notes, "error")).toHaveLength(0);
      expect(texts(only(notes, "warning"))).toContain("1개가 문자열이 아니라");
    });
  });

  describe("경로가 실제로 걸리는가", () => {
    it("키 전체가 헛돌면 알린다 — 남의 구조를 옮겨 적은 흔적이다", () => {
      const notes = diagnose(repo({ source: ["app/**", "lib/**"] }, { files: ["src/a.js"] }));

      expect(texts(only(notes, "warning"))).toContain("`source` 의 패턴 중 어느 것도");
      expect(texts(notes)).toContain("app/** · lib/**"); // 무엇을 적었는지 되돌려준다
    });

    it("specRoot 디렉터리가 없으면 알리되 오류는 아니다", () => {
      const notes = diagnose(repo({ specRoot: "specs" }, { files: ["src/a.js"] }));

      expect(only(notes, "error")).toHaveLength(0);
      expect(texts(notes)).toContain("`specs/` 가 없다");
    });

    it("추적되지 않는 파일은 세지 않는다", () => {
      // 커밋하지 않은 트리에서는 판정하지 않는다 — 없는 것과 모르는 것은 다르다.
      const notes = diagnose(repo({ source: ["src/**"] }, { track: false }));

      expect(texts(notes)).toContain("확인하지 못했다");
      expect(only(notes, "error")).toHaveLength(0);
    });
  });

  describe("종료 코드", () => {
    const swallow = () => {};

    it("오류가 있으면 1 이다", () => {
      expect(report([{ level: "error", text: "x" }], swallow)).toBe(1);
    });

    it("경고만 있으면 0 이다 — 막지 않는다", () => {
      expect(report([{ level: "warning", text: "x" }], swallow)).toBe(0);
    });

    it("아무 말도 없으면 0 이다", () => {
      expect(report([], swallow)).toBe(0);
    });
  });
});

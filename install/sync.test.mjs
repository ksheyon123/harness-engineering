import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { apply as install } from "./init.mjs";
import { MANIFEST_PATH, hashOf, parseManifest } from "./managed.mjs";
import { apply, plan } from "./sync.mjs";

/** `core.hooksPath` 가 비어 있는 저장소. `init` 이 git 에게 묻는 것은 그것뿐이다. */
const fakeGit = () => {
  const git = (args) => {
    if (args.includes("--get")) throw new Error("설정되지 않았다");
    return "";
  };
  return git;
};

/** 설치가 끝난 A. */
function installed() {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  install(dir, fakeGit());
  return dir;
}

const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const manifestOf = (dir) => parseManifest(read(dir, MANIFEST_PATH));

/** 설치본이 옛 버전이었던 상황. 파일과 기록부를 **함께** 옛 내용으로 맞춘다. */
function pretendStale(dir, path, oldContents) {
  writeFileSync(join(dir, path), oldContents);
  const manifest = manifestOf(dir);
  manifest.files[path] = hashOf(oldContents);
  writeFileSync(join(dir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("sync — 설치본의 복사본을 다시 쓴다", () => {
  it("설치 직후에는 다시 쓸 것이 없다", () => {
    const result = plan(installed());

    expect(result.steps.filter((s) => s.state !== "same")).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("`init` 이 기록부를 남긴다", () => {
    const manifest = manifestOf(installed());

    expect(manifest.version).toBe("0.1.0");
    expect(Object.keys(manifest.files)).toContain(".claude/harness.md");
    expect(Object.keys(manifest.files)).toContain(".claude/hooks/verify-green.mjs");
  });

  it("기록부는 **병합해서 만든 파일**을 담지 않는다", () => {
    // 그것들은 A 의 파일이고 하네스는 몇 줄을 얹었을 뿐이다. sync 가 덮으면 안 된다.
    const files = Object.keys(manifestOf(installed()).files);

    expect(files).not.toContain(".claude/settings.json");
    expect(files).not.toContain(".gitignore");
    expect(files).not.toContain("package.json");
    expect(files).not.toContain(".claude/CLAUDE.md");
  });

  describe("A 가 손대지 않았으면 갱신한다", () => {
    it("낡은 사본을 패키지의 현재 내용으로 되돌린다", () => {
      const dir = installed();
      pretendStale(dir, ".claude/harness.md", "옛 규약\n");

      apply(dir);

      expect(read(dir, ".claude/harness.md")).toContain("역할 기반");
    });

    it("지워진 파일은 다시 만든다", () => {
      // 설치 뒤에 지워졌거나, 그 사이 하네스에 새로 생긴 파일이다. 어느 쪽이든 만든다.
      const dir = installed();
      rmSync(join(dir, ".claude/hooks/verify-green.mjs"));

      const step = plan(dir).steps.find((s) => s.path === ".claude/hooks/verify-green.mjs");

      expect(step.state).toBe("create");
    });

    it("내용이 비워진 것은 '지워졌다' 가 아니라 '고쳤다' 로 본다", () => {
      // 판단할 수 없는 쪽으로 기운다 — 덮어서 잃는 것이 안 덮어서 잃는 것보다 크다.
      const dir = installed();
      writeFileSync(join(dir, ".claude/hooks/verify-green.mjs"), "");

      expect(plan(dir).conflicts.map((c) => c.path)).toContain(".claude/hooks/verify-green.mjs");
    });

    it("갱신하고 나면 기록부가 새 내용을 담는다", () => {
      const dir = installed();
      pretendStale(dir, ".claude/harness.md", "옛 규약\n");
      apply(dir);

      const manifest = manifestOf(dir);

      expect(manifest.files[".claude/harness.md"]).toBe(hashOf(read(dir, ".claude/harness.md")));
    });
  });

  describe("A 가 손댔으면 덮지 않는다", () => {
    it("바뀐 파일은 충돌로 보고한다", () => {
      // `developer.md` 를 자기 스택에 맞게 고치는 것은 정당한 일이다.
      const dir = installed();
      appendFileSync(join(dir, ".claude/agents/developer.md"), "\n<!-- A 의 규약 -->\n");

      const result = plan(dir);

      expect(result.conflicts.map((c) => c.path)).toEqual([".claude/agents/developer.md"]);
    });

    it("충돌한 파일의 내용을 그대로 둔다", () => {
      const dir = installed();
      appendFileSync(join(dir, ".claude/agents/developer.md"), "\n<!-- A 의 규약 -->\n");

      apply(dir);

      expect(read(dir, ".claude/agents/developer.md")).toContain("A 의 규약");
    });

    it("충돌해도 나머지는 갱신한다", () => {
      const dir = installed();
      appendFileSync(join(dir, ".claude/agents/developer.md"), "\n<!-- A 의 규약 -->\n");
      pretendStale(dir, ".claude/harness.md", "옛 규약\n");

      const result = apply(dir);

      expect(result.applied.map((s) => s.path)).toEqual([".claude/harness.md"]);
      expect(read(dir, ".claude/harness.md")).toContain("역할 기반");
    });

    it("충돌한 파일의 기록을 **지금 내용**으로 갱신한다", () => {
      // 새 해시로 적어버리면 다음 sync 가 '설치 그대로' 로 오해하고 조용히 덮는다.
      const dir = installed();
      appendFileSync(join(dir, ".claude/agents/developer.md"), "\n<!-- A 의 규약 -->\n");
      apply(dir);

      expect(manifestOf(dir).files[".claude/agents/developer.md"]).toBe(
        hashOf(read(dir, ".claude/agents/developer.md")),
      );
      // 그래서 다시 돌려도 여전히 손대지 않는다 — 이번엔 '설치 그대로' 라 조용히 통과한다.
      expect(read(dir, ".claude/agents/developer.md")).toContain("A 의 규약");
    });
  });

  it("기록이 없으면 판단하지 않는다", () => {
    // `init` 이전이거나 기록부가 지워졌다. 손댔는지 알 수 없으면 덮지 않는다.
    const dir = installed();
    writeFileSync(join(dir, MANIFEST_PATH), "{ 깨진 JSON");
    appendFileSync(join(dir, ".claude/harness.md"), "\n뭔가\n");

    const result = plan(dir);

    expect(result.installed).toBe(null);
    expect(result.conflicts.map((c) => c.reason).join()).toContain("판단할 수 없다");
  });

  it("줄바꿈이 CRLF 로 바뀐 것을 수정으로 보지 않는다", () => {
    // A 가 core.autocrlf=true 인 Windows 면 체크아웃이 LF 를 CRLF 로 바꾼다.
    // 그걸 수정으로 읽으면 sync 가 영원히 갱신을 거부한다.
    const dir = installed();
    const asCrlf = read(dir, ".claude/harness.md").replace(/\n/g, "\r\n");
    writeFileSync(join(dir, ".claude/harness.md"), asCrlf);

    const result = plan(dir);

    expect(result.conflicts).toEqual([]);
    expect(result.steps.find((s) => s.path === ".claude/harness.md").state).toBe("same");
  });
});

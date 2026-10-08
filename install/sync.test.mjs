import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version;

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

    // **패키지에서 읽는다.** 여기 버전을 박아두면 릴리스 때마다 이 테스트가 낡고,
    // 정작 묻는 것("설치한 버전이 기록되는가")과도 상관없는 이유로 red 가 된다.
    expect(manifest.version).toBe(VERSION);
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
    // 하네스 소유 파일을 A 가 고치는 것도 A 의 결정일 수 있다. 덮으면 아무도 모른다.
    const EDITED = ".claude/planner-mode.md";
    const edit = (dir) => appendFileSync(join(dir, EDITED), "\n<!-- A 의 수정 -->\n");

    it("바뀐 파일은 충돌로 보고한다", () => {
      const dir = installed();
      edit(dir);

      const result = plan(dir);

      expect(result.conflicts.map((c) => c.path)).toEqual([EDITED]);
    });

    it("충돌한 파일의 내용을 그대로 둔다", () => {
      const dir = installed();
      edit(dir);

      apply(dir);

      expect(read(dir, EDITED)).toContain("A 의 수정");
    });

    it("충돌해도 나머지는 갱신한다", () => {
      const dir = installed();
      edit(dir);
      pretendStale(dir, ".claude/harness.md", "옛 규약\n");

      const result = apply(dir);

      expect(result.applied.map((s) => s.path)).toEqual([".claude/harness.md"]);
      expect(read(dir, ".claude/harness.md")).toContain("역할 기반");
    });

    it("**몇 번을 돌려도** 덮지 않는다 — 충돌한 파일의 기록은 옛 해시 그대로다", () => {
      // 한때 충돌한 파일의 기록을 지금 내용(A 의 수정)으로 갱신했다. 그러면 두 번째 sync 가
      // `recorded === hashOf(current)` 를 보고 '설치 그대로' 라 판정해 조용히 덮었다(실측).
      const dir = installed();
      const before = manifestOf(dir).files[EDITED];
      edit(dir);

      apply(dir);
      expect(manifestOf(dir).files[EDITED]).toBe(before);

      const second = apply(dir);
      expect(second.conflicts.map((c) => c.path)).toEqual([EDITED]);
      expect(read(dir, EDITED)).toContain("A 의 수정");
    });

    it("기록이 없던 충돌은 계속 기록이 없다", () => {
      // 없는 기록을 지금 내용으로 채우면, 같은 이유로 다음 sync 가 덮는다.
      const dir = installed();
      const manifest = manifestOf(dir);
      delete manifest.files[EDITED];
      writeFileSync(join(dir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
      edit(dir);

      apply(dir);
      apply(dir);

      expect(manifestOf(dir).files[EDITED]).toBeUndefined();
      expect(read(dir, EDITED)).toContain("A 의 수정");
    });
  });

  describe("에이전트 정의는 A 의 것이다", () => {
    const DEV = ".claude/agents/developer.md";
    const TEMPLATE = readFileSync(fileURLToPath(new URL(`../${DEV}`, import.meta.url)), "utf8");

    it("기록부에 들지 않는다", () => {
      const files = Object.keys(manifestOf(installed()).files);

      expect(files).not.toContain(DEV);
      expect(files).not.toContain(".claude/agents/qa.md");
      // 하네스 몫은 갈라낸 쪽에 있다.
      expect(files).toContain(".claude/roles/developer.md");
    });

    it("고쳐도 충돌이 아니고, 몇 번을 돌려도 그대로다", () => {
      const dir = installed();
      appendFileSync(join(dir, DEV), "\n- 테스트는 `*.spec.ts` 로 쓴다\n");

      expect(plan(dir).conflicts).toEqual([]);
      apply(dir);
      apply(dir);

      expect(read(dir, DEV)).toContain("*.spec.ts");
    });

    it("지워졌으면 본보기를 다시 깐다 — 없으면 역할이 안 뜬다", () => {
      const dir = installed();
      rmSync(join(dir, DEV));

      apply(dir);

      expect(read(dir, DEV)).toBe(TEMPLATE);
    });

    describe("역할 지침을 갈라내기 전의 설치본", () => {
      const OLD = "---\nname: developer\n---\n옛 지침 전부\n";

      /** 옛 설치본: 에이전트 정의가 하네스 소유였고 기록부에 그 해시가 있었다. */
      function legacy(dir, contents) {
        writeFileSync(join(dir, DEV), contents);
        const manifest = manifestOf(dir);
        manifest.files[DEV] = hashOf(OLD);
        writeFileSync(join(dir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
      }

      it("손대지 않았으면 본보기로 바꾼다 — 두면 옛 지침과 새 지침이 함께 실린다", () => {
        const dir = installed();
        legacy(dir, OLD);

        apply(dir);

        expect(read(dir, DEV)).toBe(TEMPLATE);
        expect(manifestOf(dir).files[DEV]).toBeUndefined();
      });

      it("손댔으면 덮지 않고 무엇을 할지 알린다", () => {
        const dir = installed();
        legacy(dir, `${OLD}우리 스택\n`);

        const result = apply(dir);

        expect(read(dir, DEV)).toContain("우리 스택");
        const conflict = result.conflicts.find((c) => c.path === DEV);
        expect(conflict.reason).toContain(".claude/roles/developer.md");
        // 한 번 알렸으면 그 뒤로는 A 의 파일이다 — 영원히 충돌로 남기지 않는다.
        expect(manifestOf(dir).files[DEV]).toBeUndefined();
        expect(plan(dir).conflicts).toEqual([]);
      });

      it("`init` 을 다시 돌려도 같은 판정이다 — 새 기록부가 표식을 지우기 전에 본다", () => {
        const dir = installed();
        legacy(dir, OLD);

        install(dir, fakeGit());

        expect(read(dir, DEV)).toBe(TEMPLATE);
      });
    });
  });

  describe("배선", () => {
    it("`SubagentStart` 배선이 없으면 `init` 을 다시 돌리라고 알린다", () => {
      // settings.json 은 병합한 A 의 파일이라 sync 가 고치지 않는다.
      const dir = installed();
      const settingsPath = join(dir, ".claude/settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      delete settings.hooks.SubagentStart;
      writeFileSync(settingsPath, JSON.stringify(settings));

      expect(plan(dir).notes.join()).toContain("harness init");
    });

    it("배선이 있으면 조용하다", () => {
      expect(plan(installed()).notes).toEqual([]);
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

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 발행되는 tarball 의 내용을 고정한다.
 *
 * `package.json` 의 `files` 는 조용히 틀린다 — 새 훅을 만들고 목록에 안 넣으면 **설치한
 * 쪽에서만** 없다. 그리고 반대 방향으로도 틀린다: 목록이 넓으면 테스트와 제품 코드가
 * 딸려 나가고, 그러면 A 의 게이트가 남의 하네스 테스트를 돌린다(실측: 이 저장소를
 * 손대기 전 tarball 에는 46개 파일이 들어 있었다 — `src/` 와 `harness/` 까지).
 *
 * 그래서 `files` 를 눈으로 검사하지 않고 **npm 이 실제로 담는 것**을 묻는다.
 */

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/** `npm pack --dry-run --json` 이 보고하는 실제 tarball 목록. */
let packed;

beforeAll(() => {
  // `execFileSync` 로는 못 부른다. Windows 의 `npm` 은 배치 래퍼이고 Node 20+ 는 셸 없이
  // `.cmd` 를 띄우는 것을 거부한다(EINVAL). `shell: true` + 인자 배열은 DEP0190 경고를
  // 내므로, **명령을 통째로 상수 문자열**로 준다 — 끼워 넣는 값이 없어 안전하다.
  const out = execSync("npm pack --dry-run --json", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  packed = JSON.parse(out)[0].files.map((f) => f.path);
}, 60_000);

const has = (path) => packed.includes(path);

describe("발행되는 tarball", () => {
  it("훅 본체가 전부 담긴다", () => {
    // 설치한 쪽에서 이것들이 없으면 층 1·2 와 종료 게이트가 통째로 없다.
    for (const hook of [
      "path-ownership.mjs",
      "session-role.mjs",
      "verify-green.mjs",
      "verify-checklist.mjs",
      "hook-kit.mjs",
      "harness-config.mjs",
      "glob.mjs",
      "spec-shape.mjs",
    ]) {
      expect(has(`.claude/hooks/${hook}`), `.claude/hooks/${hook}`).toBe(true);
    }

    for (const hook of [
      "pre-commit",
      "pre-commit.mjs",
      "pre-push",
      "pre-push.mjs",
      "mark-verified.mjs",
      "verified-marker.mjs",
    ]) {
      expect(has(`.githooks/${hook}`), `.githooks/${hook}`).toBe(true);
    }
  });

  it("역할 정의와 지침이 담긴다", () => {
    // worktree 안에서는 패키지의 문서를 임포트할 수 없다(실측). 설치할 때 복사해야
    // 하므로 원본이 tarball 에 있어야 한다.
    expect(has(".claude/agents/developer.md")).toBe(true);
    expect(has(".claude/agents/qa.md")).toBe(true);
    expect(has(".claude/harness.md")).toBe(true);
    expect(has(".claude/planner-mode.md")).toBe(true);
  });

  it("라우팅 스킬이 담긴다", () => {
    // 훅과 층 1 의 안내가 이 둘을 이름으로 부른다. 안 담기면 **막으면서 없는 곳을
    // 가리키는** 상태가 된다 — 안 막는 것보다 나쁘다.
    expect(has(".claude/skills/harness-fix/SKILL.md")).toBe(true);
    expect(has(".claude/skills/task/SKILL.md")).toBe(true);
  });

  it("이 저장소의 `CLAUDE.md` 는 담기지 않는다", () => {
    // 그건 규약이 아니라 **이 저장소 사정**이다 — backlog·measured 포인터.
    // A 로 딸려가면 없는 경로를 가리키는 문서가 된다.
    expect(has(".claude/CLAUDE.md")).toBe(false);
  });

  it("실행 가능한 스크립트가 담긴다", () => {
    expect(has("scripts/harness.mjs")).toBe(true);
    expect(has("scripts/doctor.mjs")).toBe(true);
    expect(has("scripts/reap-worktrees.mjs")).toBe(true);
    expect(has("scripts/spawn.ps1")).toBe(true);
  });

  it("설치기가 담긴다", () => {
    // `install/` 이 빠지면 `npm i` 는 되는데 `harness init` 이 죽는다.
    expect(has("install/init.mjs")).toBe(true);
    expect(has("install/sync.mjs")).toBe(true);
    expect(has("install/smoke.mjs")).toBe(true);
  });

  it("테스트는 담기지 않는다", () => {
    // 담기면 A 의 러너가 남의 하네스 테스트를 돌린다.
    expect(packed.filter((p) => p.endsWith(".test.mjs"))).toEqual([]);
  });

  it("이 저장소의 제품 코드와 산출물은 담기지 않는다", () => {
    // `src/` 는 이 저장소의 예제이고 `harness/` 는 여기서 돌린 task 의 spec 이다.
    // 남의 저장소에 그것이 딸려 가면 안 된다.
    expect(packed.filter((p) => p.startsWith("src/"))).toEqual([]);
    expect(packed.filter((p) => p.startsWith("harness/"))).toEqual([]);
    expect(packed.filter((p) => p.startsWith("docs/"))).toEqual([]);
  });

  it("이 저장소 전용 설정은 담기지 않는다", () => {
    // 러너 설정과 permissions 는 A 가 자기 것을 갖는다. 덮어쓰면 안 된다.
    expect(has("vitest.config.mjs")).toBe(false);
    expect(has(".claude/settings.json")).toBe(false);
  });

  it("`bin` 이 가리키는 파일이 실제로 담긴다", () => {
    // 없는 파일을 가리키면 설치는 되는데 명령이 죽는다.
    const { bin } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

    for (const target of Object.values(bin)) {
      expect(has(target.replace(/^\.\//, "")), target).toBe(true);
    }
  });

  it("`exports` 가 가리키는 디렉터리의 파일이 담긴다", () => {
    // `exports` 는 A 의 shim 이 훅 본체를 찾는 경로다. 비어 있으면 shim 이 전부 죽는다.
    const { exports: map } = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    );

    for (const [subpath, target] of Object.entries(map)) {
      if (!target.endsWith("*")) continue;
      const dir = target.replace(/^\.\//, "").replace(/\*$/, "");
      expect(packed.some((p) => p.startsWith(dir)), `${subpath} → ${dir}`).toBe(true);
    }
  });
});

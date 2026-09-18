import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONFIG_FILE,
  CONFIG_PATHS,
  DEFAULTS,
  findConfig,
  loadConfig,
  mainWorktreeRoot,
} from "./harness-config.mjs";

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
    expect(config.specBaseBranches).toEqual(DEFAULTS.specBaseBranches);
  });

  it("전부 덮을 수도 있다", () => {
    const config = loadConfig(
      tree({
        gate: "pytest -q",
        source: ["app/**", "lib/**"],
        harnessFiles: [".claude/**"],
        specRoot: "docs/specs",
        protectedBranches: ["trunk"],
        specBaseBranches: ["release/1.0"],
        notify: { urlEnv: "MY_HOOK", events: ["push"] },
      }),
    );

    expect(config).toEqual({
      gate: "pytest -q",
      source: ["app/**", "lib/**"],
      harnessFiles: [".claude/**"],
      specRoot: "docs/specs",
      protectedBranches: ["trunk"],
      specBaseBranches: ["release/1.0"],
      notify: { urlEnv: "MY_HOOK", events: ["push"] },
    });
  });

  it("specBaseBranches — protectedBranches 와 별개로 설정한다", () => {
    // 직접 커밋 금지 판정(protectedBranch())은 이 필드를 보지 않는다. base 후보에만 쓰인다.
    const config = loadConfig(tree({ specBaseBranches: ["refactore/shk/component-split"] }));

    expect(config.specBaseBranches).toEqual(["refactore/shk/component-split"]);
    expect(config.protectedBranches).toEqual(DEFAULTS.protectedBranches);
  });

  describe("notify — URL 은 여기 없다", () => {
    it("설정이 없으면 두 지점이 다 켜져 있다 — 실질 스위치는 URL 의 존재다", () => {
      expect(loadConfig(tree(null)).notify).toEqual({
        urlEnv: "HARNESS_NOTIFY_URL",
        events: ["notification", "push"],
      });
    });

    it("키 단위로 채운다 — `events` 만 적어도 `urlEnv` 는 기본값이다", () => {
      expect(loadConfig(tree({ notify: { events: ["push"] } })).notify).toEqual({
        urlEnv: "HARNESS_NOTIFY_URL",
        events: ["push"],
      });
    });

    it("**빈 `events` 는 살린다** — 다른 배열과 달리 여기서는 정당한 의도다", () => {
      // 버리고 기본값으로 되돌리면 끄려던 사람이 끌 수가 없다.
      expect(loadConfig(tree({ notify: { events: [] } })).notify.events).toEqual([]);
    });

    it("객체가 아니면 통째로 기본값이다", () => {
      for (const broken of ["켜짐", ["push"], 3, null]) {
        expect(loadConfig(tree({ notify: broken })).notify).toEqual(DEFAULTS.notify);
      }
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

/**
 * `loadConfig` 가 worktree 사본이 아니라 **본체**에서 읽는지. 설치되는 프로젝트는
 * `.claude/` 를 gitignore 하고 `post-checkout`(심기)로 채우는데, 그 심기가 실패하면
 * (환경에 따라 실측됨) 사본엔 설정 파일이 아예 없다. 이때도 본체 값이 그대로 적용돼야
 * "심기가 됐든 안 됐든 동작이 같다"가 성립한다.
 */
describe("본체(main worktree) 기준 — worktree 사본에 파일이 없어도 본체 값을 쓴다", () => {
  const fixtures = [];

  afterEach(() => {
    while (fixtures.length) rmSync(fixtures.pop(), { recursive: true, force: true });
  });

  /** `GIT_` 접두어를 지운 env. 임시 저장소를 겨냥하므로 부모의 `GIT_DIR` 을 물려받으면 안 된다. */
  function cleanEnv() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("GIT_")) env[key] = value;
    }
    return env;
  }

  function git(cwd, args) {
    return execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
  }

  /** 본체 + 링크된 worktree 하나를 만든다. 본체엔 config 를, worktree 엔 아무것도 안 둔다. */
  function repoWithWorktree(config) {
    const main = mkdtempSync(join(tmpdir(), "harness-config-main-"));
    fixtures.push(main);
    git(main, ["init", "-q", "-b", "main"]);
    git(main, ["config", "user.email", "hook@example.invalid"]);
    git(main, ["config", "user.name", "hook"]);
    writeFileSync(join(main, "a.txt"), "a\n");
    if (config) {
      mkdirSync(join(main, ".claude"), { recursive: true });
      writeFileSync(join(main, ".claude", CONFIG_FILE), JSON.stringify(config));
    }
    git(main, ["add", "-A"]);
    git(main, ["commit", "-q", "-m", "base"]);

    const copy = join(main, "..", `harness-config-copy-${Math.random().toString(16).slice(2)}`);
    git(main, ["worktree", "add", "-q", "-b", "side", copy]);
    fixtures.push(copy);

    return { main, copy };
  }

  it("worktree 사본엔 config 가 없어도 본체 값을 읽는다", () => {
    const { copy } = repoWithWorktree({ specRoot: "본체값" });

    expect(loadConfig(copy).specRoot).toBe("본체값");
  });

  it("본체 자신에서 불러도 그대로 동작한다 — 첫 줄이 자기 자신이다", () => {
    const { main } = repoWithWorktree({ specRoot: "본체값" });

    expect(loadConfig(main).specRoot).toBe("본체값");
  });

  it("본체에도 config 가 없으면 여전히 기본값이다", () => {
    const { copy } = repoWithWorktree(null);

    expect(loadConfig(copy)).toEqual({ ...DEFAULTS });
  });

  it("git 저장소가 아니면 판정하지 않고 받은 경로 그대로 쓴다", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-config-nogit-"));
    fixtures.push(dir);
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ specRoot: "그대로" }));

    expect(mainWorktreeRoot(dir)).toBeNull();
    expect(loadConfig(dir).specRoot).toBe("그대로");
  });
});

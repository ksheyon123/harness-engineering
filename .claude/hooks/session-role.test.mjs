import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./session-role.mjs", import.meta.url));

const fixtures = [];

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

/**
 * 부모의 `HARNESS_*` 를 지운 env. 이 테스트를 **작업 세션 안에서** 돌리면 실제
 * `HARNESS_ROLE` 을 물려받아, '미설정이면 실행자' 를 검증하는 케이스가 조용히 통과한다.
 */
function baseEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("HARNESS_")) env[key] = value;
  }
  return { ...env, ...extra };
}

function seedFile(body) {
  const dir = mkdtempSync(join(tmpdir(), "session-role-"));
  fixtures.push(dir);
  const path = join(dir, "seed.txt");
  writeFileSync(path, body);
  return path;
}

function runHook({ env = {}, source = "startup" } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source }),
    encoding: "utf8",
    env: baseEnv(env),
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    out: stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null,
  };
}

describe("session-role — SessionStart 역할 주입 훅", () => {
  it("HARNESS_ROLE 이 없으면 실행자로 선언한다", () => {
    // 부재가 곧 실행자다. 맨몸 claude 에는 아무도 변수를 심어주지 않는다.
    const { status, out } = runHook();

    expect(status).toBe(0);
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain("실행자");
    expect(out.additionalContext).toContain("spawn.ps1");
  });

  it("work-session 이면 작업 세션으로 선언한다", () => {
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" } });

    expect(out.additionalContext).toContain("작업 세션");
    expect(out.additionalContext).toContain("기획자 모드로 시작한다");
  });

  it("아는 값이 아니면 실행자로 흡수하지 않고 판정 불가를 알린다", () => {
    // 오설정을 기본값으로 삼키면 역할이 틀린 채로 일이 굴러가고 아무도 모른다.
    const { out } = runHook({ env: { HARNESS_ROLE: "planner" } });

    expect(out.additionalContext).toContain("판정할 수 없다");
    expect(out.additionalContext).toContain("planner");
  });

  it("공백뿐인 값은 미설정으로 본다", () => {
    const { out } = runHook({ env: { HARNESS_ROLE: "   " } });

    expect(out.additionalContext).toContain("실행자");
  });

  it("startup 이면 사람의 원문을 첫 메시지로 싣는다", () => {
    const path = seedFile('로그인 "소셜" 로 만들어줘\n줄바꿈도 있다');

    const { out } = runHook({
      env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: path },
    });

    // 파일로 건네는 이유가 이것이다 — 따옴표와 줄바꿈이 온전히 넘어와야 한다.
    expect(out.initialUserMessage).toBe('로그인 "소셜" 로 만들어줘\n줄바꿈도 있다');
  });

  it("소비한 seed 파일은 지운다", () => {
    // 사람의 요청 원문이 담긴 파일이다. 남겨두면 임시 디렉터리에 계속 쌓인다.
    const path = seedFile("로그인 만들어줘");

    runHook({ env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: path } });

    expect(existsSync(path)).toBe(false);
  });

  it("BOM 이 붙은 seed 도 읽는다", () => {
    // PowerShell 5.1 의 Set-Content -Encoding UTF8 이 BOM 을 붙인다.
    const path = seedFile("﻿로그인 만들어줘");

    const { out } = runHook({
      env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: path },
    });

    expect(out.initialUserMessage).toBe("로그인 만들어줘");
  });

  it.each(["resume", "clear", "compact", "fork"])(
    "%s 에는 seed 를 다시 싣지 않는다",
    (source) => {
      // 다시 실으면 이미 하던 작업을 처음부터 또 시킨다.
      const path = seedFile("로그인 만들어줘");

      const { out } = runHook({
        env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: path },
        source,
      });

      expect(out.initialUserMessage).toBeUndefined();
      expect(out.additionalContext).toContain("작업 세션");
    },
  );

  it("seed 파일을 읽지 못해도 역할 선언은 남는다", () => {
    // seed 를 잃는 것과 역할을 잃는 것은 무게가 다르다. 원문은 사람이 다시 말하면 된다.
    const { status, out } = runHook({
      env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: join(tmpdir(), "없는-파일.txt") },
    });

    expect(status).toBe(0);
    expect(out.initialUserMessage).toBeUndefined();
    expect(out.additionalContext).toContain("작업 세션");
  });

  it("빈 seed 파일은 첫 메시지를 만들지 않는다", () => {
    const { out } = runHook({
      env: { HARNESS_ROLE: "work-session", HARNESS_SEED_FILE: seedFile("   \n") },
    });

    expect(out.initialUserMessage).toBeUndefined();
  });
});

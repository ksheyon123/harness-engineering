import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./session-role.mjs", import.meta.url));

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

  it.each(["startup", "resume", "clear", "compact", "fork"])(
    "%s 에도 역할을 다시 싣는다",
    (source) => {
      // 환경변수를 고른 이유가 이것이다 — 대화에 적어둔 역할 선언은 /clear 에 사라지지만
      // 변수는 프로세스에 남고, 훅은 그때마다 다시 돈다.
      const { out } = runHook({ env: { HARNESS_ROLE: "work-session" }, source });

      expect(out.additionalContext).toContain("작업 세션");
    },
  );

  it("첫 메시지를 만들지 않는다 — 원문은 spawn 이 직접 건넨다", () => {
    // 훅의 initialUserMessage 는 설치된 버전에서 아무 일도 일으키지 않았다.
    // 파이프라인 진입이 그 필드에 걸려 있으면 조용히 실패한다.
    const { out } = runHook({ env: { HARNESS_ROLE: "work-session" } });

    expect(out.initialUserMessage).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["additionalContext", "hookEventName"]);
  });
});

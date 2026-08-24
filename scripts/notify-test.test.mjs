import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FIELD_PREFIX } from "../.claude/hooks/notify.mjs";
import { notifyTest, report } from "./notify-test.mjs";

let tree;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "harness-notify-test-"));
  mkdirSync(join(tree, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

const config = (notify) =>
  writeFileSync(join(tree, ".claude/harness.config.json"), JSON.stringify({ notify }));

/** 호출을 기록하는 전송기. */
function sender(result = { sent: true, reason: null }) {
  const calls = [];
  return { calls, send: async (event, options) => (calls.push({ event, options }), result) };
}

describe("harness notify — 배선을 지금 확인한다", () => {
  it("사람이 준 문구를 싣는다", async () => {
    const { calls, send } = sender();

    await notifyTest(tree, "안녕", { send, env: {} });

    expect(calls[0].options.text).toContain("안녕");
  });

  it("문구가 없으면 기본 문구를 쓴다", async () => {
    const { calls, send } = sender();

    await notifyTest(tree, "  ", { send, env: {} });

    expect(calls[0].options.text).toContain("하네스 알림 시험");
  });

  it("**`notify.events` 를 건너뛴다** — 좁혀 둔 설정이 확인을 막으면 함정이 된다", async () => {
    config({ events: [] }); // 아무 지점에서도 안 쏘도록 꺼 둔 상태
    const { calls, send } = sender();

    const result = await notifyTest(tree, "x", { send, env: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].options.config.notify.events).toEqual(["test"]);
    // 그래도 사람에게는 실제 설정을 알려 준다 — 확인은 됐지만 실전은 안 도는 상태다.
    expect(result.events).toEqual([]);
  });

  it("**`urlEnv` 는 갈아 끼우지 않는다** — 확인하려는 것이 그 값이다", async () => {
    config({ urlEnv: "MY_HOOK" });
    const { calls, send } = sender();

    await notifyTest(tree, "x", { send, env: {} });

    expect(calls[0].options.config.notify.urlEnv).toBe("MY_HOOK");
  });

  it("얹은 필드의 **이름만** 보고한다 — 값은 비밀이다", async () => {
    writeFileSync(join(tree, ".claude/harness.env"), `${FIELD_PREFIX}chat_id=-1001234567890\n`);
    const { send } = sender();

    const result = await notifyTest(tree, "x", { send, env: {} });

    expect(result.fields).toEqual(["chat_id"]);
    expect(JSON.stringify(result)).not.toContain("1001234567890");
  });
});

describe("report", () => {
  it("실패하면 어디를 고치는지 적는다", () => {
    const text = report({ sent: false, reason: "목적지가 400 로 답했다.", fields: [], events: ["push"] });

    expect(text).toContain("400");
    expect(text).toContain(".claude/harness.env");
  });

  it("성공했는데 `events` 가 비었으면 그 사실을 말한다", () => {
    // 확인은 통과했는데 실전에서는 한 발도 안 나가는 상태다. 조용하면 안 된다.
    const text = report({ sent: true, reason: null, fields: ["chat_id"], events: [] });

    expect(text).toContain("chat_id");
    expect(text).toContain("`notify.events` 가 비어 있다");
  });
});

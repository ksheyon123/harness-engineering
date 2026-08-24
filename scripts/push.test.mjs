import { describe, expect, it } from "vitest";

import { push, report } from "./push.mjs";

/** 호출을 기록하는 러너. 종료 코드는 인자로 정한다. */
function runner(status) {
  const calls = [];
  return { calls, run: (args, cwd) => (calls.push({ args, cwd }), status) };
}

/** 호출을 기록하는 전송기. */
function sender(result = { sent: true, reason: null }) {
  const calls = [];
  return { calls, send: async (event, options) => (calls.push({ event, options }), result) };
}

const TREE = "/tmp/tree";

describe("harness push", () => {
  it("인자를 `git push` 에 그대로 넘긴다", async () => {
    const { calls, run } = runner(0);
    const { send } = sender();

    await push(TREE, ["-u", "origin", "feat/x"], { run, send });

    expect(calls).toEqual([{ args: ["push", "-u", "origin", "feat/x"], cwd: TREE }]);
  });

  it("성공하면 `push` 이벤트를 쏜다", async () => {
    const { run } = runner(0);
    const { calls, send } = sender();

    const result = await push(TREE, ["origin", "feat/x"], { run, send });

    expect(result.status).toBe(0);
    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe("push");
    expect(calls[0].options.baseDir).toBe(TREE);
  });

  it("**실패하면 쏘지 않는다** — 이 명령이 존재하는 이유가 이것이다", async () => {
    const { run } = runner(1);
    const { calls, send } = sender();

    const result = await push(TREE, ["origin", "feat/x"], { run, send });

    expect(result.status).toBe(1);
    expect(calls).toEqual([]);
  });

  it("신호로 죽은 경우(`null`)도 성공으로 읽지 않는다", async () => {
    const { run } = runner(null);
    const { calls, send } = sender();

    const result = await push(TREE, ["origin", "feat/x"], { run, send });

    expect(result.status).toBe(1); // `null` 을 흘리면 부르는 쪽이 종료 코드로 못 쓴다.
    expect(calls).toEqual([]);
  });

  it("알림이 실패해도 push 는 성공으로 남는다", async () => {
    const { run } = runner(0);
    const { send } = sender({ sent: false, reason: "목적지가 500 로 답했다." });

    const result = await push(TREE, ["origin", "feat/x"], { run, send });

    expect(result.status).toBe(0);
    expect(result.sent).toBe(false);
  });
});

describe("report", () => {
  it("push 실패와 알림 실패를 가른다 — 뭉치면 다시 올리려 든다", () => {
    expect(report({ args: ["origin", "x"], status: 1, sent: false, reason: null })).toContain(
      "push 가 실패했다",
    );

    const noticeFailed = report({ args: ["origin", "x"], status: 0, sent: false, reason: "이유" });
    expect(noticeFailed).toContain("push 했다");
    expect(noticeFailed).toContain("알림은 보내지 않았다");
  });
});

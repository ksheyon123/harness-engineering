import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENV_FILE, TIMEOUT_MS, loadSecrets, notify, parseEnvFile, resolveUrl } from "./notify.mjs";

/** 설정 없이 도는 기본값과 같은 모양. 테스트가 `loadConfig` 를 타지 않게 직접 준다. */
const CONFIG = { notify: { urlEnv: "HARNESS_NOTIFY_URL", events: ["notification", "push"] } };

const URL_VALUE = "https://hooks.example.test/services/AAA/BBB/CCC";

let tree;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "harness-notify-"));
  mkdirSync(join(tree, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

const writeEnv = (contents) => writeFileSync(join(tree, ENV_FILE), contents);

describe("parseEnvFile", () => {
  it("`KEY=value` 를 읽는다", () => {
    expect(parseEnvFile("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("주석과 빈 줄을 버린다", () => {
    expect(parseEnvFile("# 설명\n\nA=1\n  # 들여쓴 주석\n")).toEqual({ A: "1" });
  });

  it("따옴표를 벗긴다", () => {
    expect(parseEnvFile(`A="1"\nB='2'`)).toEqual({ A: "1", B: "2" });
  });

  it("값 안의 `=` 를 살린다 — URL 의 쿼리스트링이 그렇다", () => {
    expect(parseEnvFile("U=https://x.test/?a=1&b=2")).toEqual({ U: "https://x.test/?a=1&b=2" });
  });

  it("`=` 없는 줄과 이름 없는 줄을 버린다", () => {
    expect(parseEnvFile("쓰레기\n=값\nA=1")).toEqual({ A: "1" });
  });

  it("CRLF 를 견딘다 — Windows 에서 편집되는 파일이다", () => {
    expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("loadSecrets", () => {
  it("파일이 없으면 빈 객체다 — 없는 것은 오류가 아니다", () => {
    expect(loadSecrets(tree)).toEqual({});
  });

  it("`.claude/harness.env` 를 읽는다", () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    expect(loadSecrets(tree)).toEqual({ HARNESS_NOTIFY_URL: URL_VALUE });
  });
});

describe("resolveUrl", () => {
  it("파일의 값을 쓴다", () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    expect(resolveUrl(tree, CONFIG.notify, {}).url).toBe(URL_VALUE);
  });

  it("파일이 없으면 환경변수로 넘어간다", () => {
    expect(resolveUrl(tree, CONFIG.notify, { HARNESS_NOTIFY_URL: URL_VALUE }).url).toBe(URL_VALUE);
  });

  it("**파일이 환경변수를 이긴다** — 자리가 고정이라 판정이 흔들리지 않는다", () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const other = "https://other.example.test/hook";
    expect(resolveUrl(tree, CONFIG.notify, { HARNESS_NOTIFY_URL: other }).url).toBe(URL_VALUE);
  });

  it("`urlEnv` 가 어느 키를 읽을지 정한다", () => {
    writeEnv(`MY_HOOK=${URL_VALUE}\n`);
    expect(resolveUrl(tree, { urlEnv: "MY_HOOK", events: [] }, {}).url).toBe(URL_VALUE);
  });

  it("값이 없으면 `null` 이고 이유를 준다", () => {
    const { url, reason } = resolveUrl(tree, CONFIG.notify, {});
    expect(url).toBeNull();
    expect(reason).toContain("HARNESS_NOTIFY_URL");
  });

  it("http(s) 가 아니면 거부하고 **값을 찍지 않는다**", () => {
    writeEnv("HARNESS_NOTIFY_URL=file:///etc/passwd\n");
    const { url, reason } = resolveUrl(tree, CONFIG.notify, {});
    expect(url).toBeNull();
    expect(reason).not.toContain("passwd");
  });
});

describe("notify", () => {
  /** 호출을 기록하는 `fetch`. 응답은 인자로 정한다. */
  function spy(response = { ok: true, status: 200 }) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    };
    return { calls, impl };
  }

  it("URL 이 없으면 아무것도 쏘지 않는다 — **스위치는 URL 의 존재다**", async () => {
    const { calls, impl } = spy();
    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(calls).toEqual([]);
    expect(result.sent).toBe(false);
  });

  it("`events` 에 없는 지점은 쏘지 않는다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { calls, impl } = spy();

    const result = await notify("push", {
      baseDir: tree,
      text: "x",
      fetchImpl: impl,
      env: {},
      config: { notify: { urlEnv: "HARNESS_NOTIFY_URL", events: ["notification"] } },
    });

    expect(calls).toEqual([]);
    expect(result.reason).toContain("notify.events");
  });

  it("POST 로 쏘고, 바디에 `text` 와 `content` 를 둘 다 담는다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { calls, impl } = spy();

    const result = await notify("push", {
      baseDir: tree,
      text: "올렸다",
      detail: { branch: "feat/x" },
      fetchImpl: impl,
      env: {},
      config: CONFIG,
    });

    expect(result).toEqual({ sent: true, reason: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_VALUE);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe("application/json");

    // Slack 은 `text` 를, Discord 는 `content` 를 읽는다. 목적지별 포맷터 없이
    // 흔한 목적지가 그냥 붙는 것이 이 바디의 요점이다.
    expect(JSON.parse(calls[0].init.body)).toEqual({
      event: "push",
      text: "올렸다",
      content: "올렸다",
      detail: { branch: "feat/x" },
    });
  });

  it("타임아웃 신호를 건다 — 응답 없는 목적지가 훅을 멈추면 안 된다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { calls, impl } = spy();

    await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_MS).toBeLessThan(60_000); // 훅의 기본 상한보다 짧아야 곁다리로 남는다.
  });

  it("목적지가 실패로 답해도 **던지지 않는다**", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { impl } = spy({ ok: false, status: 404 });

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("404");
  });

  it("전송이 던져도 삼킨다 — 알림 실패가 판정을 뒤집지 않는다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { impl } = spy(new Error("boom"));

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("boom");
  });

  it("**오류 메시지에서 URL 과 오리진을 지운다**", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    // `fetch` 의 실패는 대상 주소를 그대로 담는다. 그것이 전사·로그로 새면 안 된다.
    const { impl } = spy(new Error(`request to ${URL_VALUE} failed, host hooks.example.test`));

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.reason).not.toContain(URL_VALUE);
    expect(result.reason).not.toContain("hooks.example.test");
    expect(result.reason).toContain("<URL>");
  });
});

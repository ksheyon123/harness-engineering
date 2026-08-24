import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ENV_FILE,
  FIELD_PREFIX,
  TIMEOUT_MS,
  extraFields,
  loadSecrets,
  notify,
  parseEnvFile,
  resolveUrl,
  secretRoots,
} from "./notify.mjs";

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

/**
 * **사본에서 본체의 비밀을 읽는가.**
 *
 * 이 테스트가 없어서 놓쳤다. 알림이 존재하는 이유는 오케스트레이터 모드(사람이 떠나
 * 있다)인데, 그 모드는 **항상 worktree 사본 안에서 돈다.** 비밀은 추적되지 않으니 사본에
 * 도달하지 않고, 그래서 기능이 **정확히 필요한 자리에서만** 죽었다. 본체에서 돌린 검증은
 * 전부 초록이었다.
 */
describe("secretRoots — worktree 사본에서 본체까지", () => {
  /** `GIT_*` 를 씻어 낸 git 러너. 안 씻으면 진짜 저장소를 건드린다. */
  function git(cwd) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    return (args) => execFileSync("git", args, { cwd, env, stdio: "ignore" });
  }

  /** 커밋 하나와 사본 하나를 가진 저장소. 사본 자리는 실제 규약과 같다. */
  function repoWithWorktree() {
    const main = mkdtempSync(join(tmpdir(), "harness-wt-"));
    const run = git(main);

    run(["init", "-b", "main"]);
    run(["config", "user.email", "t@t"]);
    run(["config", "user.name", "t"]);
    writeFileSync(join(main, "README.md"), "x\n");
    run(["add", "-A"]);
    run(["commit", "-m", "첫 커밋"]);

    const copy = join(main, ".claude/worktrees/task");
    run(["worktree", "add", "-b", "task", copy]);

    mkdirSync(join(main, ".claude"), { recursive: true });
    return { main, copy };
  }

  let repo;

  beforeEach(() => {
    repo = repoWithWorktree();
  });

  afterEach(() => {
    rmSync(repo.main, { recursive: true, force: true });
  });

  it("본체에서는 자기 트리 하나뿐이다", () => {
    expect(secretRoots(repo.main)).toEqual([repo.main]);
  });

  it("사본에서는 자기 트리 **다음에** 본체를 본다", () => {
    const [first, second] = secretRoots(repo.copy);

    expect(first).toBe(repo.copy);
    expect(second.replace(/\\/g, "/")).toBe(repo.main.replace(/\\/g, "/"));
  });

  it("**사본에서 본체의 비밀을 읽는다** — 이것이 안 되면 작업 세션은 조용히 끝난다", () => {
    writeFileSync(join(repo.main, ENV_FILE), `HARNESS_NOTIFY_URL=${URL_VALUE}\n`);

    expect(loadSecrets(repo.copy)).toEqual({ HARNESS_NOTIFY_URL: URL_VALUE });
    expect(resolveUrl(repo.copy, CONFIG.notify, {}).url).toBe(URL_VALUE);
  });

  it("고정 필드도 같이 따라온다 — 텔레그램의 `chat_id` 가 사본에서 빠지면 400 이다", () => {
    writeFileSync(join(repo.main, ENV_FILE), `${FIELD_PREFIX}chat_id=-100123\n`);

    expect(extraFields(repo.copy, {})).toEqual({ chat_id: "-100123" });
  });

  it("사본에 있으면 그것이 이긴다 — 가까운 트리가 우선이다", () => {
    mkdirSync(join(repo.copy, ".claude"), { recursive: true });
    writeFileSync(join(repo.main, ENV_FILE), "HARNESS_NOTIFY_URL=본체\n");
    writeFileSync(join(repo.copy, ENV_FILE), "HARNESS_NOTIFY_URL=사본\n");

    expect(loadSecrets(repo.copy).HARNESS_NOTIFY_URL).toBe("사본");
  });

  it("git 저장소가 아니면 자기 트리만 본다 — 던지지 않는다", () => {
    expect(secretRoots(tree)).toEqual([tree]);
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

describe("extraFields — 바디에 얹을 고정 필드", () => {
  it("접두어를 뗀 이름으로 모은다", () => {
    writeEnv(`${FIELD_PREFIX}chat_id=-1001234567890\n${FIELD_PREFIX}parse_mode=HTML\n`);

    expect(extraFields(tree, {})).toEqual({ chat_id: "-1001234567890", parse_mode: "HTML" });
  });

  it("접두어 없는 키는 안 걷는다 — URL 이 바디에 실리면 안 된다", () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n${FIELD_PREFIX}chat_id=7\n`);

    expect(extraFields(tree, {})).toEqual({ chat_id: "7" });
  });

  it("접두어만 있고 이름이 없는 키는 버린다", () => {
    writeEnv(`${FIELD_PREFIX}=값\n`);

    expect(extraFields(tree, {})).toEqual({});
  });

  it("**파일이 환경변수를 이긴다** — `resolveUrl` 과 같은 우선순위다", () => {
    writeEnv(`${FIELD_PREFIX}chat_id=파일\n`);

    expect(extraFields(tree, { [`${FIELD_PREFIX}chat_id`]: "환경변수" })).toEqual({
      chat_id: "파일",
    });
  });

  it("환경변수만 있어도 걷는다 — 파일을 둘 수 없는 자리를 위한 대비책이다", () => {
    expect(extraFields(tree, { [`${FIELD_PREFIX}chat_id`]: "7" })).toEqual({ chat_id: "7" });
  });

  it("값을 해석하지 않는다 — `-100…` 도 `01` 도 문자열 그대로다", () => {
    writeEnv(`${FIELD_PREFIX}chat_id=01\n`);

    expect(extraFields(tree, {}).chat_id).toBe("01");
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

  it("고정 필드를 바디에 얹는다 — 텔레그램의 `chat_id` 가 이 길로 붙는다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n${FIELD_PREFIX}chat_id=-100123\n`);
    const { calls, impl } = spy();

    await notify("push", { baseDir: tree, text: "올렸다", fetchImpl: impl, env: {}, config: CONFIG });

    expect(JSON.parse(calls[0].init.body)).toEqual({
      chat_id: "-100123",
      event: "push",
      text: "올렸다",
      content: "올렸다",
    });
  });

  it("**고정 필드가 메시지 본문을 덮지 못한다** — 얹는 것은 더하기이지 바꾸기가 아니다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n${FIELD_PREFIX}text=엉뚱한 값\n`);
    const { calls, impl } = spy();

    await notify("push", { baseDir: tree, text: "진짜 메시지", fetchImpl: impl, env: {}, config: CONFIG });

    // 실수로 `text` 를 얹었다고 알림이 통째로 벙어리가 되면 안 된다.
    expect(JSON.parse(calls[0].init.body).text).toBe("진짜 메시지");
  });

  it("목적지가 실패로 답해도 **던지지 않는다**", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { impl } = spy({ ok: false, status: 404 });

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("404");
  });

  it("실패 응답의 **본문을 실어 준다** — 상태 코드만으로는 못 고치는 부류가 있다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    // 텔레그램이 정확히 이렇게 답한다. `chat_id` 누락도 토큰 오류도 다 400 대라,
    // 무엇이 문제인지는 본문에만 적혀 있다.
    const said = '{"ok":false,"error_code":400,"description":"Bad Request: chat_id is empty"}';
    const { impl } = spy({ ok: false, status: 400, text: async () => said });

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.reason).toContain("400");
    expect(result.reason).toContain("chat_id is empty");
  });

  it("응답 본문에서도 주소를 지운다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { impl } = spy({ ok: false, status: 400, text: async () => `bad request to ${URL_VALUE}` });

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.reason).not.toContain(URL_VALUE);
  });

  it("본문을 못 읽어도 판정은 그대로다", async () => {
    writeEnv(`HARNESS_NOTIFY_URL=${URL_VALUE}\n`);
    const { impl } = spy({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("스트림이 이미 소모됐다");
      },
    });

    const result = await notify("push", { baseDir: tree, text: "x", fetchImpl: impl, env: {}, config: CONFIG });

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("500");
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

/**
 * 알림 — 하네스가 저장소 밖으로 한 줄 쏘는 자리.
 *
 * ## 왜 MCP 가 아니라 HTTP POST 인가
 *
 * "훅에서 MCP 도구를 부른다" 는 **성립하지 않는다.** 훅은 Claude Code 가 띄우는 별개의
 * node 자식 프로세스이고, MCP 연결은 Claude Code 프로세스가 쥐고 있다 — 그 연결도 도구
 * 호출 채널도 자식에게 넘어오지 않는다. claude.ai 를 경유하는 서버(Slack·Notion 등)는
 * 더 분명하다: OAuth 토큰이 Claude Code 의 자격증명 저장소에 있고 훅이 읽을 자리에 없다.
 *
 * 훅이 stdout 으로 `systemMessage` 를 뱉어 **모델에게** "MCP 로 알려라" 고 시키는 우회는
 * 있다. 알림 채널로는 못 쓴다 — 모델이 할 수도 안 할 수도 있고, 애초에 이 알림이 필요한
 * 시점은 **사람도 모델도 떠나 있는 때**다. 그래서 훅이 자기 손으로 쏜다.
 *
 * ## 스위치는 URL 의 존재 하나다
 *
 * `notify.events` 로 지점을 좁힐 수는 있지만, **실질 스위치는 URL 이 있느냐**다. URL 이
 * 없으면 이 모듈은 아무것도 하지 않고 조용히 끝난다. 켜는 법이 "파일에 한 줄 적는다"
 * 하나이므로, 설정 파일을 두지 않는 저장소(이 저장소가 그렇다)에서도 그대로 돈다.
 *
 * ## 실패가 판정을 뒤집지 않는다
 *
 * `hook-kit.mjs` 의 `handoff` 와 같은 원칙이다. 알림은 곁다리이고, 목적지가 죽었다고
 * 승인 프롬프트나 push 가 막혀서는 안 된다. 모든 예외를 삼키고 **결과는 반환값으로만**
 * 보고한다. 타임아웃도 반드시 건다 — 응답 없는 엔드포인트 하나가 훅을 통째로 멈춘다.
 *
 * ## URL 은 어디에도 찍지 않는다
 *
 * 웹훅 URL 자체가 비밀이다(Slack Incoming Webhook 은 URL 을 아는 사람이 곧 발신 권한을
 * 갖는다). 그래서 오류 메시지에서 URL 과 오리진을 **지운 뒤** 내보낸다 — `fetch` 의
 * 실패 메시지에는 대상 주소가 그대로 들어 있고, 그것이 로그·전사(transcript)·PR 로 샌다.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "./harness-config.mjs";
import { cleanEnv } from "./hook-kit.mjs";

/**
 * 비밀이 사는 자리. **`.claude/` 아래다** — 하네스가 만드는 것이 한 접두어 아래 모여
 * 있어야 A 가 `.gitignore` 에 쓴 한 줄이 전부를 덮는다(`harness-config.mjs` 와 같은 근거).
 */
export const ENV_FILE = ".claude/harness.env";

/** 응답을 기다리는 상한. 훅의 상한(기본 60초)보다 훨씬 짧아야 곁다리로 남는다. */
export const TIMEOUT_MS = 5000;

/**
 * `KEY=value` 를 읽는다. **의존성을 들이지 않는다** — 훅은 A 의 `node_modules` 에
 * 상향 해석으로 걸리는 처지라, 여기서 패키지를 하나 요구하면 설치 상태에 따라 훅이 죽는다.
 *
 * 따옴표는 벗기고, `#` 로 시작하는 줄과 `=` 없는 줄은 버린다. 그 이상은 하지 않는다
 * (변수 전개·여러 줄 값 없음) — 웹훅 URL 한 줄에 필요한 문법이 그게 전부다.
 */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    if (key) out[key] = value;
  }
  return out;
}

/** 비밀 파일. 없거나 못 읽으면 빈 객체 — 알림이 안 갈 뿐 아무것도 깨지지 않는다. */
export function loadSecrets(baseDir) {
  const path = join(baseDir, ENV_FILE);
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * 쏠 주소를 정한다. **파일이 `process.env` 를 이긴다.**
 *
 * 훅이 물려받는 env 는 사람이 그 터미널을 **언제 어떻게 열었는지**에 달려 있어 재현되지
 * 않는다 — 같은 저장소에서 탭에 따라 알림이 가고 안 가는 상태가 된다. 파일은 자리가
 * 고정이라 판정이 흔들리지 않는다. env 는 파일을 둘 수 없는 자리(CI 등)를 위한 대비책이다.
 *
 * @returns {{url: string|null, reason: string|null}}
 */
export function resolveUrl(baseDir, notify, env = process.env) {
  const key = notify.urlEnv;
  const value = `${loadSecrets(baseDir)[key] ?? env[key] ?? ""}`.trim();

  if (!value) {
    return { url: null, reason: `\`${key}\` 가 \`${ENV_FILE}\` 에도 환경변수에도 없다.` };
  }
  if (!/^https?:\/\//i.test(value)) {
    // **값은 찍지 않는다.** 오타든 비밀이든 여기서 밖으로 나가서는 안 된다.
    return { url: null, reason: `\`${key}\` 가 http(s) 로 시작하지 않는다 — 값은 찍지 않는다.` };
  }
  return { url: value, reason: null };
}

/**
 * 알림 하나를 쏜다. **던지지 않는다** — 결과는 반환값이 전부다.
 *
 * 바디는 **범용 하나**다. `text` 는 Slack Incoming Webhook 이, `content` 는 Discord 가
 * 그대로 렌더하고, 둘 다 모르는 목적지는 나머지 키를 보면 된다. 목적지별 포맷터를 두지
 * 않은 이유가 이것이다 — 키 하나 더 넣는 값으로 흔한 목적지가 전부 그냥 붙는다.
 *
 * @param {string} event `harness.config.json` 의 `notify.events` 에 적히는 이름
 * @param {{baseDir: string, text: string, detail?: object, fetchImpl?: Function, env?: object, config?: object}} options
 * @returns {Promise<{sent: boolean, reason: string|null}>}
 */
export async function notify(event, options) {
  const {
    baseDir,
    text,
    detail,
    fetchImpl = globalThis.fetch,
    env = process.env,
    config = loadConfig(baseDir),
  } = options;

  const settings = config.notify;
  if (!settings.events.includes(event)) {
    return { sent: false, reason: `\`${event}\` 는 \`notify.events\` 에 없다.` };
  }

  const { url, reason } = resolveUrl(baseDir, settings, env);
  if (!url) return { sent: false, reason };

  if (typeof fetchImpl !== "function") {
    return { sent: false, reason: "이 런타임에 `fetch` 가 없다 — Node 18 이상이 필요하다." };
  }

  const body = { event, text, content: text, ...(detail ? { detail } : {}) };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response?.ok) {
      return { sent: false, reason: `목적지가 ${response?.status ?? "?"} 로 답했다.` };
    }
    return { sent: true, reason: null };
  } catch (error) {
    return { sent: false, reason: `전송이 실패했다 — ${scrub(error, url)}` };
  }
}

/**
 * 오류 메시지에서 주소를 지운다.
 *
 * `fetch` 의 실패는 대상 주소를 메시지에 그대로 담는다(`request to https://… failed`).
 * 그 메시지가 훅의 출력·전사·사람의 터미널로 나가므로 **긴 것부터 차례로 지운다** —
 * 전체 URL · 오리진 · 호스트. DNS·TLS 실패는 전체 URL 이 아니라 호스트만 들고 나온다.
 *
 * 과하게 지워도 잃는 것이 없다. 여기서 필요한 것은 *무엇이 왜 실패했는가*이지 주소가
 * 아니고, 주소는 이미 사람이 자기 파일에 적어 둔 것이다.
 */
function scrub(error, url) {
  const message =
    error?.name === "TimeoutError"
      ? `${TIMEOUT_MS}ms 안에 답이 없다`
      : (error?.message ?? String(error));

  const secrets = [url];
  try {
    const parsed = new URL(url);
    secrets.push(parsed.origin, parsed.host);
  } catch {
    /* 파싱이 안 돼도 전체 URL 치환은 그대로 성립한다. */
  }

  return secrets.reduce((text, secret) => (secret ? text.split(secret).join("<URL>") : text), message);
}

/**
 * 알림 문구에 붙일 저장소 문맥. **전부 best-effort 다** — 못 읽으면 빈 문자열이고,
 * 알림 자체는 그대로 나간다. 문맥을 못 읽었다고 알림을 접으면 본말이 뒤집힌다.
 */
export function context(baseDir) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: baseDir,
        env: cleanEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };

  const top = run(["rev-parse", "--show-toplevel"]);
  return {
    repo: top ? top.replace(/\\/g, "/").split("/").filter(Boolean).pop() : "",
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

/** `repo/branch` 한 토막. 둘 다 없으면 빈 문자열이라 문구에서 자연히 빠진다. */
export function where(baseDir) {
  const { repo, branch } = context(baseDir);
  return [repo, branch].filter(Boolean).join("/");
}

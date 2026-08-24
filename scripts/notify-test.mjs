#!/usr/bin/env node
/**
 * `harness notify [메시지]` — **알림 배선을 지금 여기서 확인한다.**
 *
 * ## 왜 이 명령이 필요한가
 *
 * 알림이 실제로 나가는 지점은 둘 다 **사람이 자리에 없을 때** 돈다(승인 대기 · push
 * 성공). 그래서 잘못 붙였을 때 그 사실을 알게 되는 시점이 **정확히 알림이 필요했던
 * 순간**이고, 그때는 이미 늦었다. 붙이는 사람이 붙인 자리에서 확인할 수단이 있어야 한다.
 *
 * 텔레그램을 붙이면서 이것이 분명해졌다 — URL 에 토큰을 넣고 `chat_id` 를 얹는 과정에
 * 틀릴 자리가 셋이고, 셋 다 400 대 한 줄로만 드러난다.
 *
 * ## `events` 를 건너뛴다
 *
 * 이 명령은 이벤트가 아니라 **사람이 친 것**이다. `notify.events` 를 좁혀 둔 사람이
 * 배선을 확인하지 못하면 그 설정이 곧 함정이 된다. 대신 URL 은 건너뛰지 않는다 —
 * 확인하려는 것이 바로 그 값이다.
 */

import { fileURLToPath } from "node:url";

import { loadConfig } from "../.claude/hooks/harness-config.mjs";
import { ENV_FILE, extraFields, notify, where } from "../.claude/hooks/notify.mjs";

const EVENT = "test";

/**
 * 시험 알림 하나를 쏜다.
 *
 * @param {string} tree 설정과 비밀을 읽을 트리
 * @param {string} [message] 사람이 준 문구. 없으면 기본 문구
 * @param {{send?: Function, env?: object}} [seams] 테스트가 갈아 끼우는 자리
 */
export async function notifyTest(tree, message, seams = {}) {
  const { send = notify, env = process.env } = seams;

  const settings = loadConfig(tree).notify;
  const place = where(tree);
  const text = `${message?.trim() || "하네스 알림 시험"}${place ? `\n— ${place}` : ""}`;

  const { sent, reason } = await send(EVENT, {
    baseDir: tree,
    text,
    detail: { source: "harness notify" },
    env,
    // **`events` 만 갈아 끼운다.** `urlEnv` 는 그대로 둬야 확인하려는 그 값을 확인한다.
    config: { notify: { ...settings, events: [EVENT] } },
  });

  return { sent, reason, fields: Object.keys(extraFields(tree, env)), events: settings.events };
}

/** 경로 비교는 `gate.mjs`·`push.mjs` 와 같은 방식이다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const result = await notifyTest(process.cwd(), process.argv.slice(2).join(" "));
  process.stdout.write(report(result));
  process.exit(result.sent ? 0 : 1);
}

/**
 * 사람이 읽을 결과. **실패했을 때 다음 수를 적는다** — 여기까지 온 사람은 방금 배선을
 * 만졌고, 알고 싶은 것은 '실패' 가 아니라 '어디를 고치나' 다.
 *
 * @param {{sent: boolean, reason: string|null, fields: string[], events: string[]}} result
 */
export function report({ sent, reason, fields, events }) {
  const laid = fields.length > 0 ? `\`${fields.join("\` · \`")}\`` : "없다";

  if (sent) {
    return (
      `\n알림을 보냈다. 목적지에 도착했는지는 거기서 확인해라.\n` +
      `  바디에 얹은 필드: ${laid}\n` +
      `  실제로 쏘는 지점: ${events.length > 0 ? `\`${events.join("\` · \`")}\`` : "**없다** — `notify.events` 가 비어 있다"}\n\n`
    );
  }

  return (
    `\n알림을 보내지 못했다 — ${reason ?? "이유를 모른다."}\n` +
    `  바디에 얹은 필드: ${laid}\n` +
    `  URL 과 필드는 \`${ENV_FILE}\` 에 있다(없으면 \`.claude/harness.env.example\` 을 복사해라).\n\n`
  );
}

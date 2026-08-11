#!/usr/bin/env node
/**
 * `harness.config.json` 을 검사해 **사람에게 보고한다.** 아무것도 막지 않는다.
 *
 * ## 왜 로더가 아니라 여기인가
 *
 * `loadConfig` 는 깨진 값을 만나면 기본값으로 돌아가고 **아무 말도 하지 않는다.** 그게
 * 맞는 선택이었다 — 훅에서 던지면 차단이 아니라 **통과**가 된다. `PreToolUse` 훅이 죽으면
 * 층 1 이 통째로 사라지는데 신호조차 없고, 그건 잘못된 값으로 도는 것보다 나쁘다.
 *
 * 그래서 조용함의 대가를 여기서 치른다. 이 저장소에서는 기본값이 곧 정답이라 티가 안 나지만,
 * **남의 저장소에서는 기본값이 곧 틀린 값**이다 — `specRoot` 를 `"spec"` 으로 잘못 적으면
 * 층 1 이 엉뚱한 경로를 지키고, `qa` 는 자기 산출물을 못 쓰고, 아무도 이유를 모른다.
 *
 * ## 무엇이 error 이고 무엇이 warning 인가
 *
 * - **error** — `loadConfig` 가 그 값을 **버린다**. 적은 대로 동작하지 않는다는 뜻이다
 * - **warning** — 값은 살아 있지만 의도와 다를 공산이 크다(모르는 키, 아무것도 안 걸리는
 *   패턴). 판정할 수 없으니 사람에게 넘긴다
 *
 * 검사 항목은 **`DEFAULTS` 에서 끌어온다.** 유효한 키와 그 타입을 여기 또 적으면 사본이
 * 되고, 설정에 키가 하나 늘 때 이 파일만 낡는다.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { matches } from "../.claude/hooks/glob.mjs";
import { CONFIG_FILE, DEFAULTS, loadConfig } from "../.claude/hooks/harness-config.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { MANIFEST_PATH, parseManifest } from "../install/managed.mjs";

/** 경로 패턴을 쓰는 키. 저장소에 실제로 걸리는지 확인할 수 있는 것들이다. */
const PATH_KEYS = ["source", "harnessFiles"];

/** 이 패키지의 루트. 설치본에서는 `node_modules/<이름>/` 이 된다. */
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function diagnose(baseDir) {
  const notes = [...installNotes(baseDir)];
  const path = join(baseDir, CONFIG_FILE);

  if (!existsSync(path)) {
    notes.push({
      level: "info",
      text:
        `\`${CONFIG_FILE}\` 이 없다 — 기본값으로 돈다. ` +
        `이 저장소는 기본값이 곧 설정이라 정상이다.`,
    });
    return notes;
  }

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return [{ level: "error", text: `\`${CONFIG_FILE}\` 을 읽을 수 없다 — ${error.message}` }];
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return [
      {
        level: "error",
        text:
          `\`${CONFIG_FILE}\` 이 JSON 이 아니다 — ${error.message}\n` +
          `    파일 전체가 무시되고 **모든 값이 기본값으로 돈다.**`,
      },
    ];
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [
      {
        level: "error",
        text: `\`${CONFIG_FILE}\` 의 최상위가 객체가 아니다 — 파일 전체가 무시된다.`,
      },
    ];
  }

  notes.push(...keyProblems(raw));
  notes.push(...pathProblems(loadConfig(baseDir), baseDir));
  return notes;
}

/**
 * 설치본이 낡았는가.
 *
 * A 의 복사본(`harness.md` · `agents/*.md` · shim)은 `npm update` 로 갱신되지 않는다.
 * 낡으면 **에이전트는 옛 규약대로 돌고 훅은 새 규칙으로 판정한다** — 그 어긋남을 아무도
 * 알아채지 못하는 것이 문제라, 물어볼 수 있는 유일한 자리가 여기다.
 *
 * 설치되지 않은 저장소(이 저장소가 그렇다)에서는 아무 말도 하지 않는다.
 */
function installNotes(baseDir) {
  const manifestPath = join(baseDir, MANIFEST_PATH);
  if (!existsSync(manifestPath)) return []; // 설치본이 아니다.

  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  if (!manifest) {
    return [{ level: "error", text: `\`${MANIFEST_PATH}\` 를 읽을 수 없다 — \`harness sync\` 가 판단 근거를 잃는다.` }];
  }

  const installed = installedVersion(baseDir);
  if (!installed) {
    return [
      {
        level: "warning",
        text: `설치본은 \`${manifest.version}\` 인데 패키지를 찾지 못했다 — \`node_modules\` 가 없는가?`,
      },
    ];
  }
  if (installed === manifest.version) return [];

  return [
    {
      level: "warning",
      text:
        `복사본이 \`${manifest.version}\` 인데 패키지는 \`${installed}\` 다. ` +
        `\`harness sync\` 로 다시 써라 — 안 하면 에이전트가 옛 규약대로 돈다.`,
    },
  ];
}

/** A 에 깔린 패키지의 버전. `node_modules` 에서 읽는다. */
function installedVersion(baseDir) {
  try {
    const own = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    const path = join(baseDir, "node_modules", own.name, "package.json");
    return JSON.parse(readFileSync(path, "utf8")).version;
  } catch {
    return null;
  }
}

/** 키 이름과 타입. **`DEFAULTS` 가 정답지다** — 여기에 목록을 또 두지 않는다. */
function keyProblems(raw) {
  const notes = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULTS)) {
      notes.push({
        level: "warning",
        text:
          `\`${key}\` 는 모르는 키다 — 조용히 무시된다. 오타인가?\n` +
          `    쓸 수 있는 키: ${Object.keys(DEFAULTS).join(" · ")}`,
      });
      continue;
    }

    const wantsList = Array.isArray(DEFAULTS[key]);
    if (wantsList !== Array.isArray(value)) {
      notes.push({
        level: "error",
        text:
          `\`${key}\` 는 ${wantsList ? "문자열 배열" : "문자열"} 이어야 하는데 ` +
          `${describe(value)} 이다 — 이 키는 버려지고 기본값으로 돈다.`,
      });
      continue;
    }

    if (wantsList) notes.push(...listProblems(key, value));
    else if (!(typeof value === "string" && value.trim())) {
      notes.push({
        level: "error",
        text: `\`${key}\` 가 비어 있다 — 이 키는 버려지고 기본값으로 돈다.`,
      });
    }
  }

  return notes;
}

function listProblems(key, value) {
  const usable = value.filter((v) => typeof v === "string" && v.trim());

  if (usable.length === 0) {
    return [
      {
        level: "error",
        text:
          `\`${key}\` 에 쓸 수 있는 값이 하나도 없다 — 이 키는 버려지고 기본값으로 돈다.\n` +
          `    빈 배열은 '아무 경로도 지키지 않는다' 가 아니라 오타로 본다.`,
      },
    ];
  }

  if (usable.length < value.length) {
    return [
      {
        level: "warning",
        text: `\`${key}\` 의 항목 ${value.length - usable.length}개가 문자열이 아니라 걸러진다.`,
      },
    ];
  }

  return [];
}

/** 패턴이 저장소의 무언가에 실제로 걸리는가. 추적되는 파일만 본다. */
function pathProblems(config, baseDir) {
  const notes = [];

  if (!existsSync(join(baseDir, config.specRoot))) {
    notes.push({
      level: "warning",
      text:
        `\`specRoot\` 가 가리키는 \`${config.specRoot}/\` 가 없다. ` +
        `아직 task 를 한 번도 돌리지 않았다면 정상이다.`,
    });
  }

  const files = trackedFiles(baseDir);
  if (files === null) {
    notes.push({ level: "info", text: "git 을 못 써서 경로 패턴이 걸리는지는 확인하지 못했다." });
    return notes;
  }

  // **패턴 하나가 아니라 키 전체로 본다.** 목록에는 있어도 되고 없어도 되는 항목이
  // 섞인다 — `package-lock.json` 은 yarn·pnpm 프로젝트에 없고 `vitest.config.mjs` 는
  // 다른 러너를 쓰면 없다. 하나씩 걸고 넘어지면 멀쩡한 설정이 경고를 넷씩 뱉고,
  // **그렇게 흔한 경고는 곧 아무도 안 읽는다.**
  //
  // 대가: `["src/**", "app/**"]` 처럼 하나만 오타 난 경우는 못 잡는다. 키 전체가 헛도는
  // 것 — 남의 저장소 구조를 통째로 옮겨 적은 경우 — 만 잡는다.
  for (const key of PATH_KEYS) {
    const patterns = config[key];
    if (patterns.some((pattern) => files.some((file) => matches(pattern, file)))) continue;

    notes.push({
      level: "warning",
      text:
        `\`${key}\` 의 패턴 중 어느 것도 추적되는 파일을 걸지 않는다 ` +
        `(${patterns.join(" · ")}). 다른 저장소의 구조를 그대로 옮겨 적은 것은 아닌가?`,
    });
  }

  return notes;
}

function trackedFiles(baseDir) {
  try {
    // `GIT_DIR` 이 상속돼 있으면 git 은 `cwd` 탐색을 통째로 건너뛰고 그 값을 쓴다 —
    // `baseDir` 을 겨냥한 것처럼 보이는 명령이 다른 저장소를 읽는다.
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: baseDir,
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "배열";
  return typeof value === "string" ? "빈 문자열" : typeof value;
}

const LABEL = { error: "✗ 오류", warning: "! 확인", info: "· 참고" };

/** 경로 비교는 `reap-worktrees` 와 같은 방식이다 — Windows 는 구분자도 대소문자도 흔들린다. */
function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

/** 직접 실행됐을 때만 보고한다(테스트는 위 함수들을 직접 부른다). */
if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  process.exit(report(diagnose(process.cwd())));
}

/** @returns {number} 종료 코드. 오류가 있으면 1, 아니면 0. */
export function report(notes, write = (s) => process.stdout.write(s)) {
  const errors = notes.filter((n) => n.level === "error");

  if (notes.length === 0) {
    write("설정에 문제가 없다.\n");
    return 0;
  }

  write(
    `\n${notes.map((n) => `  ${LABEL[n.level]}  ${n.text}`).join("\n")}\n\n` +
      (errors.length > 0
        ? `오류 ${errors.length}개 — 그 값들은 적은 대로 동작하지 않는다.\n\n`
        : "오류는 없다. 위는 확인해 볼 것들이다.\n\n"),
  );

  return errors.length > 0 ? 1 : 0;
}

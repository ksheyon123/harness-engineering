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
import { CONFIG_FILE, CONFIG_PATHS, DEFAULTS, findConfig, loadConfig } from "../.claude/hooks/harness-config.mjs";
import { cleanEnv } from "../.claude/hooks/hook-kit.mjs";
import { MANIFEST_PATH, managedPaths, parseManifest } from "../install/managed.mjs";

/** 경로 패턴을 쓰는 키. 저장소에 실제로 걸리는지 확인할 수 있는 것들이다. */
const PATH_KEYS = ["source", "harnessFiles"];

/** 이 패키지의 루트. 설치본에서는 `node_modules/<이름>/` 이 된다. */
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function diagnose(baseDir) {
  const notes = [...installNotes(baseDir), ...ignoreLeak(baseDir), ...posttestLeak(baseDir)];
  const found = findConfig(baseDir);

  if (!found) {
    notes.push({
      level: "info",
      text:
        `\`${CONFIG_PATHS[0]}\` 이 없다 — 기본값으로 돈다. ` +
        `이 저장소는 기본값이 곧 설정이라 정상이다.`,
    });
    return notes;
  }

  notes.push(...configLocation(baseDir, found));
  const { path, relative } = found;

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return [{ level: "error", text: `\`${relative}\` 을 읽을 수 없다 — ${error.message}` }];
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return [
      {
        level: "error",
        text:
          `\`${relative}\` 이 JSON 이 아니다 — ${error.message}\n` +
          `    파일 전체가 무시되고 **모든 값이 기본값으로 돈다.**`,
      },
    ];
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [
      {
        level: "error",
        text: `\`${relative}\` 의 최상위가 객체가 아니다 — 파일 전체가 무시된다.`,
      },
    ];
  }

  notes.push(...keyProblems(raw));
  notes.push(...pathProblems(loadConfig(baseDir), baseDir));
  return notes;
}

/**
 * 설정이 어디 있는가. **읽은 자리를 반드시 찍는다** — 자리가 둘이 된 뒤로는 "설정이 있다"
 * 만으로는 어느 것이 먹었는지 알 수 없고, 그 모호함이 정확히 이 검사가 막으려는 것이다.
 */
function configLocation(baseDir, found) {
  const notes = [{ level: "info", text: `설정을 \`${found.relative}\` 에서 읽었다.` }];

  const shadowed = found.relative !== CONFIG_FILE && existsSync(join(baseDir, CONFIG_FILE));
  if (shadowed) {
    notes.push({
      level: "warning",
      text:
        `루트의 \`${CONFIG_FILE}\` 은 **읽히지 않는다** — \`${CONFIG_PATHS[0]}\` 이 이긴다. ` +
        `둘을 두면 어느 쪽을 고쳤는지 헷갈린다. 루트 것을 지워라.`,
    });
  }

  if (found.legacy) {
    notes.push({
      level: "warning",
      text:
        `설정이 루트에 있다 — \`${CONFIG_PATHS[0]}\` 으로 옮겨라. 하네스가 만드는 것이 ` +
        `한 접두어 아래 모여 있어야 \`.gitignore\` 한 줄로 커밋 여부를 정할 수 있다. ` +
        `지금은 이 파일만 그 결정 밖에 있다.`,
    });
  }

  return notes;
}

/**
 * **A 의 무시 결정이 하네스 경로 일부에만 걸려 있는가.**
 *
 * ## 왜 보고만 하나
 *
 * 커밋할지 말지는 **A 가 정한다**(3번에서 확정한 원칙). 그래서 하네스는 `.gitignore` 를
 * 대신 쓰지도, `.git/info/exclude` 에 몰래 적지도 않는다. 할 수 있는 것은 **결정이 새고
 * 있다고 말해 주는 것**뿐이다.
 *
 * ## 왜 이것이 문제인가
 *
 * `pre-commit` 이 `git add -A`(전체 스테이징)를 강제한다. 그래서 무시되지 **않은** 하네스
 * 파일은 다음 커밋에 **반드시** 딸려 들어간다 — A 가 `.claude/` 를 무시해 두고도
 * `.githooks/` 는 커밋하게 되는 식이다. 결정이 반쪽만 적용된다.
 *
 * ## 왜 `smoke` 가 아니라 여기인가
 *
 * `smoke` 는 *배선이 사는가*를 판정한다(ok/broken). 이건 배선이 죽는 문제가 아니다 —
 * 커밋되든 안 되든 하네스는 돈다. 어긋나는 것은 **A 의 의도**이고, 그것을 판정할 자격은
 * 우리에게 없다. 보고하고 넘긴다.
 *
 * **전부 무시되거나 전부 안 되면 조용하다.** 그건 일관된 결정이다.
 */
function ignoreLeak(baseDir) {
  const paths = managedPaths().filter((path) => existsSync(join(baseDir, path)));
  if (paths.length === 0) return [];

  let ignored;
  try {
    // 걸리는 것이 하나도 없으면 종료 코드 1 이라 던진다 — **오류가 아니라 답이다.**
    ignored = new Set(
      execFileSync("git", ["check-ignore", "--", ...paths], {
        cwd: baseDir,
        env: cleanEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    ignored = new Set();
  }

  const loose = paths.filter((path) => !ignored.has(path));
  if (ignored.size === 0 || loose.length === 0) return [];

  return [
    {
      level: "warning",
      text:
        `하네스 경로 중 **일부만** 무시된다 — ${ignored.size}개는 무시되고 ${loose.length}개는 아니다.\n` +
        `    안 되는 것: \`${loose.slice(0, 4).join("` · `")}\`${loose.length > 4 ? ` 외 ${loose.length - 4}개` : ""}\n` +
        `    \`pre-commit\` 이 \`git add -A\` 를 강제하므로 **다음 커밋에 딸려 들어간다.**\n` +
        `    의도한 것이면 그대로 두고, 아니면 \`.gitignore\` 에 직접 적어라.`,
    },
  ];
}

/**
 * **`posttest` 배선이 옵트인 경계를 넘는가.**
 *
 * 하네스는 로컬 설정(`core.hooksPath`)으로 옵트인한다 — 클론에 안 따라오므로 설치하지
 * 않은 사람에게는 안 붙는다. 그런데 `package.json` 은 **언제나 추적되므로** 거기 걸린
 * `posttest` 한 줄은 커밋을 타고 팀 전체에 전파되고, `npm test` 는 Claude Code 밖에서
 * 개발자와 CI 가 매일 치는 명령이다.
 *
 * 그 전파가 무엇을 하는지는 **하네스 파일이 추적되는가**에 달려 있다(실측):
 *
 * | 하네스 파일 | 설치한 적 없는 사람의 `npm test` |
 * |---|---|
 * | 커밋된다 | 돈다. 마커가 써지는데 읽을 `pre-push` 가 없다 — **죽은 파일이 쌓인다** |
 * | 무시된다 | **`MODULE_NOT_FOUND` 로 죽는다.** 테스트는 통과했는데 종료 코드 1, CI 도 같이 |
 *
 * **뒤엣것만 경고한다.** 앞엣것은 지저분할 뿐 아무것도 안 깨뜨리고, 무엇보다 `posttest`
 * 를 거는 것은 **A 의 결정**이다 — `init` 은 더 이상 배선하지 않지만, A 가 스스로 걸었다면
 * 그 선택을 뒤집을 자격이 우리에게 없다. 깨지는 조합일 때만 말한다.
 */
function posttestLeak(baseDir) {
  let posttest = "";
  try {
    posttest = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")).scripts?.posttest ?? "";
  } catch {
    return []; // `package.json` 이 없거나 깨졌다 — 배선도 없다.
  }
  if (!`${posttest}`.includes("mark-verified.mjs")) return [];

  // 그 배선이 가리키는 파일이 동료에게 가는가. 안 가면 그 사람의 `npm test` 가 죽는다.
  const target = ".githooks/mark-verified.mjs";
  if (!existsSync(join(baseDir, target)) || !isIgnored(baseDir, target)) return [];

  return [
    {
      level: "warning",
      text:
        `\`posttest\` 가 \`${target}\` 을 부르는데 **그 파일은 무시된다.**\n` +
        `    \`package.json\` 은 언제나 추적되므로 이 배선만 커밋을 타고 팀에 전파되고,\n` +
        `    하네스를 설치한 적 없는 동료와 CI 의 \`npm test\` 가 \`MODULE_NOT_FOUND\` 로 죽는다\n` +
        `    — **테스트는 다 통과했는데도.** \`posttest\` 를 빼고 \`harness gate\` 로 돌려라.`,
    },
  ];
}

/** 한 경로가 무시되는가. **git 에게 묻는다** — `.gitignore` 를 글자로 읽으면 틀린다. */
function isIgnored(baseDir, path) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], {
      cwd: baseDir,
      env: cleanEnv(),
      stdio: "ignore",
    });
    return true;
  } catch {
    return false; // 종료 코드 1 = 무시 안 됨. **오류가 아니라 답이다.**
  }
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

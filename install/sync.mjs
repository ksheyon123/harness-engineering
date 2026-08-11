#!/usr/bin/env node
/**
 * `harness sync` — 설치본의 **복사본**을 패키지의 현재 버전으로 다시 쓴다.
 *
 * ## 왜 필요한가
 *
 * `npm update` 는 `node_modules` 만 갱신한다. 그런데 A 에는 복사본이 산다 —
 * `harness.md` · `planner-mode.md` · `agents/*.md` · shim 들. 그것들은 갱신되지 않으므로,
 * 패키지가 올라가면 **A 의 `developer` 는 옛 규약대로 돌고 훅은 새 규칙으로 판정한다.**
 *
 * 복사가 회피가 아니라 유일한 수단이었다는 것은 `managed.mjs` 에 적혀 있다.
 *
 * ## 무엇을 건드리고 무엇을 안 건드리나
 *
 * **하네스가 통째로 소유하는 것만** 다시 쓴다. 병합해서 만든 것(`settings.json` ·
 * `.gitignore` · `package.json` · A 의 `CLAUDE.md`)은 손대지 않는다 — 그건 A 의
 * 파일이고 하네스는 거기 몇 줄을 얹었을 뿐이다. 그것들이 바뀌어야 하면 `init` 이
 * 다시 병합한다.
 *
 * ## A 가 손댄 것은 덮지 않는다
 *
 * `developer.md` 를 자기 스택에 맞게 고치는 것은 정당하다. 기록부의 해시와 다르면
 * **A 가 손댔다는 뜻**이므로 덮지 않고 알린다. `init` 이 `core.hooksPath` 를 빼앗지
 * 않는 것과 같은 규칙이다.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GITHOOK_SHIMS,
  HOOK_SHIMS,
  MANIFEST_PATH,
  VERBATIM,
  hashOf,
  manifestContents,
  parseManifest,
} from "./managed.mjs";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_JSON = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const PKG_NAME = MANIFEST_JSON.name;
const PKG_VERSION = MANIFEST_JSON.version;

/** 하네스가 소유하는 파일과, 지금 패키지가 만들어야 할 내용. */
function desired() {
  const out = [];

  for (const name of HOOK_SHIMS) {
    out.push({ path: `.claude/hooks/${name}`, contents: `import "${PKG_NAME}/hooks/${name}";\n` });
  }
  for (const name of GITHOOK_SHIMS) {
    out.push({ path: `.githooks/${name}`, contents: `import "${PKG_NAME}/githooks/${name}";\n` });
  }
  for (const item of VERBATIM) {
    out.push({
      path: item.to,
      contents: readFileSync(join(PKG, item.from), "utf8"),
      exec: item.exec ?? false,
    });
  }

  return out;
}

/**
 * 무엇을 다시 쓸지 정한다. **파일을 건드리지 않는다.**
 *
 * @returns {{installed: string|null, version: string, steps: object[], conflicts: object[]}}
 */
export function plan(tree) {
  const manifestPath = join(tree, MANIFEST_PATH);
  const manifest = existsSync(manifestPath)
    ? parseManifest(readFileSync(manifestPath, "utf8"))
    : null;

  const steps = [];
  const conflicts = [];

  for (const item of desired()) {
    const full = join(tree, item.path);

    if (!existsSync(full)) {
      // 설치 뒤에 지워졌거나, 그 사이 하네스에 새로 생긴 파일이다. 어느 쪽이든 만든다.
      steps.push({ ...item, state: "create" });
      continue;
    }

    const current = readFileSync(full, "utf8");
    if (hashOf(current) === hashOf(item.contents)) {
      steps.push({ ...item, state: "same" });
      continue;
    }

    const recorded = manifest?.files?.[item.path];
    if (recorded && recorded === hashOf(current)) {
      // 설치한 그대로다 — A 가 손댄 적 없으니 안전하게 갱신한다.
      steps.push({ ...item, state: "update" });
      continue;
    }

    conflicts.push({
      path: item.path,
      reason: recorded
        ? "설치한 뒤 이 파일이 바뀌었다 — 덮으면 그 변경이 사라진다."
        : "설치 기록이 없어 A 가 손댄 것인지 판단할 수 없다.",
    });
  }

  return { installed: manifest?.version ?? null, version: PKG_VERSION, steps, conflicts };
}

/** 판정대로 다시 쓴다. **충돌한 파일은 건너뛰고 나머지는 갱신한다.** */
export function apply(tree) {
  const result = plan(tree);
  const applied = [];

  for (const step of result.steps) {
    if (step.state === "same") continue;
    const full = join(tree, step.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, step.contents);
    if (step.exec) makeExecutable(full);
    applied.push(step);
  }

  // 기록부는 **실제로 지금 있는 내용**을 담아야 한다. 충돌해서 안 덮은 파일까지 새 해시로
  // 적으면, 다음 `sync` 가 그 파일을 '설치 그대로' 로 오해하고 조용히 덮는다.
  const files = {};
  for (const step of result.steps) {
    const full = join(tree, step.path);
    if (existsSync(full)) files[step.path] = hashOf(readFileSync(full, "utf8"));
  }
  for (const conflict of result.conflicts) {
    const full = join(tree, conflict.path);
    if (existsSync(full)) files[conflict.path] = hashOf(readFileSync(full, "utf8"));
  }

  const manifestFull = join(tree, MANIFEST_PATH);
  mkdirSync(dirname(manifestFull), { recursive: true });
  writeFileSync(manifestFull, manifestContents({ version: PKG_VERSION, files }));

  return { ...result, applied };
}

function makeExecutable(path) {
  try {
    chmodSync(path, 0o755);
  } catch {
    /* Windows 에는 실행권한이 없다. 파일은 만들어졌으므로 판정을 뒤집지 않는다. */
  }
}

function normalize(path) {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  main();
}

function main() {
  const tree = process.cwd();
  const dryRun = process.argv.includes("--dry-run");

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: tree,
      stdio: "ignore",
      env: cleanGitEnv(),
    });
  } catch {
    process.stderr.write("git 저장소가 아니다.\n");
    process.exit(1);
  }

  process.exit(report(dryRun ? plan(tree) : apply(tree), dryRun));
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

export function report(result, dryRun, write = (s) => process.stdout.write(s)) {
  const { installed, version, steps, conflicts, applied } = result;

  if (installed === null) {
    write(
      "\n설치 기록(`" + MANIFEST_PATH + "`)이 없다. `harness init` 을 먼저 돌려라 — " +
        "기록이 없으면 A 가 손댄 파일과 그렇지 않은 파일을 가를 수 없다.\n\n",
    );
  }

  const changed = applied ?? steps.filter((s) => s.state !== "same");

  write(
    `\n설치본: ${installed ?? "(기록 없음)"} · 패키지: ${version}\n\n` +
      (changed.length === 0
        ? "  · 다시 쓸 것이 없다.\n"
        : changed.map((s) => `  ${s.state === "create" ? "+" : "~"} ${s.path}\n`).join("")),
  );

  if (conflicts.length > 0) {
    write(
      `\n손대지 않은 것 — 설치 뒤에 바뀌었다:\n\n` +
        conflicts.map((c) => `  ! ${c.path} — ${c.reason}`).join("\n") +
        `\n\n갱신본과 견주려면 \`node_modules/${PKG_NAME}\` 아래의 원본과 비교해라.\n`,
    );
  }

  write("\n");
  // 충돌은 실패가 아니다 — 사람이 볼 것이 있다는 뜻이고, 나머지는 이미 갱신됐다.
  return 0;
}

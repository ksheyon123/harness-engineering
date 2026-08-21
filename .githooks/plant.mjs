#!/usr/bin/env node
/**
 * 심기의 판정과 복사. **훅 본체(`post-checkout.mjs`)에서 갈라 둔 이유가 있다.**
 *
 * 설치본에서 A 의 `.githooks/post-checkout.mjs` 는 패키지를 임포트하는 **한 줄짜리 shim**
 * 이다. 그래서 훅 본체는 `import` 되는 것만으로 판정을 내고 끝나야 한다 — `pre-commit`·
 * `pre-push` 와 같은 계약이다. 거기에 `process.argv[1] === import.meta.url` 같은 main 가드를
 * 씌우면 **shim 을 타고 들어온 실행에서는 두 값이 달라 아무것도 안 돈다.**
 *
 * 실제로 그렇게 만들었다가 실측에서 잡았다: 훅은 불리고 종료 코드도 0 인데 사본에는
 * 아무것도 안 심겼다. 조용한 실패의 교과서적인 모양이다.
 *
 * 그런데 테스트는 이 판정을 **불러다 직접** 부를 수 있어야 한다. 두 요구가 한 파일에서
 * 충돌하므로 파일을 가른다 — 여기는 순수 함수만 있고 임포트해도 아무 일도 일어나지 않는다.
 * (`verified-marker.mjs` 가 `pre-push`·`mark-verified` 사이에서 같은 자리에 있다.)
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { managedPaths } from "../install/managed.mjs";

/**
 * 사본에 있어야 하는 것.
 *
 * **목록을 손으로 적지 않는다** — `managedPaths()` 에서 짓는다. 손 목록은 `sync` 가 파일을
 * 하나 더 얹을 때 이 훅만 그것을 모르고, 새 파일은 미추적으로 태어나므로 **하필 가장
 * 필요한 순간에** 빠진다.
 *
 * 거기에 더하는 것은 하네스가 *소유하지 않는* 것들이다 — A 의 파일에 하네스가 몇 줄을
 * 얹었을 뿐이라 `managedPaths()` 에 들 수 없지만, 사본에 없으면 그 층이 죽는다:
 *
 * | 더하는 것 | 없으면 |
 * |---|---|
 * | `.claude/settings.json` | **층 1 과 `SessionStart` 가 통째로 죽는다.** 사본에서는 여기가 유일한 출처다 |
 * | `.claude/CLAUDE.md` | `@harness.md` 가 안 펼쳐진다 — 조상의 `CLAUDE.md` 는 로드돼도 **그 임포트는 안 펼쳐진다**(실측) |
 * | `harness.config.json` | 게이트 명령·spec 위치가 기본값으로 조용히 되돌아간다 |
 * | `.claude/harness/` | 벤더링본. shim 이 이걸 상대경로로 부르게 되면 없는 곳을 가리킨다 |
 *
 * **`.claude/worktrees/` 는 여기 없다.** 목적지가 원본 안에 중첩돼 있어 통째 복사는
 * 재귀에 걸려 **조용히 절반만 복사하고 성공을 반환한다**(실측). 목록을 명시하는 이유가
 * 이것이고, 그래서 이 함수는 절대 "`.claude/` 전부" 로 넓어지면 안 된다.
 */
export function plantList() {
  return [
    ...managedPaths(),
    ".claude/settings.json",
    ".claude/CLAUDE.md",
    ".claude/harness.config.json",
    // 구 위치. 아직 옮기지 않은 설치본이 있다 — 있으면 같이 간다.
    "harness.config.json",
    ".claude/harness/",
  ];
}

/**
 * 본체의 하네스를 사본으로 심는다.
 *
 * ## 두 가지를 건너뛴다 — 이유가 서로 다르다
 *
 * - **본체에 없는 것**: 심을 것이 없는 것이지 실패가 아니다. 벤더링본도 `harness.config.json`
 *   도 선택 사항이라, 없다고 종료 코드를 물들이면 멀쩡한 저장소가 전부 빨개진다.
 * - **사본에 이미 있는 것**: `.claude/` 를 커밋하는 저장소에서는 사본이 `HEAD` 에서
 *   그것을 이미 받았다. 거기에 본체의 **워킹트리** 파일을 덮어쓰면, 본체에 미커밋 수정이
 *   있을 때 **사본이 dirty 해진다** — 갓 만든 사본의 `git status` 가 깨끗해야 한다는 것은
 *   협상 대상이 아니다(그 트리에서 인계 커밋이 찍힌다).
 *
 * 둘을 **따로 센다.** 합쳐 놓으면 `planted=0` 이 "이미 다 있었다"(정상)인지 "심을 목록이
 * 비었다"(고장)인지 구별되지 않는데, 그 둘은 진단이 정반대다.
 *
 * @param {string} main 본체 최상단
 * @param {string} copy 갓 만들어진 사본의 최상단
 * @returns {{planted: string[], present: string[], skipped: string[], failed: string[]}}
 */
export function plant(main, copy) {
  const planted = [];
  const present = [];
  const skipped = [];
  const failed = [];

  for (const rel of plantList()) {
    const from = join(main, rel);
    if (!existsSync(from)) {
      skipped.push(rel);
      continue;
    }

    let files;
    try {
      files = filesUnder(from, rel);
    } catch (error) {
      failed.push(`${rel} — ${firstLine(error)}`);
      continue;
    }

    for (const file of files) {
      const to = join(copy, file);
      if (existsSync(to)) {
        present.push(file);
        continue;
      }
      try {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(join(main, file), to);
        planted.push(file);
      } catch (error) {
        failed.push(`${file} — ${firstLine(error)}`);
      }
    }
  }

  return { planted, present, skipped, failed };
}

/** 저장소 기준 상대 경로들. 파일이면 자기 하나, 디렉터리면 그 아래 전부. */
function filesUnder(full, rel) {
  const path = rel.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!statSync(full).isDirectory()) return [path];

  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(join(full, entry.name), `${path}/${entry.name}`),
  );
}

const firstLine = (error) => `${error.message}`.split(/\r?\n/)[0];

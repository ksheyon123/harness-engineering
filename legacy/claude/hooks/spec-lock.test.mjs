import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { frontmatterBranch, isRevisionAttempt } from "./spec-lock.mjs";

// 규칙 2("한 브랜치는 spec 을 정확히 한 번 확정한다")의 판정 로직.
// pre-commit 이 이 파일을 CLI 로 부르고, 사람에게 보여줄 문구는 훅의 say() 가 낸다
// (SIGPIPE 방어를 셸 한 곳에 유지하기 위해 여기서는 아무것도 출력하지 않는다).

const CLI = join(dirname(fileURLToPath(import.meta.url)), "spec-lock.mjs");

// git 을 부르지 않는다 — stdin 에 문자열을 직접 파이프하므로 .claude/rules/test-git.md 의
// 대상이 아니다(픽스처 저장소가 없다).
const runCli = (input, branch) =>
  spawnSync(process.execPath, branch === undefined ? [CLI] : [CLI, branch], {
    input,
    encoding: "utf8",
  });

describe("frontmatterBranch", () => {
  it("frontmatter 의 branch 값을 읽는다", () => {
    expect(frontmatterBranch("---\nbranch: feat/a\n---\n\n# a\n")).toBe("feat/a");
  });

  it("값 앞뒤 공백을 트리밍한다", () => {
    expect(frontmatterBranch("---\nbranch:    feat/a   \n---\n")).toBe("feat/a");
  });

  // .gitattributes 가 eol=lf 를 고정하지만, git show 출력이 항상 LF 라는 보장에
  // 판정을 걸지 않는다 — 어긋나면 소유권 검사가 조용히 무력화된다.
  it("CRLF 입력에서도 동작한다", () => {
    expect(frontmatterBranch("---\r\nbranch: feat/a\r\n---\r\n")).toBe("feat/a");
  });

  it("첫 줄이 --- 가 아니면 null 이다", () => {
    expect(frontmatterBranch("# a\nbranch: feat/a\n")).toBeNull();
  });

  // 닫는 --- 가 없는데 본문 전체를 블록으로 오인하면, 본문의 branch: 가 소유자로 읽힌다.
  it("닫는 --- 가 없으면 null 이다", () => {
    expect(frontmatterBranch("---\nbranch: feat/a\n\n# a\n")).toBeNull();
  });

  // 이 설계의 핵심 개선점: sed 로 파일 전체를 훑으면 본문의 문장에 걸린다.
  it("frontmatter 밖의 branch: 는 값으로 쓰지 않는다", () => {
    expect(frontmatterBranch("---\ntitle: a\n---\n\nbranch: feat/a\n")).toBeNull();
  });

  it("frontmatter 안에 branch 가 없으면 null 이다", () => {
    expect(frontmatterBranch("---\ntitle: a\n---\n")).toBeNull();
  });

  it("빈 입력은 null 이다 (HEAD 에 spec 이 없는 최초 작성)", () => {
    expect(frontmatterBranch("")).toBeNull();
  });

  it("branch 가 여러 줄이면 첫 줄을 쓴다", () => {
    expect(frontmatterBranch("---\nbranch: feat/a\nbranch: feat/b\n---\n")).toBe("feat/a");
  });
});

describe("isRevisionAttempt", () => {
  const spec = (b) => `---\nbranch: ${b}\n---\n`;

  // §4-3 판정 표를 그대로 옮긴다.
  it("HEAD 의 소유 브랜치가 현재 브랜치와 같으면 재수정이다", () => {
    expect(isRevisionAttempt(spec("feat/a"), "feat/a")).toBe(true);
  });

  it("리비전 브랜치의 첫 개정은 재수정이 아니다", () => {
    expect(isRevisionAttempt(spec("feat/a"), "feat/a-1")).toBe(false);
  });

  it("HEAD 에 spec 이 없으면(최초 작성) 재수정이 아니다", () => {
    expect(isRevisionAttempt("", "feat/a")).toBe(false);
  });
});

describe("spec-lock CLI", () => {
  const spec = (b) => `---\nbranch: ${b}\n---\n`;

  it("재수정이면 종료코드 1 이다", () => {
    expect(runCli(spec("feat/a"), "feat/a").status).toBe(1);
  });

  it("다른 브랜치가 소유한 spec 이면 종료코드 0 이다", () => {
    expect(runCli(spec("feat/a"), "feat/a-1").status).toBe(0);
  });

  it("빈 입력이면 종료코드 0 이다", () => {
    expect(runCli("", "feat/a").status).toBe(0);
  });

  // 문구는 훅의 say() 가 낸다. 여기서 쓰면 파이프가 닫혔을 때 SIGPIPE 로 죽어
  // 종료코드가 사라질 수 있다 — 훅이 실제로 부딪혔던 실패 모드다.
  it("아무것도 출력하지 않는다", () => {
    const out = runCli(spec("feat/a"), "feat/a");
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("");
  });

  // 브랜치를 못 넘겼을 때 차단하면 원인을 알 수 없는 커밋 실패가 된다.
  it("브랜치 인자가 없으면 통과시킨다", () => {
    expect(runCli(spec("feat/a"), undefined).status).toBe(0);
  });
});

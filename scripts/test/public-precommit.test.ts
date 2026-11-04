import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// このファイルには検査に一致する文字列を残さない。鍵、メール、電話などは実行時に連結して作る。
const ROOT = path.resolve(import.meta.dirname, "..", "..");
// 古い版との比較のため、環境変数で hook を差し替えられる
const HOOK = process.env.PRECOMMIT_HOOK ?? path.join(ROOT, ".claude", "hooks", "public-precommit.sh");
const THIS_TEST = path.join(ROOT, "scripts", "test", "public-precommit.test.ts");
const TOOLS_TEST = path.join(ROOT, "scripts", "test", "claude-tools.test.ts");

const filler = (n: number, ch = "x") => ch.repeat(n);
const ANTHROPIC_KEY = ["sk", "ant", "api03", filler(24, "a")].join("-");
const GOOGLE_KEY = "AI" + "za" + filler(35, "b");
const PRIVATE_KEY_LINE = "-----BEGIN " + "RSA PRIVATE" + " KEY-----";
const EMAIL = ["taro.yamada", "farm-corp.co.jp"].join("@");
const PHONE = "03" + "-1234-" + "5678";

let tmp: string;
let repo: string;

// 本物の作業ツリーを検査しないよう、CLAUDE_PROJECT_DIR を外し、利用者の git 設定も読まない
function cleanEnv(): NodeJS.ProcessEnv {
  // TMPDIR は、hook が一時ファイルを残さないことの確認のため、この試験専用にする
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", TMPDIR: path.join(tmp, "tmpdir") };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function git(args: string[], cwd = repo) {
  const r = spawnSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(tmp, "repo-"));
  git(["init", "-q"], dir);
  git(["config", "user.email", "t@example.com"], dir);
  git(["config", "user.name", "t"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  return dir;
}

function write(rel: string, content: string | Buffer, dir = repo): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function stage(files: Record<string, string | Buffer>, dir = repo) {
  for (const [rel, content] of Object.entries(files)) write(rel, content, dir);
  git(["add", "-f", "--", ...Object.keys(files)], dir);
}

function runHook(command: string, dir = repo, input?: object) {
  const payload = input ?? { tool_name: "Bash", tool_input: { command }, cwd: dir };
  const r = spawnSync("bash", [HOOK], { cwd: dir, env: cleanEnv(), input: JSON.stringify(payload), encoding: "utf8" });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

const COMMIT = 'git commit -m "feat: x"';

// stderr は「ファイル:行:パターン名」の行だけ
function expectOnlyLocations(stderr: string) {
  for (const line of stderr.split("\n").filter(Boolean)) expect(line).toMatch(/^.+:\d+:[a-z_]+$/);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-precommit-"));
  fs.mkdirSync(path.join(tmp, "tmpdir"));
  repo = initRepo();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("git commit 以外は素通り", () => {
  it("commit でないコマンドは stage に何があっても通す", () => {
    stage({ "a.txt": `key ${ANTHROPIC_KEY}\n` });
    for (const cmd of ["ls -la", "git status", "git add a.txt", 'echo "git commit"', "git log --grep commit", "git commit-tree HEAD"]) {
      expect(runHook(cmd).status, cmd).toBe(0);
    }
  });

  it("Bash 以外の道具と壊れた入力は通す", () => {
    stage({ "a.txt": `key ${ANTHROPIC_KEY}\n` });
    expect(runHook("", repo, { tool_name: "Edit", tool_input: { command: COMMIT } }).status).toBe(0);
    const r = spawnSync("bash", [HOOK], { cwd: repo, env: cleanEnv(), input: "not json commit", encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("stage が清潔な commit は通す", () => {
    stage({ "a.txt": "hello\n" });
    const r = runHook(COMMIT);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});

describe("経路", () => {
  const cases: Array<[string, string]> = [
    ["private/notes.md", "private_path"],
    ["data/private/a.json", "private_path"],
    ["HANDOFF.md", "private_path"],
    ["CLAUDE.local.md", "private_path"],
    [".env", "env_file"],
    ["functions/.env.demo-hpai", "env_file"],
  ];
  for (const [rel, name] of cases) {
    it(`${rel} の stage を止める`, () => {
      stage({ [rel]: "ok\n", "a.txt": "ok\n" });
      const r = runHook(COMMIT);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`${rel}:0:${name}`);
      expectOnlyLocations(r.stderr);
    });
  }

  it(".env.example と名前の似た通常のファイルは止めない", () => {
    stage({ ".env.example": "KEY=\n", "docs/private-notes.md": "ok\n", "src/environment.ts": "ok\n" });
    expect(runHook(COMMIT).status).toBe(0);
  });

  it("stage 済みの経路ファイルの削除は止めない", () => {
    stage({ "private/x.txt": "ok\n" });
    git(["commit", "-q", "-m", "seed"]);
    git(["rm", "-q", "--cached", "--", "private/x.txt"]);
    expect(runHook(COMMIT).status).toBe(0);
  });
});

describe("内容の検査", () => {
  it("Anthropic の鍵を止める。stderr に名前があり値がない", () => {
    stage({ "src/a.ts": `// 1\nconst k = "${ANTHROPIC_KEY}";\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/a.ts:2:anthropic_key");
    expect(r.stderr).not.toContain(ANTHROPIC_KEY);
    expectOnlyLocations(r.stderr);
  });

  it("Google の鍵、秘密鍵、メール、電話を止める", () => {
    stage({
      "a.ts": `x\n${GOOGLE_KEY}\n`,
      "b.pem": `${PRIVATE_KEY_LINE}\n`,
      "c.md": `連絡先 ${EMAIL}\n`,
      "d.md": `\n\n電話は ${PHONE} です\n`,
    });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.ts:2:google_api_key");
    expect(r.stderr).toContain("b.pem:1:private_key");
    expect(r.stderr).toContain("c.md:1:email");
    expect(r.stderr).toContain("d.md:3:phone");
    for (const secret of [GOOGLE_KEY, PRIVATE_KEY_LINE, EMAIL, PHONE]) expect(r.stderr).not.toContain(secret);
    expectOnlyLocations(r.stderr);
  });

  it("追加した行だけを見る（既存の行や削除は見ない）", () => {
    stage({ "a.md": `${EMAIL}\n` });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    stage({ "a.md": `${EMAIL}\nsecond line\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(0);
  });

  it("除外の語と pkg@1.2.3 は止めない", () => {
    stage({
      "a.md": [
        "noreply" + "@anthropic.com",
        "dummy" + "@example.com",
        "dummy" + "@example.jp",
        "install pkg@1.2.3 and @scope/lib@4.5.6-rc.1",
        "00-0000-0000",
        "2026-11-03 と 2025-12-20T09:00:00+09:00",
        "https://doi.org/10.1038/s" + "42003-025-08687-4",
        "alert-agent_run_failed-paused-2026-11-" + "12000",
      ].join("\n") + "\n",
    });
    const r = runHook(COMMIT);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("英数字に続く番号は電話としない。記号や日本語に続く電話は止める", () => {
    stage({ "a.md": [`TEL:${PHONE}`, `（${PHONE}）`, `電話${PHONE}`, `${PHONE}0`].join("\n") + "\n" });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    for (const n of [1, 2, 3]) expect(r.stderr).toContain(`a.md:${n}:phone`);
    // 末尾に数字が続く番号は電話の形ではない
    expect(r.stderr).not.toContain("a.md:4:phone");
  });

  it("予約済みの例示用ドメインは止めない。似た名前の実在風のドメインは止める", () => {
    stage({
      "a.md": ["a", "b", "c", "d", "e"]
        .map((u, i) => u + "@" + ["example.test", "example.invalid", "example.org", "mail.example", "host.localhost"][i])
        .join("\n") + "\n",
    });
    expect(runHook(COMMIT).stderr).toBe("");

    git(["reset", "-q"]);
    stage({ "b.md": [["x", "notexample.org"], ["y", "example.org.co.jp"], ["z", "example.test.co.jp"]].map((p) => p.join("@")).join("\n") + "\n" });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    for (const n of [1, 2, 3]) expect(r.stderr).toContain(`b.md:${n}:email`);
  });

  it("除外の語と一緒の行でも、別の本物は止める", () => {
    stage({ "a.md": `dummy@example.com and ${EMAIL}\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:1:email");
  });

  it("package-lock.json とバイナリは見ない", () => {
    stage({
      "package-lock.json": `{"resolved": "${EMAIL}"}\n`,
      "web/package-lock.json": `${ANTHROPIC_KEY}\n`,
      "img.bin": Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`\n${EMAIL}\n`)]),
    });
    expect(runHook(COMMIT).status).toBe(0);
  });

  it("data/ の quote だけを止める", () => {
    stage({ "data/history/x.json": `{\n  "quote": "原文"\n}\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("data/history/x.json:2:data_quote");

    git(["reset", "-q"]);
    fs.rmSync(path.join(repo, "data"), { recursive: true });
    stage({ "web/x.json": `{"quote": "ok"}\n` });
    expect(runHook(COMMIT).status).toBe(0);
  });

  it("日本語の行番号と長い行でも位置が合う", () => {
    const body = ["日本語の行", "", "++ b/見かけ", `${"あ".repeat(5000)} ${EMAIL}`].join("\n") + "\n";
    stage({ "docs/ja.md": body });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("docs/ja.md:4:email");
    expect(r.stderr).not.toContain("docs/ja.md:3:");
  });
});

describe("非公開の語の一覧", () => {
  const WORD_ALNUM = "zzfarm" + "xq";
  const WORD_DIGITS = ["0861", "234567"].join("");
  const WORD_JA = "山田" + "農園";
  const WORD_README = "readme" + "only";
  const denylist = (extra: string[] = []) =>
    write("private/public-denylist.txt", [WORD_ALNUM, WORD_DIGITS, WORD_JA, `readme-ok:${WORD_README}`, "", ...extra].join("\n") + "\n");

  it("一覧がなくても動く", () => {
    stage({ "a.md": `${WORD_ALNUM}\n` });
    expect(runHook(COMMIT).status).toBe(0);
  });

  it("一覧の語を止める。stderr に語がない", () => {
    denylist();
    stage({ "a.md": `x\n${WORD_JA}さんの畑\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:2:denylist");
    expect(r.stderr).not.toContain(WORD_JA);
    expectOnlyLocations(r.stderr);
  });

  it("readme-ok の語は README.md でだけ通す", () => {
    denylist();
    stage({ "README.md": `${WORD_README}\n` });
    expect(runHook(COMMIT).status).toBe(0);

    stage({ "docs/other.md": `${WORD_README}\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("docs/other.md:1:denylist");
    expect(r.stderr).not.toContain("README.md");
  });

  it("README.md でも、通常の語は止める", () => {
    denylist();
    stage({ "README.md": `${WORD_JA}\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("README.md:1:denylist");
  });

  it("英数字だけの語は、前後が英数字でないときだけ一致する", () => {
    denylist();
    stage({ "a.md": `${WORD_ALNUM}land\nx${WORD_ALNUM}\n${WORD_ALNUM}9\n` });
    expect(runHook(COMMIT).status).toBe(0);

    stage({ "b.md": `見て ${WORD_ALNUM}.\n(${WORD_ALNUM})\n${WORD_ALNUM}\n${WORD_ALNUM}-x\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    for (const n of [1, 2, 3, 4]) expect(r.stderr).toContain(`b.md:${n}:denylist`);
    expect(r.stderr).not.toContain("a.md");
  });

  it("作った数字の語は、公開の URL の長い数字を止めず、前後が区切りの電話番号の形を止める", () => {
    denylist();
    stage({ "a.md": `https://example.org/page/10${WORD_DIGITS}99\nhttps://example.org/page/${WORD_DIGITS}1\n` });
    expect(runHook(COMMIT).status).toBe(0);

    stage({ "b.md": `お問い合わせ ${WORD_DIGITS} まで\n（${WORD_DIGITS}）\n電話:${WORD_DIGITS}。\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    for (const n of [1, 2, 3]) expect(r.stderr).toContain(`b.md:${n}:denylist`);
  });

  it("日本語の語は部分一致のまま", () => {
    denylist();
    stage({ "a.md": `この${WORD_JA}です\n${WORD_JA}\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:1:denylist");
    expect(r.stderr).toContain("a.md:2:denylist");
  });

  it("全角の英数字や大文字でも一致を逃さない", () => {
    denylist();
    stage({ "a.md": `${WORD_ALNUM.toUpperCase()}\nｚｚｆａｒｍｘｑ\n` });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:1:denylist");
    expect(r.stderr).toContain("a.md:2:denylist");
  });
});

describe("stage の中身が決まらない commit", () => {
  const BAD = [
    "git add -A && git commit -m x",
    "git add --all && git commit -m x",
    "git add . && git commit -m x",
    "git add -u; git commit -m x",
    "git commit -a -m x",
    'git commit -am "x"',
    "git commit --all -m x",
    "git -C . commit -a -m x",
    "git commit -m x --all",
    'bash -c "git add -A && git commit -m x"',
  ];
  for (const cmd of BAD) {
    it(`止める: ${cmd}`, () => {
      stage({ "a.txt": "ok\n" });
      const r = runHook(cmd);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^\(command\):0:git_(add_all|commit_all)$/m);
      expectOnlyLocations(r.stderr);
    });
  }

  const GOOD = [
    'git commit -m "use the -a flag"',
    "git commit -m 'a && git add -A'",
    'git commit -m "$(cat <<\'EOF\'\nfeat: x -a "quoted" --all\n\nCo-Authored-By: A <noreply@anthropic.com>\nEOF\n)"',
    "git add a.txt && git commit -m x",
    "git commit --amend --no-edit",
    "git commit -m x 2>&1",
  ];
  for (const cmd of GOOD) {
    it(`通す: ${cmd.split("\n")[0]}`, () => {
      stage({ "a.txt": "ok\n" });
      const r = runHook(cmd);
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  }

  it("add と commit が同じコマンドのとき、add の経路も検査する", () => {
    write("private/n.md", "ok\n");
    const r = runHook("git add -f private/n.md && git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("private/n.md:0:private_path");
  });

  it("heredoc の本文に鍵があっても stage の検査は変わらず、本文の語で誤検知しない", () => {
    stage({ "a.txt": `${ANTHROPIC_KEY}\n` });
    const r = runHook('git commit -m "$(cat <<\'EOF\'\nmsg -a\nEOF\n)"');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.txt:1:anthropic_key");
  });

  it("パス指定の commit は作業ツリーの内容を見る", () => {
    stage({ "a.txt": "ok\n" });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    stage({ "a.txt": "ok\nstaged\n" });
    write("a.txt", `ok\nstaged\n${ANTHROPIC_KEY}\n`);
    const r = runHook("git commit -m x -- a.txt");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.txt:3:anthropic_key");
    // パスを指定しない commit が見るのは stage の中身だけ
    expect(runHook(COMMIT).status).toBe(0);
  });

  it("-C で別のリポジトリを指す commit は、そこで git を動かさずに止める", () => {
    const other = initRepo();
    stage({ "ok.txt": "ok\n" }, other);
    const r = runHook(`git -C ${other} commit -m x`);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^\(command\):0:repo_outside_project$/m);
  });

  it("cd で別のリポジトリへ移ってからの commit も止める（&& と ; の範囲）", () => {
    const other = initRepo();
    stage({ "ok.txt": "ok\n" }, other);
    for (const sep of ["&&", ";"]) {
      const r = runHook(`cd ${other} ${sep} git commit -m x`);
      expect(r.status, sep).toBe(2);
      expect(r.stderr).toMatch(/^\(command\):0:repo_outside_project$/m);
    }
    // 同じリポジトリの中の移動は、そのリポジトリを見る
    stage({ "k.txt": `${ANTHROPIC_KEY}\n` });
    fs.mkdirSync(path.join(repo, "sub"));
    const rel = runHook("cd .. && git commit -m x", path.join(repo, "sub"));
    expect(rel.status).toBe(2);
    expect(rel.stderr).toContain("k.txt:1:anthropic_key");
  });

  it("別のリポジトリの設定のコマンド（fsmonitor）を、検査の中で動かさない", () => {
    const marker = path.join(tmp, "fsmonitor-ran");
    write("mon.sh", `#!/bin/sh\ntouch ${marker}\n`, tmp);
    fs.chmodSync(path.join(tmp, "mon.sh"), 0o755);
    // 試験の準備の git add が fsmonitor を動かさないよう、設定は stage の後に入れる
    stage({ "ok.txt": "ok\n" });
    git(["config", "core.fsmonitor", path.join(tmp, "mon.sh")]);
    runHook(COMMIT);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe("読めない指定は止める（fail-closed）", () => {
  const BAD: Array<[string, string]> = [
    ["git add --pathspec-from-file=list.txt && git commit -m x", "pathspec_from_file"],
    ["git commit --pathspec-from-file list.txt -m x", "pathspec_from_file"],
    ["git --git-dir=.git commit -m x", "git_global_option"],
    ["git --work-tree . commit -m x", "git_global_option"],
    ["GIT_INDEX_FILE=/tmp/i git commit -m x", "git_env"],
    ["env GIT_DIR=.git git commit -m x", "git_env"],
    ["export GIT_INDEX_FILE=/tmp/i; git commit -m x", "git_env"],
    ["git -c alias.ci=commit ci -m x", "git_config_override"],
    ["git -c core.worktree=/tmp commit -m x", "git_config_override"],
    ["git add --pathspec-fr=list.txt && git commit -m x", "pathspec_from_file"],
    ["git commit --pathspec-from list.txt -m x", "pathspec_from_file"],
    ["git add --al && git commit -m x", "git_add_all"],
    ["git add --upd && git commit -m x", "git_add_all"],
    ["git add --al && git commit -m x", "git_add_all"],
    ["git add --u && git commit -m x", "git_add_all"],
    ["git add --no-ignore-removal x && git commit -m x", "git_add_all"],
    ["git --config-env=alias.ci=V ci -m x", "git_config_override"],
    ["export GIT_CONFIG_COUNT=1; git ci -m x", "git_env"],
  ];
  for (const [cmd, name] of BAD) {
    it(`止める: ${cmd}`, () => {
      stage({ "a.txt": "ok\n" });
      write("list.txt", "a.txt\n");
      const r = runHook(cmd);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(new RegExp(`^\\(command\\):0:${name}$`, "m"));
    });
  }

  it("if や while の中の commit も検査する", () => {
    stage({ "k.txt": `${ANTHROPIC_KEY}\n` });
    for (const cmd of ["if git commit -m x; then echo ok; fi", "true && { git commit -m x; }", "! git commit -m x"]) {
      const r = runHook(cmd);
      expect(r.status, cmd).toBe(2);
      expect(r.stderr).toContain("k.txt:1:anthropic_key");
    }
  });

  it("git stage は git add と同じに扱う", () => {
    stage({ "seed.txt": "seed\n" });
    write("a.txt", `${ANTHROPIC_KEY}\n`);
    const r = runHook("git stage a.txt && git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.txt:1:anthropic_key");
    expect(runHook("git stage -A && git commit -m x").stderr).toMatch(/git_add_all/);
  });

  it("commit や add の別名（alias）も検査する。シェルの別名は止める", () => {
    stage({ "k.txt": `${ANTHROPIC_KEY}\n` });
    git(["config", "alias.ci", "commit -v"]);
    const r = runHook("git ci -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("k.txt:1:anthropic_key");
    git(["config", "alias.save", "!git add -A && git commit"]);
    expect(runHook("git save -m x && git commit -m y").stderr).toMatch(/git_alias_shell/);
  });

  it("別名を指す別名もたどる。指定で始まる別名と、たどり切れない別名は止める", () => {
    stage({ "k.txt": `${ANTHROPIC_KEY}\n` });
    git(["config", "alias.c1", "c2 -v"]);
    git(["config", "alias.c2", "commit"]);
    const r = runHook("git c1 -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("k.txt:1:anthropic_key");
    git(["config", "alias.wt", "--work-tree=/tmp commit"]);
    expect(runHook("git wt -m x").stderr).toMatch(/git_alias_(option|unresolved)/);
    git(["config", "alias.loop1", "loop2 commit"]);
    git(["config", "alias.loop2", "loop1"]);
    expect(runHook("git loop1 -m x").stderr).toMatch(/git_alias_unresolved/);
  });
});

describe("同じコマンドの git add（一時の索引で stage を再現する）", () => {
  const indexFile = () => path.join(repo, ".git", "index");
  const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const tmpLeft = () => fs.readdirSync(path.join(tmp, "tmpdir"));

  for (const sep of ["&&", ";"]) {
    it(`git add <ファイル> ${sep} git commit: 鍵入りのファイルを止める。きれいなファイルは通す`, () => {
      stage({ "seed.txt": "seed\n" });
      write("a.txt", `ok\n${ANTHROPIC_KEY}\n`);
      write("clean.txt", "ok\n");
      const bad = runHook(`git add a.txt ${sep} git commit -m x`);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("a.txt:2:anthropic_key");
      expect(bad.stderr).not.toContain(ANTHROPIC_KEY);
      expectOnlyLocations(bad.stderr);

      const good = runHook(`git add clean.txt ${sep} git commit -m x`);
      expect(good.stderr).toBe("");
      expect(good.status).toBe(0);
    });
  }

  it("複数のパス、新しいファイル、追跡中のファイルの変更、ディレクトリを調べる", () => {
    stage({ "t.md": "line\n" });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    write("t.md", `line\n${EMAIL}\n`);
    write("dir/n.md", `${PHONE}\n`);
    write("ok.md", "ok\n");
    const r = runHook("git add ok.md t.md dir && git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("t.md:2:email");
    expect(r.stderr).toContain("dir/n.md:1:phone");
    expect(r.stderr).not.toContain("ok.md");
  });

  it("add のあとの commit が見る stage は、元の stage と add の合計", () => {
    stage({ "s.txt": `${GOOGLE_KEY}\n` });
    write("ok.md", "ok\n");
    const r = runHook("git add ok.md && git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("s.txt:1:google_api_key");
  });

  it("同じリポジトリの中の cd と git -C の先で add したファイルを調べる", () => {
    stage({ "seed.txt": "seed\n" });
    write("d/a.txt", `${ANTHROPIC_KEY}\n`);
    const viaCd = runHook(`cd d && git add a.txt && git commit -m x`);
    expect(viaCd.status).toBe(2);
    expect(viaCd.stderr).toContain("d/a.txt:1:anthropic_key");
    const viaC = runHook(`git -C d add a.txt && git -C d commit -m x`);
    expect(viaC.status).toBe(2);
    expect(viaC.stderr).toContain("d/a.txt:1:anthropic_key");
  });

  it("リポジトリの索引を変えず、一時ファイルを残さない", () => {
    stage({ "seed.txt": "seed\n" });
    write("a.txt", `${ANTHROPIC_KEY}\n`);
    write("b.txt", "ok\n");
    const before = sha(indexFile());
    const stagedBefore = git(["diff", "--cached", "--name-only"]);
    for (const cmd of ["git add a.txt && git commit -m x", "git add b.txt && git commit -m x"]) runHook(cmd);
    expect(sha(indexFile())).toBe(before);
    expect(git(["diff", "--cached", "--name-only"])).toBe(stagedBefore);
    expect(git(["status", "--porcelain"])).toContain("?? a.txt");
    expect(tmpLeft()).toEqual([]);
  });

  it("add が失敗するなら止める（fail-closed）", () => {
    stage({ "seed.txt": "seed\n" });
    const r = runHook("git add missing.txt && git commit -m x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(command):0:git_add_failed");
    expect(tmpLeft()).toEqual([]);
  });

  it("経路の名前: ディレクトリ名（末尾のスラッシュなし）も止める", () => {
    write("private/n.md", "ok\n");
    for (const arg of ["private", "private/", "./private", "-f private"]) {
      const r = runHook(`git add ${arg} && git commit -m x`);
      expect(r.status, arg).toBe(2);
      expect(r.stderr, arg).toMatch(/^private:0:private_path$/m);
    }
    write("docs/private-notes.md", "ok\n");
    expect(runHook("git add docs/private-notes.md && git commit -m x").status).toBe(0);
  });
});

describe("誤検知と警告", () => {
  it("ssh の URL は email にしない。人のアドレスは止める", () => {
    stage({
      "a.md": ["git" + "@github.com:org/repo.git", "ssh://" + "git" + "@host.corp.co.jp/org/repo"].join("\n") + "\n",
    });
    expect(runHook(COMMIT).stderr).toBe("");

    stage({ "b.md": ["git" + "@" + "corp-mail.co.jp に連絡", "taro" + "@github.com:x"].join("\n") + "\n" });
    const r = runHook(COMMIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("b.md:1:email");
    expect(r.stderr).toContain("b.md:2:email");
  });

  it("一覧が読めないときは stderr に警告を 1 行出す（一覧が無いときは出さない）", () => {
    stage({ "a.md": "ok\n" });
    expect(runHook(COMMIT).stderr).toBe("");
    // ディレクトリにして読めなくする
    fs.mkdirSync(path.join(repo, "private", "public-denylist.txt"), { recursive: true });
    const r = runHook(COMMIT);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toEqual(["private/public-denylist.txt:0:denylist_unreadable"]);

    stage({ "b.md": `${EMAIL}\n` });
    const bad = runHook(COMMIT);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("b.md:1:email");
    expect(bad.stderr).toContain("private/public-denylist.txt:0:denylist_unreadable");
    expectOnlyLocations(bad.stderr);
  });
});

describe("--all-tracked", () => {
  function runAll(dir = repo) {
    const r = spawnSync("bash", [HOOK, "--all-tracked"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    return { status: r.status, stderr: r.stderr };
  }

  it("stage していない変更も見る", () => {
    stage({ "a.md": "clean\n", "b.md": "clean\n" });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    expect(runAll().status).toBe(0);

    write("a.md", `clean\n${EMAIL}\n`);
    const r = runAll();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:2:email");
    expect(r.stderr).not.toContain(EMAIL);
    expectOnlyLocations(r.stderr);
  });

  it("既に commit された内容と経路も見る", () => {
    stage({ "docs/a.md": `${PHONE}\n`, "HANDOFF.md": "x\n", "data/q.json": `{"quote":"x"}\n` });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    const r = runAll();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("docs/a.md:1:phone");
    expect(r.stderr).toContain("HANDOFF.md:0:private_path");
    expect(r.stderr).toContain("data/q.json:1:data_quote");
  });

  it("追跡していないファイルは見ない", () => {
    stage({ "a.md": "clean\n" });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    write("untracked.md", `${EMAIL}\n`);
    expect(runAll().status).toBe(0);
  });

  it("一覧の語も見る", () => {
    write("private/public-denylist.txt", "zzword" + "qq\n");
    stage({ "a.md": "zzword" + "qq\n" });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    const r = runAll();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a.md:1:denylist");
  });

  it("hook と試験のファイルを入れても exit 0（自分自身で落ちない）", () => {
    stage({
      ".claude/hooks/public-precommit.sh": fs.readFileSync(HOOK),
      "scripts/test/public-precommit.test.ts": fs.readFileSync(THIS_TEST),
      ...(fs.existsSync(TOOLS_TEST) ? { "scripts/test/claude-tools.test.ts": fs.readFileSync(TOOLS_TEST) } : {}),
    });
    git(["commit", "-q", "-m", "seed", "--no-verify"]);
    const r = runAll();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("hook 本体", () => {
  it("実行できる", () => {
    expect(fs.statSync(HOOK).mode & 0o111).not.toBe(0);
  });
});

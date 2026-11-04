#!/usr/bin/env bash
# 公開前の検査（PreToolUse / Bash）。git commit の前に、これから commit する内容に
# 非公開の内容や個人情報が混ざっていないかを調べる。
#
#   stdin に hook の JSON を受け、git commit 以外は何もせず通す（exit 0）。
#   --all-tracked: stdin を読まず、追跡している全ファイルの作業ツリーの内容を調べる。
#   不合格は exit 2。stderr には「ファイル:行:パターン名」だけを出す。一致した値は出さない。
#
# 検査:
#   経路        private/（どの階層でも）、HANDOFF.md、CLAUDE.local.md、.env*（.env.example を除く）
#   内容        anthropic_key、google_api_key、private_key、email、phone、data_quote（data/ の下）
#   語の一覧    private/public-denylist.txt の各行（denylist）。一覧がなくても動く。
#               英数字だけの語は前後が英数字でないときだけ一致（URL の長い数字を誤検知しない）。
#               日本語など他の語は部分一致。大文字小文字と全角半角は区別しない。
#               readme-ok:語 の行は README.md（リポジトリ直下）でだけ通す。
#   stage が決まらない commit  git add -A / --all / . / -u を同じコマンドで続ける、git commit -a / --all。
#
# このファイルの検査パターンは、自分自身に一致しないように書く（連結や文字クラスを使う）。
set -u

mode=hook
[ "${1:-}" = "--all-tracked" ] && mode=all

input=""
if [ "$mode" = hook ]; then
  input="$(cat)"
  # 毎回の Bash 呼び出しで node を起動しないための早見。commit の文字がなければ関係ない
  case "$input" in
    *commit*) ;;
    *) exit 0 ;;
  esac
fi

if ! command -v node >/dev/null 2>&1; then
  echo "(hook):0:node_not_found" >&2
  exit 2
fi

read -r -d '' JS <<'__HOOK_JS__'
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ALL_TRACKED = process.argv.includes("--all-tracked");

// ---- 結果 ----
const violations = [];
const warnings = [];
const seen = new Set();
function add(file, line, name) {
  const key = `${file}:${line}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  violations.push(key);
}

// ---- パターン（自分自身に一致しないよう、鍵の接頭辞は連結で作る） ----
const RE_ANTHROPIC = new RegExp("sk-" + "ant-" + "[A-Za-z0-9_-]+");
const RE_GOOGLE = /AIza[0-9A-Za-z_-]{35}/;
const RE_PRIVATE_KEY = /BEGIN [A-Z ]*PRIVATE KEY/;
const RE_EMAIL = /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 英数字に続く番号（DOI の s42003-… や id の …-2026-11-12000）は電話としない
const RE_PHONE = /(?<![0-9A-Za-z])0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}(?![0-9])/g;
const RE_QUOTE = /"quote"\s*:/;

// 例示用に予約されたドメイン（RFC 2606）。実在の人のアドレスではない
const EXAMPLE_DOMAINS = new Set(["example.com", "example.jp", "example.org", "example.net"]);
const RESERVED_TLDS = new Set(["test", "invalid", "example", "localhost"]);

function emailHit(line) {
  if (!line.includes("@")) return false;
  for (const m of line.matchAll(RE_EMAIL)) {
    const s = m[0].toLowerCase();
    const domain = s.slice(s.indexOf("@") + 1);
    if (s === "noreply" + "@anthropic.com") continue;
    // git@host:org/repo.git や ssh://git@host/... は人のアドレスではない
    const next = line[m.index + m[0].length];
    if (m[0].slice(0, m[0].indexOf("@")) === "git" && (next === ":" || next === "/")) continue;
    if (EXAMPLE_DOMAINS.has(domain) || RESERVED_TLDS.has(domain.slice(domain.lastIndexOf(".") + 1))) continue;
    return true;
  }
  return false;
}

function phoneHit(line) {
  if (!line.includes("-")) return false;
  for (const m of line.matchAll(RE_PHONE)) {
    if (m[0] === "00-0000-0000") continue;
    return true;
  }
  return false;
}

// ---- 語の一覧 ----
const fold = (s) => s.normalize("NFKC").toLowerCase();
function loadDenylist(top) {
  const file = path.join(top, "private", "public-denylist.txt");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    // 無いのは普通（一覧なしでも動く）。あるのに読めないときは検査が弱くなるので知らせる
    if (!e || (e.code !== "ENOENT" && e.code !== "ENOTDIR")) {
      const w = "private/public-denylist.txt:0:denylist_unreadable";
      if (!warnings.includes(w)) warnings.push(w);
    }
    return [];
  }
  const rules = [];
  for (const raw of text.split("\n")) {
    let word = raw.replace(/\r$/, "").trim();
    if (!word) continue;
    let readmeOk = false;
    if (word.startsWith("readme-ok:")) {
      readmeOk = true;
      word = word.slice("readme-ok:".length).trim();
      if (!word) continue;
    }
    const w = fold(word);
    const alnum = /^[a-z0-9]+$/.test(w);
    rules.push({ readmeOk, test: alnum ? new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`) : { test: (l) => l.includes(w) } });
  }
  return rules;
}

function scanLine(file, n, text, ctx) {
  if (RE_ANTHROPIC.test(text)) add(file, n, "anthropic_key");
  if (RE_GOOGLE.test(text)) add(file, n, "google_api_key");
  if (RE_PRIVATE_KEY.test(text)) add(file, n, "private_key");
  if (emailHit(text)) add(file, n, "email");
  if (phoneHit(text)) add(file, n, "phone");
  if (file.startsWith("data/") && RE_QUOTE.test(text)) add(file, n, "data_quote");
  if (ctx.deny.length) {
    const f = fold(text);
    for (const r of ctx.deny) {
      if (r.readmeOk && file === "README.md") continue;
      if (r.test.test(f)) {
        add(file, n, "denylist");
        break;
      }
    }
  }
}

// ---- 経路 ----
function pathCheck(file) {
  const parts = file.split("/");
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).includes("private") || base === "HANDOFF.md" || base === "CLAUDE.local.md") add(file, 0, "private_path");
  if (base.startsWith(".env") && base !== ".env.example") add(file, 0, "env_file");
}

// ---- git ----
// 承認の前に動くので、リポジトリの設定が指すコマンド（fsmonitor、フック）を動かさない
function git(dir, args, env) {
  return execFileSync("git", ["-c", "core.quotepath=false", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    env: env || process.env,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function topOf(dir) {
  try {
    return git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}
function hasHead(dir) {
  try {
    git(dir, ["rev-parse", "--verify", "-q", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

const DIFF_OPTS = ["-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-filter=ACMR"];

// -U0 の差分の追加行を、新しい側の行番号で調べる
function scanDiffText(text, ctx) {
  let file = null;
  let skip = false;
  let newLn = 0;
  let remAdd = 0;
  let remDel = 0;
  for (const l of text.split("\n")) {
    if (remAdd > 0 || remDel > 0) {
      if (l.startsWith("+")) {
        if (remAdd > 0) {
          remAdd--;
          if (file && !skip) scanLine(file, newLn, l.slice(1), ctx);
          newLn++;
        }
        continue;
      }
      if (l.startsWith("-")) {
        if (remDel > 0) remDel--;
        continue;
      }
      if (l.startsWith("\\")) continue;
      remAdd = 0;
      remDel = 0;
    }
    if (l.startsWith("diff --git ")) {
      file = null;
      skip = false;
      continue;
    }
    if (l.startsWith("+++ ")) {
      let p = l.slice(4).replace(/\t$/, "");
      if (p === "/dev/null") {
        file = null;
      } else {
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        file = p.replace(/^b\//, "");
        skip = path.posix.basename(file) === "package-lock.json";
      }
      continue;
    }
    const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m) {
      remDel = m[1] === undefined ? 1 : Number(m[1]);
      newLn = Number(m[2]);
      remAdd = m[3] === undefined ? 1 : Number(m[3]);
    }
  }
}

// stage の中身。pathspecs があれば、その作業ツリーの内容（git commit <パス> が commit するもの）
function scanStaged(dir, pathspecs, ctx, env) {
  const head = hasHead(dir);
  const base = pathspecs.length && head ? ["diff", "HEAD"] : ["diff", "--cached"];
  const tail = pathspecs.length ? ["--", ...pathspecs] : [];
  for (const f of git(dir, [...base, "--name-only", "-z", "--no-renames", "--diff-filter=ACMR", ...tail], env).split("\0")) {
    if (f) pathCheck(f);
  }
  scanDiffText(git(dir, [...base, ...DIFF_OPTS, ...tail], env), ctx);
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function scanAllTracked(top, ctx) {
  const files = git(top, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    pathCheck(f);
    if (path.posix.basename(f) === "package-lock.json") continue;
    const abs = path.join(top, f);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) continue;
    buf
      .toString("utf8")
      .split("\n")
      .forEach((line, i) => scanLine(f, i + 1, line.replace(/\r$/, ""), ctx));
  }
}

// ---- コマンドの読み取り ----
function stripHeredocs(cmd) {
  const out = [];
  let pending = [];
  for (const line of cmd.split("\n")) {
    if (pending.length) {
      if (line.trim() === pending[0]) pending.shift();
      continue;
    }
    out.push(line);
    const re = /<<-?[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > 0 && line[m.index - 1] === "<") continue;
      pending.push(m[1] ?? m[2] ?? m[3]);
    }
  }
  return out.join("\n");
}

// $( ... ) の閉じ括弧の次の位置。s[i] は "("
function skipParen(s, i) {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return i + 1;
    i++;
  }
  return s.length;
}

// 単純なコマンドの語の配列に分ける。クォートの中は 1 語。リダイレクトの先は捨てる
function splitCommands(cmd) {
  const s = stripHeredocs(cmd);
  const cmds = [];
  let toks = [];
  let cur = null;
  let i = 0;
  const pushTok = () => {
    if (cur !== null) toks.push(cur);
    cur = null;
  };
  const endCmd = () => {
    if (cur === "$") cur = null;
    pushTok();
    if (toks.length) cmds.push(toks);
    toks = [];
  };
  const isSep = (c) => /\s/.test(c) || ";|&()<>`".includes(c);
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? s.length : j;
      cur = (cur ?? "") + s.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      cur = cur ?? "";
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          cur += s[i + 1];
          i += 2;
        } else if (s[i] === "$" && s[i + 1] === "(") {
          const e = skipParen(s, i + 1);
          cur += s.slice(i, e);
          i = e;
        } else {
          cur += s[i++];
        }
      }
      i++;
      continue;
    }
    if (c === "\\") {
      if (s[i + 1] === "\n") {
        i += 2;
        continue;
      }
      cur = (cur ?? "") + (s[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === "#" && cur === null) {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "<" || c === ">") {
      if (cur !== null && /^\d+$/.test(cur)) cur = null;
      while (s[i] === "<" || s[i] === ">") i++;
      if (s[i] === "&") i++;
      while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
      while (i < s.length && !isSep(s[i])) {
        if (s[i] === "'" || s[i] === '"') {
          const j = s.indexOf(s[i], i + 1);
          i = j < 0 ? s.length : j + 1;
        } else {
          i++;
        }
      }
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      pushTok();
      i++;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")" || c === "`") {
      endCmd();
      i++;
      continue;
    }
    cur = (cur ?? "") + c;
    i++;
  }
  endCmd();
  return cmds;
}

const VALUE_LONG = new Set([
  "--message", "--file", "--reuse-message", "--reedit-message", "--author", "--date",
  "--cleanup", "--fixup", "--squash", "--template", "--trailer", "--pathspec-from-file",
]);
const WRAPPERS = new Set(["env", "sudo", "command", "time", "nohup", "exec", "nice"]);
// if git commit …; then … や { git commit …; } の先頭の語は飛ばして、その後のコマンドを見る
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "}"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "eval"]);
// 意味の分かる大域の指定。ほかの指定（--git-dir、--work-tree など）は、どの索引と作業ツリーを
// commit するかを変えうるので、読み違えないよう止める
const SAFE_GLOBAL = new Set(["--no-pager", "-P", "-p", "--paginate", "--no-optional-locks", "--literal-pathspecs", "--no-replace-objects"]);

// --al や --upd のような長い指定の省略形。min は省略を認める最短の長さ
function isAbbrevOf(a, full, min) {
  const name = a.split("=")[0];
  return name.length >= min && full.startsWith(name);
}

function insideProject(dir, project) {
  if (!project) return false;
  const rel = path.relative(project, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// git の別名（alias）。プロジェクトの中のリポジトリでだけ引く
function aliasOf(dir, sub, project) {
  if (!sub || sub.startsWith("-") || !insideProject(dir, project)) return null;
  try {
    return git(dir, ["config", "--get", `alias.${sub}`]).trim() || null;
  } catch {
    return null;
  }
}

// git commit の引数: -a か、パス指定か
function parseCommit(args) {
  let all = false;
  const paths = [];
  let endOpts = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (endOpts) {
      paths.push(a);
    } else if (a === "--") {
      endOpts = true;
    } else if (a.startsWith("--")) {
      if (a === "--all") all = true;
      else if (VALUE_LONG.has(a)) k++;
    } else if (a.startsWith("-") && a.length > 1) {
      for (let c = 1; c < a.length; c++) {
        const ch = a[c];
        if (ch === "a") all = true;
        else if ("mFCct".includes(ch)) {
          if (c === a.length - 1) k++;
          break;
        } else if (ch === "S" || ch === "u") break;
      }
    } else {
      paths.push(a);
    }
  }
  return { all, paths };
}

// state.cwd は cd を追って動く（&& や ; でつながった範囲）
function analyze(cmd, state, found, depth) {
  for (const toks of splitCommands(cmd)) {
    let i = 0;
    let gitEnv = false;
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || WRAPPERS.has(toks[i]) || KEYWORDS.has(toks[i]))) {
      if (/^GIT_[A-Z0-9_]*=/.test(toks[i])) gitEnv = true;
      i++;
    }
    if (i >= toks.length) continue;
    const prog = path.basename(toks[i]);
    if (prog === "cd" || prog === "pushd") {
      const a = toks.slice(i + 1).filter((t) => t !== "--")[0];
      if (a === undefined) state.cwd = os.homedir();
      else if (a !== "-" && !/[$`]/.test(a)) state.cwd = a.startsWith("~") ? path.join(os.homedir(), a.slice(1)) : path.resolve(state.cwd, a);
      continue;
    }
    if (SHELLS.has(prog) && depth < 3) {
      for (const a of toks.slice(i + 1)) if (/\bgit\b/.test(a) && /\b(commit|add|stage)\b/.test(a)) analyze(a, { cwd: state.cwd, project: state.project }, found, depth + 1);
      continue;
    }
    if (prog !== "git") continue;
    let j = i + 1;
    let dir = state.cwd;
    const odd = [];
    if (gitEnv) odd.push("git_env");
    while (j < toks.length && toks[j].startsWith("-")) {
      const t = toks[j];
      if (t === "-C" && toks[j + 1] !== undefined) {
        dir = path.resolve(dir, toks[j + 1]);
        j += 2;
      } else if (t.startsWith("--config-env")) {
        // --config-env も -c と同じく設定を書き換えられる
        odd.push("git_config_override");
        found.flags.add("git_config_override");
        j += t.includes("=") ? 1 : 2;
      } else if (t === "-c" && toks[j + 1] !== undefined) {
        // -c は別名や読み込む設定を書き換えられるので、commit と add では止める
        odd.push("git_config_override");
        // その場で作った別名（-c alias.ci=commit）は、後ろの名前が何でも止める
        if (/^(alias|include|includeif)\./i.test(toks[j + 1])) found.flags.add("git_config_override");
        j += 2;
      } else if (SAFE_GLOBAL.has(t)) {
        j++;
      } else {
        odd.push("git_global_option");
        j += t === "--git-dir" || t === "--work-tree" || t === "--namespace" ? 2 : 1;
      }
    }
    let sub = toks[j];
    let args = toks.slice(j + 1);
    // 別名は別名を指せるので、数段までたどる。読み切れない形は、commit か add を含めば止める
    let aliasText = "";
    let shellAlias = false;
    for (let d = 0; d < 5 && sub !== "commit" && sub !== "add" && sub !== "stage"; d++) {
      const al = aliasOf(dir, sub, state.project);
      if (!al) break;
      aliasText += ` ${al}`;
      if (al.startsWith("!")) {
        shellAlias = true;
        break;
      }
      const at = splitCommands(al)[0] || [];
      if (at.length && at[0].startsWith("-")) odd.push("git_alias_option");
      sub = at[0];
      args = [...at.slice(1), ...args];
    }
    const touches = /\b(commit|add|stage)\b/.test(aliasText);
    if (shellAlias) {
      if (touches) found.flags.add("git_alias_shell");
      continue;
    }
    if (sub !== "commit" && sub !== "add" && sub !== "stage") {
      if (touches) found.flags.add("git_alias_unresolved");
      continue;
    }
    for (const f of odd) found.flags.add(f);
    // パスの一覧をファイルから読む指定は、中身を読み切れないので止める
    // git は長い指定の省略形（--pathspec-fr など）も受け付けるので、--pathspec で始まる指定は
    // --pathspec-file-nul のほかは止める
    if (args.some((a) => a.startsWith("--pathspec") && a !== "--pathspec-file-nul")) found.flags.add("pathspec_from_file");
    if (sub === "commit") {
      const c = parseCommit(args);
      found.commits.push({ dir, ...c });
    } else {
      const paths = [];
      let all = false;
      let force = false;
      let endOpts = false;
      for (const a of args) {
        if (!endOpts && a === "--") endOpts = true;
        else if (!endOpts && (isAbbrevOf(a, "--all", 3) || isAbbrevOf(a, "--update", 3) || isAbbrevOf(a, "--no-ignore-removal", 6))) all = true;
        else if (!endOpts && a === "--force") force = true;
        else if (!endOpts && a.startsWith("--")) continue;
        else if (!endOpts && a.startsWith("-") && a.length > 1) {
          if (/[Au]/.test(a)) all = true;
          if (/f/.test(a)) force = true;
        } else if (a === "." || a === "*" || a === ":/") all = true;
        else paths.push(a);
      }
      found.adds.push({ dir, all, force, paths });
    }
  }
}

// git add の引数のパス。ディレクトリ名（末尾のスラッシュなし）でも private を見つける
function pathspecCheck(p) {
  const norm = p.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!norm) return;
  const parts = norm.split("/");
  const base = parts[parts.length - 1];
  if (parts.includes("private") || base === "HANDOFF.md" || base === "CLAUDE.local.md") add(norm, 0, "private_path");
  if (base.startsWith(".env") && base !== ".env.example") add(norm, 0, "env_file");
}

// 現在の索引を一時ファイルへ写し、そこへ git add して stage を再現する。リポジトリの索引は変えない
function withTempIndex(top, adds, fn) {
  if (!adds.length) return fn(null);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "precommit-idx-"));
  try {
    const real = path.resolve(top, git(top, ["rev-parse", "--git-path", "index"]).trim());
    const tmpIdx = path.join(tmpDir, "index");
    if (fs.existsSync(real)) fs.copyFileSync(real, tmpIdx);
    const env = { ...process.env, GIT_INDEX_FILE: tmpIdx };
    for (const a of adds) {
      try {
        git(a.dir, ["add", ...(a.force ? ["-f"] : []), "--", ...a.paths], env);
      } catch {
        if (!violations.length) add("(command)", 0, "git_add_failed");
      }
    }
    return fn(env);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- 実行 ----
let armed = false; // commit と分かった後の内部エラーだけを不合格にする
function main() {
  if (ALL_TRACKED) {
    const top = topOf(process.cwd());
    if (!top) {
      add("(repo)", 0, "not_a_git_repo");
      return;
    }
    scanAllTracked(top, { deny: loadDenylist(top) });
    return;
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!input || (input.tool_name && input.tool_name !== "Bash")) return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== "string") return;

  const base = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  // 検査で git を動かすのは、このプロジェクトのリポジトリの中だけ（承認の前に、
  // コマンドが指す別のリポジトリの設定を読まない）
  const project = (process.env.CLAUDE_PROJECT_DIR && topOf(process.env.CLAUDE_PROJECT_DIR)) || topOf(base);
  const found = { commits: [], adds: [], flags: new Set() };
  analyze(command, { cwd: base, project }, found, 0);
  // export GIT_DIR=… のように、git の前の代入以外でも索引、作業ツリー、設定は変えられる。
  // commit と読めなかった形（別名など）でも、git を呼ぶなら止める
  if (/\bGIT_(DIR|INDEX_FILE|WORK_TREE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|CONFIG\w*)\b/.test(command) && /\bgit\b/.test(command)) found.flags.add("git_env");
  if (!found.commits.length && !found.flags.size) return;
  armed = true;
  for (const f of found.flags) add("(command)", 0, f);

  const inProject = (dir) => insideProject(dir, project) && topOf(dir) === project;
  // 同じコマンドの中の git add は、この時点ではまだ stage に入っていない。
  // -A などは中身が決まらないので止め、明示のパスは一時の索引で stage を再現して調べる
  for (const a of found.adds) {
    if (a.all) add("(command)", 0, "git_add_all");
    for (const p of a.paths) pathspecCheck(p);
    if (!inProject(a.dir)) add("(command)", 0, "repo_outside_project");
  }

  const tops = new Map();
  for (const c of found.commits) {
    if (c.all) add("(command)", 0, "git_commit_all");
    if (!inProject(c.dir)) {
      add("(command)", 0, "repo_outside_project");
      continue;
    }
    const top = project;
    if (!tops.has(top)) tops.set(top, { deny: loadDenylist(top), specs: new Set(), plain: false });
    const t = tops.get(top);
    if (c.paths.length) c.paths.forEach((p) => t.specs.add(p));
    else t.plain = true;
  }
  for (const [top, t] of tops) {
    const ctx = { deny: t.deny };
    const adds = found.adds.filter((a) => !a.all && a.paths.length && inProject(a.dir));
    withTempIndex(top, adds, (env) => {
      if (t.plain) scanStaged(top, [], ctx, env);
      if (t.specs.size) scanStaged(top, [...t.specs], ctx, env);
    });
  }
}

try {
  main();
} catch (e) {
  if (ALL_TRACKED || armed) add("(hook)", 0, "internal_error");
}
if (violations.length || warnings.length) process.stderr.write([...violations, ...warnings].join("\n") + "\n");
if (violations.length) process.exit(2);
__HOOK_JS__

printf '%s' "$input" | node -e "$JS" -- "$@"
exit $?

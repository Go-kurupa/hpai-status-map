#!/usr/bin/env bash
# 手元の管理用の Secret 3 つを作り、Firebase の Secret に入れる（計画 F-02、人の作業 6）。
#   OPS_TOKEN / INTERNAL_MCP_TOKEN / UNSUBSCRIBE_SECRET
# 値は画面にも引数にも出さない。控えは ~/.config/hpai/ に mode 600 で置く（ops.ts が ops-token を読む）。
# 控えが在れば作り直さず、その値を入れ直す。UNSUBSCRIBE_SECRET を作るのはここだけ。
# ANTHROPIC_API_KEY と GMAIL_APP_PASSWORD はここでは入れない（利用者が直接入れる。仮の値も入れない）。
#
#   FIREBASE_ACCOUNT=<メール> FIREBASE_PROJECT=<プロジェクト> bash scripts/set-ops-token.sh
set -euo pipefail
umask 077

: "${FIREBASE_ACCOUNT:?FIREBASE_ACCOUNT を設定してください}"
: "${FIREBASE_PROJECT:?FIREBASE_PROJECT を設定してください}"
command -v openssl >/dev/null || { echo "openssl が必要です" >&2; exit 1; }

config_dir="${HOME}/.config/hpai"
mkdir -p "$config_dir"
chmod 700 "$config_dir"

# Secret の名前 → 控えのファイル名
secrets=(
  "OPS_TOKEN:ops-token"
  "INTERNAL_MCP_TOKEN:internal-mcp-token"
  "UNSUBSCRIBE_SECRET:unsubscribe-secret"
)

for entry in "${secrets[@]}"; do
  name="${entry%%:*}"
  file="${config_dir}/${entry#*:}"

  if [ ! -s "$file" ]; then
    # 改行なしで控える。入れる値と控えが 1 バイトも違わないようにする。
    # 途中で失敗しても空の控えを残さないよう、一時ファイルを経由する。
    tmp="$(mktemp "${config_dir}/.new.XXXXXX")"
    if ! openssl rand -base64 32 | tr -d '\n' > "$tmp" || [ ! -s "$tmp" ]; then
      rm -f "$tmp"
      echo "${name}: 値を作れませんでした" >&2
      exit 1
    fi
    mv "$tmp" "$file"
    echo "${name}: 控えを作りました"
  else
    echo "${name}: 控えがあるので作り直しません"
  fi
  chmod 600 "$file"

  # 値は標準入力で渡す（引数に載せない）。--non-interactive は再 deploy の質問を出さないため。
  npx firebase functions:secrets:set "$name" --data-file=- \
    --account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT" --non-interactive < "$file" > /dev/null
  echo "${name}: 入れました"
done

echo
echo "ANTHROPIC_API_KEY と GMAIL_APP_PASSWORD はここでは入れていません。自分で functions:secrets:set してください。"

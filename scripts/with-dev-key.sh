#!/usr/bin/env bash
# 開発用の Anthropic の鍵を ~/.config/hpai/anthropic-dev-key から読み、続くコマンドの環境に渡す。
# 鍵は画面にも引数にも出さない。読み取りの試しや試験など、有料の実行の前に付ける。
#
#   bash scripts/with-dev-key.sh npx tsx scripts/smoke-read.ts --yes
set -euo pipefail
key_file="${HOME}/.config/hpai/anthropic-dev-key"
if [ $# -eq 0 ]; then
  echo "使い方: bash scripts/with-dev-key.sh <コマンド> [引数...]" >&2
  exit 2
fi
if [ ! -s "$key_file" ]; then
  echo "~/.config/hpai/anthropic-dev-key がありません。準備の手順で、開発用の鍵を保存してください" >&2
  exit 2
fi
ANTHROPIC_API_KEY="$(tr -d '\r\n' < "$key_file")"
export ANTHROPIC_API_KEY
exec "$@"

#!/bin/bash
# 使い方: remap-hashes.sh <書き換え後のリポジトリ> [commit-map のパス]
# 追跡中の README.md と docs/ 内の `7桁hash`（バッククォート囲み・英字を含む）を、
# commit-map の対応で新しい7桁に置き換える。
set -euo pipefail
cd "${1:?repo path}"
MAP="${2:-.git/filter-repo/commit-map}"
files=$(git ls-files README.md docs | grep -E '\.md$' || true)
n=0
for f in $files; do
  for h in $(grep -oE '`[0-9a-f]{7}`' "$f" | tr -d '`' | grep '[a-f]' | sort -u); do
    git cat-file -e "$h^{commit}" 2>/dev/null && continue   # 既に実在するなら触らない
    matches=$(awk -v p="$h" 'NR>1 && index($1,p)==1 {print $2}' "$MAP" | sort -u)
    cnt=$(echo -n "$matches" | grep -c . || true)
    if [ "$cnt" -ne 1 ] || [ "$matches" = "0000000000000000000000000000000000000000" ]; then
      echo "要確認 $f: $h -> 対応 $cnt 件 ($matches)" >&2; continue
    fi
    new=$(git rev-parse --short=7 "$matches")
    sed -i "s/\`$h\`/\`$new\`/g" "$f"
    echo "$f: $h -> $new"; n=$((n+1))
  done
done
echo "置換 $n 件"

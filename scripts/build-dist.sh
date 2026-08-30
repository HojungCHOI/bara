#!/usr/bin/env sh
# FTP/SFTP로 올릴 파일만 dist/ 에 모은다.
#
#   sh scripts/build-dist.sh
#
# 만들어진 dist/ 안의 내용을 통째로 서버의
# /app/biblehelper/ 에 올리면 된다. (dist 폴더 자체가 아니라 그 "안"의 파일들)

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

# 실제 서비스에 필요한 것만 복사한다.
cp "$ROOT/index.html"            "$DIST/"
cp "$ROOT/manifest.webmanifest"  "$DIST/"
cp "$ROOT/icon.svg"              "$DIST/"
cp -R "$ROOT/css"                "$DIST/"
cp -R "$ROOT/js"                 "$DIST/"
cp -R "$ROOT/data"               "$DIST/"

# 문서는 앱 안에서 링크로 걸려 있으므로 함께 올린다.
mkdir -p "$DIST/docs"
cp "$ROOT/docs/DATA.md" "$DIST/docs/"

# 개인 데이터가 섞여 들어가지 않았는지 확인한다.
rm -f "$DIST/data/hymns.json" "$DIST/data/bible.json"

echo "dist/ 준비 완료:"
find "$DIST" -type f | sed "s|$DIST|  dist|" | sort
echo ""
echo "총 $(find "$DIST" -type f | wc -l | tr -d ' ')개 파일, $(du -sh "$DIST" | cut -f1)"
echo ""
echo "이제 dist/ '안의' 파일들을 서버의 /app/biblehelper/ 에 올리세요."

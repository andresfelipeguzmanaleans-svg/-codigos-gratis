#!/usr/bin/env bash
# Scrape Fischipedia balloon aerial images via MediaWiki API
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RAW_DIR="$SCRIPT_DIR/data/images/balloon"
PUBLIC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/public/images/locations/balloon"

mkdir -p "$RAW_DIR" "$PUBLIC_DIR"

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

IMAGES=(
  "Balloon_Moosewood.png"
  "Balloon_Roslit_Bay.png"
  "Balloon_Roslit_Volcano.png"
  "Balloon_Snowcap_Island.png"
  "Balloon_Sunstone.png"
  "Balloon_Mushgrove.png"
  "Balloon_Terrapin.png"
  "Balloon_Ancient_Isle.png"
  "Balloon_Forsaken_Shores.png"
  "Balloon_Grand_Reef.png"
  "Balloon_Lost_Jungle.png"
  "Balloon_Earmark_Island.png"
  "Balloon_Harvesters_Spike.png"
  "Balloon_The_Arch.png"
  "Balloon_Statue_of_Sovereignty.png"
  "Balloon_Birch_Cay.png"
  "Balloon_Castaway_Cliffs.png"
  "Balloon_Laboratory.png"
  "Balloon_Small_Island.png"
)

OK=0
FAIL=0

filesize() {
  wc -c < "$1" 2>/dev/null | tr -d ' '
}

for IMG in "${IMAGES[@]}"; do
  SLUG=$(echo "$IMG" | sed 's/\.png$//' | tr '_' '-' | tr '[:upper:]' '[:lower:]')
  OUT_RAW="$RAW_DIR/$IMG"
  OUT_PUB="$PUBLIC_DIR/$SLUG.png"

  if [[ -f "$OUT_PUB" ]]; then
    SZ=$(filesize "$OUT_PUB")
    if [[ "$SZ" -gt 10000 ]]; then
      echo "[SKIP] $IMG (already exists, ${SZ}b)"
      OK=$((OK+1))
      continue
    fi
  fi

  echo "--- $IMG ---"
  DOWNLOADED=false

  # 1) Try /wiki/Special:FilePath (most reliable for fischipedia.org)
  FP_URL="https://fischipedia.org/wiki/Special:FilePath/${IMG}"
  echo "  Trying $FP_URL"
  curl -sL -o "$OUT_RAW" --max-time 120 \
    -H "User-Agent: $UA" -H "Accept: image/png,image/*" \
    -H "Referer: https://fischipedia.org/" \
    "$FP_URL" 2>/dev/null || true
  SZ=$(filesize "$OUT_RAW")
  FTYPE=$(file -b "$OUT_RAW" 2>/dev/null | head -c 20)
  if [[ -f "$OUT_RAW" ]] && [[ "$SZ" -gt 100000 ]] && [[ "$FTYPE" == *"PNG"* || "$FTYPE" == *"image"* ]]; then
    DOWNLOADED=true
    echo "  OK (${SZ}b)"
  else
    echo "  Failed (${SZ:-0}b, $FTYPE)"
    rm -f "$OUT_RAW"
  fi

  # 2) Fallback: MediaWiki API
  if [[ "$DOWNLOADED" == "false" ]]; then
    API_URL="https://fischipedia.org/api.php?action=query&titles=File:${IMG}&prop=imageinfo&iiprop=url&format=json"
    DL_URL=$(curl -sL --max-time 10 -H "User-Agent: $UA" "$API_URL" 2>/dev/null \
      | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for p in d.get('query',{}).get('pages',{}).values():
    ii=p.get('imageinfo',[])
    if ii: print(ii[0]['url']); break
except: pass
" 2>/dev/null || true)
    if [[ -n "$DL_URL" ]]; then
      echo "  API -> $DL_URL"
      curl -sL -o "$OUT_RAW" --max-time 120 \
        -H "User-Agent: $UA" -H "Accept: image/png,image/*" \
        -H "Referer: https://fischipedia.org/" \
        "$DL_URL" 2>/dev/null || true
      SZ=$(filesize "$OUT_RAW")
      FTYPE=$(file -b "$OUT_RAW" 2>/dev/null | head -c 20)
      if [[ -f "$OUT_RAW" ]] && [[ "$SZ" -gt 100000 ]] && [[ "$FTYPE" == *"PNG"* || "$FTYPE" == *"image"* ]]; then
        DOWNLOADED=true
        echo "  OK via API (${SZ}b)"
      else
        echo "  API failed (${SZ:-0}b)"
        rm -f "$OUT_RAW"
      fi
    fi
  fi

  if [[ "$DOWNLOADED" == "true" ]]; then
    RAW_SZ=$(filesize "$OUT_RAW")
    echo "  Resizing ${RAW_SZ}b -> 1280x720..."
    ffmpeg -y -i "$OUT_RAW" \
      -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black@0" \
      -frames:v 1 "$OUT_PUB" -loglevel error 2>/dev/null || true
    if [[ -f "$OUT_PUB" ]]; then
      PUB_SZ=$(filesize "$OUT_PUB")
      echo "  DONE: ${RAW_SZ}b -> ${PUB_SZ}b"
      OK=$((OK+1))
    else
      echo "  RESIZE FAILED"
      FAIL=$((FAIL+1))
    fi
  else
    echo "  FAILED: $IMG"
    FAIL=$((FAIL+1))
  fi

  sleep 1
done

echo ""
echo "=== Results: $OK ok, $FAIL failed out of ${#IMAGES[@]} ==="

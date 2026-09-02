#!/usr/bin/env bash
# PNG -> reel (9:16 MP4). Pomalý Ken Burns zoom na FOTCE, text zůstává stát.
#
# Použití:
#   scripts/png-to-reel.sh <vstup.png> <vystup.mp4> [délka_s] [panel_top_px]
#   scripts/png-to-reel.sh --overlay <fg.png> <bg.png> <vystup.mp4> [délka_s]
#
#   panel_top_px  y-souřadnice, kde začíná textový panel. Zoomuje se jen část
#                 nad ní. Když se neuvede, skript ji z obrázku odhadne sám.
#                 `0` = zoomovat celý snímek (text pak leze z rámu — jen pro
#                 vizuály bez textu u kraje).
#
# Proč se text nezoomuje: zoom-in ořezává od okrajů, takže titulek i patička
# vylezou z rámu. Fotka se hýbe, panel drží — přesně jak to vypadá v reelech.
#
# Proč se nefaduje ze černé: první snímek reelu je zároveň výchozí náhled
# v Instagram gridu — fade-in z černé tam udělá černou dlaždici. Video proto
# začíná rovnou obrazem, faduje se jen konec.
#
# Proč tichá audio stopa: Instagram Reels přes Buffer odmítá část uploadů bez
# audio streamu.
#
# Proč se zoomuje z 2× nadvzorkovaného zdroje: zoompan počítá v celých pixelech
# a na 1:1 vstupu pohyb viditelně trhá.
#
# ffmpeg v cloud kontejneru není — stáhne se jako npm balíček ffmpeg-static
# (bez sudo, bez apt).
# --overlay: dvouvrstvý režim pro reel layout "band" (render-reel.mjs --layers).
# Zoomuje se jen fotka (bg), sazba (fg, s alfou) leží nehybně navrchu. Bez toho
# by zoom odtáhl titulek z bezpečné zóny, kvůli které se rozvržení posouvalo.
OVERLAY=""
if [ "${1:-}" = "--overlay" ]; then
  OVERLAY="${2:?--overlay potřebuje cestu k fg.png}"
  shift 2
  [ -f "$OVERLAY" ] || { echo "[REEL] CHYBA — overlay neexistuje: $OVERLAY"; exit 1; }
fi

set -euo pipefail

IN="${1:?usage: png-to-reel.sh <in.png> <out.mp4> [seconds] [panel_top_px]}"
OUT="${2:?usage: png-to-reel.sh <in.png> <out.mp4> [seconds] [panel_top_px]}"
DUR="${3:-6}"
PANEL_TOP="${4:-auto}"
FPS=30
ZOOM_END=1.12   # o kolik se fotka za celou dobu přiblíží

[ -f "$IN" ] || { echo "[REEL] CHYBA — vstupní soubor neexistuje: $IN"; exit 1; }

# --- ffmpeg ---------------------------------------------------------------
FFMPEG="$(command -v ffmpeg || true)"
if [ -z "$FFMPEG" ]; then
  FF_DIR="${FFMPEG_STATIC_DIR:-${TMPDIR:-/tmp}/ffmpeg-static}"
  if [ ! -x "$FF_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
    echo "[REEL] ffmpeg není v PATH — instaluji ffmpeg-static do $FF_DIR"
    mkdir -p "$FF_DIR"
    ( cd "$FF_DIR" && npm i ffmpeg-static --silent --no-fund --no-audit >/dev/null )
  fi
  FFMPEG="$FF_DIR/node_modules/ffmpeg-static/ffmpeg"
fi
[ -x "$FFMPEG" ] || { echo "[REEL] CHYBA — ffmpeg se nepodařilo získat."; exit 1; }

# --- rozměry vstupu -------------------------------------------------------
read -r W H < <("$FFMPEG" -i "$IN" 2>&1 \
  | sed -n 's/.*, \([0-9]\+\)x\([0-9]\+\).*/\1 \2/p' | head -1)
[ -n "${W:-}" ] || { echo "[REEL] CHYBA — nelze zjistit rozměry $IN"; exit 1; }

# --- kde začíná textový panel --------------------------------------------
# Vytáhne 8px sloupec u levého okraje jako raw RGB a odspodu hledá poslední
# řádek, který má pořád barvu spodní hrany (= jednolitý panel).
if [ -n "$OVERLAY" ]; then
  PANEL_TOP=0        # v překryvném režimu se zoomuje celá fotka, text je jinde
elif [ "$PANEL_TOP" = "auto" ]; then
  PANEL_TOP=$("$FFMPEG" -loglevel error -i "$IN" \
      -vf "crop=8:ih:0:0,format=rgb24" -f rawvideo - \
    | node -e '
      const W = 8, H = Number(process.argv[1]);
      const buf = require("node:fs").readFileSync(0);
      const px = (x, y) => { const i = (y * W + x) * 3; return [buf[i], buf[i+1], buf[i+2]]; };
      const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
      const ref = px(4, H - 3);            // barva panelu u spodní hrany
      let top = H;
      for (let y = H - 3; y >= 0; y--) {
        let uniform = true;
        for (let x = 0; x < W; x++) if (!near(px(x, y), ref, 10)) { uniform = false; break; }
        if (!uniform) break;
        top = y;
      }
      // Panel musí být rozumně velký, jinak jde nejspíš o vizuál bez panelu.
      process.stdout.write(String(H - top > H * 0.12 ? top : 0));
    ' "$H")
  echo "[REEL] panel detekován na y=$PANEL_TOP (0 = žádný, zoomuje se celý snímek)"
fi

# --- odvozené hodnoty -----------------------------------------------------
FRAMES=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN{printf "%d", d*f}')
STEP=$(awk -v z="$ZOOM_END" -v n="$FRAMES" 'BEGIN{printf "%.6f", (z-1)/n}')
FADE_OUT_AT=$(awk -v d="$DUR" 'BEGIN{printf "%.2f", d-0.5}')

# ořezy musí mít sudou výšku (yuv420p)
PT=$(awk -v p="$PANEL_TOP" 'BEGIN{printf "%d", int(p/2)*2}')
PANEL_H=$((H - PT))

# Zoom je ukotvený do LEVÉHO DOLNÍHO rohu fotky, ne do středu: přesně tam sedí
# štítek kategorie a při zoomu od středu by vylezl z rámu. Ořezává se tedy
# shora a zprava, kde bývá obloha/pozadí.
ZP="zoompan=z='min(zoom+$STEP,$ZOOM_END)':x='0':y='ih-ih/zoom':d=$FRAMES:fps=$FPS"

if [ "$PT" -gt 0 ]; then
  FILTER="[0:v]split=2[a][b];\
[a]crop=$W:$PT:0:0,scale=$((W*2)):-2:flags=lanczos,$ZP:s=${W}x${PT}[top];\
[b]crop=$W:$PANEL_H:0:$PT,fps=$FPS[bot];\
[top][bot]vstack=inputs=2,\
fade=t=out:st=$FADE_OUT_AT:d=0.5,format=yuv420p[v]"
else
  FILTER="[0:v]scale=$((W*2)):-2:flags=lanczos,$ZP:s=${W}x${H},\
fade=t=out:st=$FADE_OUT_AT:d=0.5,format=yuv420p[v]"
fi

# --- render ---------------------------------------------------------------
OVERLAY_IN=()
if [ -n "$OVERLAY" ]; then
  OVERLAY_IN=(-loop 1 -i "$OVERLAY")
  # fade patří až na složený obraz, jinak by se sazba objevila dřív než fotka
  FILTER="${FILTER%,fade=t=out*}"
  FILTER="[0:v]scale=$((W*2)):-2:flags=lanczos,$ZP:s=${W}x${H}[bgz];\
[bgz][2:v]overlay=0:0:format=auto,\
fade=t=out:st=$FADE_OUT_AT:d=0.5,format=yuv420p[v]"
fi

"$FFMPEG" -y -loglevel error \
  -loop 1 -i "$IN" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  "${OVERLAY_IN[@]}" \
  -t "$DUR" \
  -filter_complex "$FILTER" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 \
  -c:a aac -b:a 128k -ar 44100 \
  -movflags +faststart -shortest \
  "$OUT"

echo "[REEL] hotovo: $OUT  ${W}x${H}  ${DUR}s  $(du -h "$OUT" | cut -f1)"

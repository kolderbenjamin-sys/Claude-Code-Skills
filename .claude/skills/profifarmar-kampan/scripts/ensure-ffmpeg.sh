#!/usr/bin/env bash
# ensure-ffmpeg.sh — zajistí ffmpeg v cloud kontejneru a vypíše cestu k binárce na stdout.
#
# Priorita je "vždy doběhnout", ne "rychle selhat": zkouší několik nezávislých
# zdrojů za sebou a při totálním výpadku sítě celý řetězec opakuje (výchozí
# limit 30 minut), protože jeden neuskutečněný post je horší než dlouhý běh.
#
#   1. ffmpeg už v PATH (nebo z dřívějšího běhu v cache)
#   2. npm balíček ffmpeg-static (CDN npm + GitHub releases)
#   3. statický build z johnvansickle.com (jiný server, jiná cesta)
#   4. apt-get install ffmpeg (jen pokud je root/sudo bez hesla)
#
# Použití:  FFMPEG="$(bash ensure-ffmpeg.sh)"
# Env:      FFMPEG_STATIC_DIR (cache, výchozí $TMPDIR/ffmpeg-static)
#           FFMPEG_MAX_WAIT   (sekundy, výchozí 1800)

set -u
FF_DIR="${FFMPEG_STATIC_DIR:-${TMPDIR:-/tmp}/ffmpeg-static}"
MAX_WAIT="${FFMPEG_MAX_WAIT:-1800}"
mkdir -p "$FF_DIR"

log() { echo "[FFMPEG] $*" >&2; }

ok() { [ -n "${1:-}" ] && [ -x "$1" ] && "$1" -version >/dev/null 2>&1; }

found() {
  # 1. PATH nebo cache z minula
  local p
  p="$(command -v ffmpeg 2>/dev/null || true)"; ok "$p" && { echo "$p"; return 0; }
  p="$FF_DIR/node_modules/ffmpeg-static/ffmpeg"; ok "$p" && { echo "$p"; return 0; }
  p="$FF_DIR/ffmpeg"; ok "$p" && { echo "$p"; return 0; }
  return 1
}

try_npm() {
  log "zkouším npm ffmpeg-static"
  ( cd "$FF_DIR" && npm i ffmpeg-static --silent --no-fund --no-audit \
      --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 >/dev/null 2>&1 )
}

try_johnvansickle() {
  log "zkouším johnvansickle.com static build"
  local arch tgz
  case "$(uname -m)" in
    x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) return 1 ;;
  esac
  tgz="$FF_DIR/ffmpeg-release-$arch-static.tar.xz"
  curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors --max-time 600 \
    -o "$tgz" "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-$arch-static.tar.xz" || return 1
  tar -xJf "$tgz" -C "$FF_DIR" --strip-components=1 --wildcards '*/ffmpeg' 2>/dev/null || return 1
  chmod +x "$FF_DIR/ffmpeg"
}

try_apt() {
  local sudo=""
  if [ "$(id -u)" != "0" ]; then
    sudo -n true >/dev/null 2>&1 || return 1
    sudo="sudo -n"
  fi
  log "zkouším apt-get install ffmpeg"
  $sudo apt-get update -qq >/dev/null 2>&1 || true
  $sudo apt-get install -y -qq ffmpeg >/dev/null 2>&1
}

start=$(date +%s)
round=0
while :; do
  if p="$(found)"; then
    [ "$round" -gt 0 ] && log "ffmpeg připraven po $(( $(date +%s) - start )) s"
    echo "$p"; exit 0
  fi
  round=$((round + 1))
  log "kolo $round"
  try_npm            && found && exit 0
  try_johnvansickle  && found && exit 0
  try_apt            && found && exit 0
  elapsed=$(( $(date +%s) - start ))
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    log "CHYBA — ffmpeg se nepodařilo získat ani po $elapsed s"
    exit 1
  fi
  log "žádný zdroj nedostupný, čekám 60 s a zkouším znovu (uplynulo ${elapsed}s / max ${MAX_WAIT}s)"
  sleep 60
done

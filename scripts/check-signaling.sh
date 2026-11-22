#!/usr/bin/env bash
# Check whether a y-webrtc signaling server is reachable and speaks WebSocket.
#
#   scripts/check-signaling.sh                       # the old default, wss://y-webrtc-eu.fly.dev
#   scripts/check-signaling.sh wss://signal.example.org
#   scripts/check-signaling.sh ws://localhost:4444
#
# Needs only bash and curl. Run it from the machine you want to test from (your host,
# not the dev container): it reports the first step that fails, which tells you whether
# the server is down, your network blocks it, or something in between does.
# Exit status: 0 = the server accepted a WebSocket connection, 1 = it did not.

set -u

URL="${1:-wss://y-webrtc-eu.fly.dev}"
TIMEOUT="${TIMEOUT:-10}"

case "$URL" in
  wss://*) SCHEME=https; REST="${URL#wss://}"; DEFAULT_PORT=443 ;;
  ws://*) SCHEME=http; REST="${URL#ws://}"; DEFAULT_PORT=80 ;;
  *) echo "Give a ws:// or wss:// address (got: $URL)" >&2; exit 2 ;;
esac
HOSTPORT="${REST%%/*}"
HOST="${HOSTPORT%%:*}"
PORT="$DEFAULT_PORT"
[[ "$HOSTPORT" == *:* ]] && PORT="${HOSTPORT##*:}"
HTTP_URL="$SCHEME://$HOSTPORT/"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }

ok() { printf '  OK    %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; }
info() { printf '        %s\n' "$*"; }

echo "Checking $URL (from $(hostname))"
echo

# 1. DNS ---------------------------------------------------------------------
echo "1. DNS"
ADDRESSES=""
if command -v getent >/dev/null; then
  ADDRESSES="$(getent hosts "$HOST" | awk '{print $1}' | sort -u | tr '\n' ' ')"
elif command -v dig >/dev/null; then
  ADDRESSES="$(dig +short "$HOST" | tr '\n' ' ')"
elif command -v nslookup >/dev/null; then
  ADDRESSES="$(nslookup "$HOST" 2>/dev/null | awk '/^Address: /{print $2}' | tr '\n' ' ')"
elif command -v host >/dev/null; then
  ADDRESSES="$(host "$HOST" 2>/dev/null | awk '/has address|has IPv6/{print $NF}' | tr '\n' ' ')"
fi
if [[ "$HOST" == "localhost" || "$HOST" =~ ^[0-9.]+$ ]]; then
  ok "$HOST needs no lookup"
elif [[ -n "$ADDRESSES" ]]; then
  ok "$HOST -> $ADDRESSES"
else
  bad "$HOST does not resolve. The name is gone, or this machine's DNS is failing."
  exit 1
fi
echo

# 2. TCP, TLS and a plain HTTP request ---------------------------------------
echo "2. Connection and HTTP ($HTTP_URL)"
RESULT="$(curl -sS --max-time "$TIMEOUT" -o /dev/null \
  -w 'code=%{http_code} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s remote=%{remote_ip}' \
  "$HTTP_URL" 2>&1)"
STATUS=$?
if [[ $STATUS -eq 0 ]]; then
  ok "$RESULT"
  CODE="${RESULT#code=}"; CODE="${CODE%% *}"
  [[ "$CODE" == "200" ]] || info "(y-webrtc's own server answers 200; $CODE suggests something else is listening)"
else
  case $STATUS in
    28) bad "timed out after ${TIMEOUT}s: nothing answered. A stopped app or a firewall dropping packets looks like this." ;;
    7)  bad "connection refused: the host is up but nothing is listening on port $PORT." ;;
    35|51|58|60) bad "TLS failed (curl exit $STATUS): $RESULT" ;;
    6)  bad "could not resolve the host" ;;
    *)  bad "curl exit $STATUS: $RESULT" ;;
  esac
  echo
  echo "Result: $URL is NOT usable from here."
  exit 1
fi
echo

# 3. WebSocket upgrade -------------------------------------------------------
echo "3. WebSocket handshake"
KEY="$(command -v openssl >/dev/null && openssl rand -base64 16 || echo dGhlIHNhbXBsZSBub25jZQ==)"
HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
# After a 101 the connection stays open, so curl is expected to hit its timeout (exit 28).
curl -sS --http1.1 --max-time 4 -o /dev/null -D "$HEADERS" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $KEY" \
  -H "Origin: $SCHEME://$HOST" "$HTTP_URL" >/dev/null 2>&1
FIRST_LINE="$(head -n 1 "$HEADERS" 2>/dev/null | tr -d '\r')"

if [[ "$FIRST_LINE" == HTTP/*" 101"* ]]; then
  ok "$FIRST_LINE"
  echo
  echo "Result: $URL accepted a WebSocket connection. Use it as the signaling server."
  exit 0
fi
if [[ -z "$FIRST_LINE" ]]; then
  bad "no response to the upgrade request"
else
  bad "$FIRST_LINE (expected 101 Switching Protocols)"
  info "A server that answers HTTP but not the upgrade is usually a proxy or another"
  info "app, not a y-webrtc signaling server."
fi
echo
echo "Result: $URL is NOT usable as a signaling server from here."
exit 1

#!/bin/bash

# ETT Web Frontend - Ruby HTTP Server Launcher
# Uses WEBrick (built-in to Ruby) to serve static files

PORT=${PORT:-5000}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting ETT Web Frontend Server"
echo "📁 Serving: $SCRIPT_DIR"
echo "🌐 URL: http://localhost:$PORT"
echo "✋ Press Ctrl+C to stop"
echo ""

cd "$SCRIPT_DIR" && ruby -run -ehttpd . -p "$PORT"

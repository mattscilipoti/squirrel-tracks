#!/bin/bash

# Squirrel Tracks Web Frontend - Ruby HTTP Server Launcher
# Uses WEBrick from the workspace Gemfile to serve static files

PORT=${PORT:-5000}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting Squirrel Tracks Web Frontend Server"
echo "📁 Serving: $SCRIPT_DIR"
echo "🌐 URL: http://localhost:$PORT"
echo "✋ Press Ctrl+C to stop"
echo ""

cd "$SCRIPT_DIR" &&
  BUNDLE_GEMFILE="$SCRIPT_DIR/../Gemfile" bundle exec ruby -run -ehttpd . -p "$PORT"

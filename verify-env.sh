#!/bin/bash

# ETT Development Environment Verification Script
# Run this after setup to verify all components are ready

set -e

echo "🔍 Emergent Task Tracker - Environment Verification"
echo "=================================================="
echo ""

# Check Ruby
echo "✓ Checking Ruby..."
if command -v ruby &> /dev/null; then
    RUBY_VERSION=$(ruby --version)
    echo "  $RUBY_VERSION"
else
    echo "  ✗ Ruby not found. Install via rbenv or Homebrew."
    exit 1
fi

# Check SQLite (for development database)
echo ""
echo "✓ Checking SQLite..."
if command -v sqlite3 &> /dev/null; then
    SQLITE_VERSION=$(sqlite3 --version)
    echo "  $SQLITE_VERSION"
else
    echo "  ⚠ SQLite not found. Will be installed via bundler as sqlite3 gem."
fi

# Check Bundler
echo ""
echo "✓ Checking Bundler..."
if command -v bundle &> /dev/null; then
    BUNDLE_VERSION=$(bundle --version)
    echo "  $BUNDLE_VERSION"
else
    echo "  ✗ Bundler not found. Install: gem install bundler"
    exit 1
fi

# Check Python (for web server)
echo ""
echo "✓ Checking Python..."
if command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 --version)
    echo "  $PY_VERSION"
else
    echo "  ⚠ Python not found. Optional for web server."
fi

# Check Xcode (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo "✓ Checking Xcode..."
    if command -v xcode-select &> /dev/null; then
        XCODE_PATH=$(xcode-select -p)
        echo "  Xcode found: $XCODE_PATH"
    else
        echo "  ✗ Xcode not found. Install: xcode-select --install"
    fi
fi

# Check directories
echo ""
echo "✓ Checking project structure..."
for dir in backend web-frontend ios-app; do
    if [ -d "$dir" ]; then
        echo "  ✓ $dir/"
    else
        echo "  ✗ $dir/ not found"
    fi
done

echo ""
echo "=================================================="
echo "✅ Environment check complete!"
echo ""
echo "Next steps:"
echo "  1. cd backend && bundle install"
echo "  2. cd web-frontend && python3 -m http.server 5000"
echo "  3. cd ios-app && pod install"
echo ""
echo "See README-DEV.md for full setup instructions."

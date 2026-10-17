#!/bin/bash

echo "🚀 Setting up Emergent Task Tracker dev environment..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Resolve the project root from this script's location.
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_DIR"

echo -e "${BLUE}🤖 Installing Claude Code...${NC}"
if [[ ! -x "$HOME/.local/bin/claude" ]]; then
	curl -fsSL https://claude.ai/install.sh | bash
fi
echo -e "${GREEN}✅ Claude Code ready${NC}"
echo -e "   Run: ${YELLOW}claude${NC}"
echo ""

echo -e "${BLUE}📦 Installing backend dependencies...${NC}"
cd backend
bundle install --path ../bundle

echo ""
echo -e "${BLUE}🗄️  Creating SQLite databases...${NC}"
bundle exec rails db:create 2>/dev/null || echo "ℹ️  (Rails app not yet initialized, will run after first scaffold)"

echo ""
echo -e "${GREEN}✅ Backend setup complete!${NC}"
echo -e "   Run: ${YELLOW}cd backend && bundle exec rails server${NC}"
echo ""

# Go back to root
cd "$WORKSPACE_DIR"

echo -e "${BLUE}🌐 Web frontend ready${NC}"
echo -e "   Run: ${YELLOW}cd web-frontend && python3 -m http.server 5000${NC}"
echo ""

echo -e "${BLUE}📱 iOS app setup${NC}"
echo -e "   Run: ${YELLOW}cd ios-app && pod install${NC}"
echo ""

echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ ETT Dev Environment Ready!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo "Quick commands:"
echo "  rails server        → Start Rails API (port 3000)"
echo "  web dev             → Start web frontend (port 5000)"
echo "  bundle exec rails c → Rails console"
echo "  bundle exec rspec   → Run tests"
echo ""
echo "Documentation:"
echo "  README-DEV.md              → Full setup guide"
echo "  PROMPTS-PHASE-BY-PHASE.md → Implementation roadmap"
echo ""

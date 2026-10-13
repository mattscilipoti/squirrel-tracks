# ✅ VS Code Dev Container Setup Complete!

**Status**: All files created and ready to use  
**Database**: SQLite (embedded, zero config)  
**Setup Time**: 2-3 minutes (one-click)

---

## 🎯 What You Now Have

### Dev Container Files (.devcontainer/)
- **Dockerfile** — Ruby 3.3.0, Node 20, SQLite, all dev tools
- **devcontainer.json** — VS Code auto-configuration
- **post-create-command.sh** — Automatic setup on container start
- **DEVCONTAINER.md** — Full reference guide

### VS Code Workspace (.vscode/)
- **settings.json** — Format on save, Ruby LSP, proper indentation
- **extensions.json** — Recommended extensions (auto-installed)
- **launch.json** — Debug Rails server and tests with breakpoints
- **tasks.json** — Predefined tasks for common commands

### Database Configuration
- **backend/Gemfile** — Updated: `sqlite3` gem (was PostgreSQL)
- **backend/config/database.yml.template** — SQLite configuration
- **No PostgreSQL needed** — Zero configuration required!

### Documentation
- **00-START-HERE.md** — Read first! (entry point)
- **DEVCONTAINER-QUICKSTART.md** — Setup guide + commands
- **DEVCONTAINER-SUMMARY.txt** — Visual overview
- **.devcontainer/DEVCONTAINER.md** — Comprehensive reference

---

## 🚀 Quick Start (4 Steps)

### 1. Install Prerequisites (one-time)
```bash
# Install these if you don't have them:
# • VS Code → https://code.visualstudio.com
# • Docker Desktop → https://www.docker.com/products/docker-desktop
```

### 2. Open Project in VS Code
```bash
code /home/matt/develop/clients/GreatEnough/ett
```

### 3. Reopen in Container
- VS Code will show notification: **"Folder contains a Dev Container configuration"**
- Click **"Reopen in Container"**
- OR: Press `Ctrl+Shift+P` → type `"Dev Containers: Reopen in Container"`

### 4. Wait & Enjoy ✨
- First time: 2-3 minutes (Docker builds image, installs dependencies)
- You'll see: **"✅ ETT Dev Environment Ready!"**
- Then:
```bash
# Open terminal in VS Code (Ctrl+`)
cd backend
bundle exec rails server
# → Open http://localhost:3000 in browser
```

---

## ⚡ Common Commands

### Inside Container Terminal

```bash
# Rails Backend
cd backend
bundle exec rails server              # Start API (http://localhost:3000)
bundle exec rails console             # Interactive Ruby console
bundle exec rails db:create           # Create SQLite databases
bundle exec rails db:migrate          # Run migrations
bundle exec rspec                     # Run all tests

# Web Frontend
cd web-frontend
python3 -m http.server 5000           # Start server (http://localhost:5000)

# iOS
cd ios-app
pod install                           # Install iOS dependencies
```

### Using VS Code Tasks (Ctrl+Shift+P → "Tasks: Run Task")

```
• Rails: Start Server              (port 3000)
• Rails: Database Create
• Rails: Database Migrate
• Rails: Run Tests (RSpec)
• Web: Start Dev Server            (port 5000)
• iOS: Pod Install
• ETT: Full Setup
```

---

## 🔍 Debugging with Breakpoints

### Debug Rails Server

1. Open a Rails file: `backend/app/models/session.rb`
2. Click on a line number to set a breakpoint (red dot appears)
3. Press `F5` or `Ctrl+Shift+D` to start debugger
4. Select `"Rails server"` from dropdown
5. Make an HTTP request to trigger the breakpoint
6. Step through code using debugger controls

### Debug Tests

1. Open a test file: `backend/spec/models/session_spec.rb`
2. Set a breakpoint
3. Press `F5` → select `"RSpec - current file"`
4. Debugger pauses at the breakpoint

---

## 📦 What's Included

### Languages & Runtimes
- Ruby 3.3.0
- Node.js 20
- Python 3
- Git, Curl, Vim

### Databases
- **SQLite 3** (embedded in Rails, zero config)
- PostgreSQL client (for future use)

### Development Tools
- Bundler (Ruby package manager)
- Rails 7.1 (pre-installed)
- RSpec (testing framework)
- Prettier (code formatter)
- Ruby LSP (language server + debugging)

### VS Code Extensions (Auto-Installed)
- **rubocop.ruby-lsp** — Ruby syntax, autocomplete, debugging
- **esbenp.prettier-vscode** — Code formatting
- **eamodio.gitlens** — Git integration
- **GitHub.Copilot** — Optional AI assistance (requires sign-in)

---

## 💾 Data Persistence

### SQLite Databases
- **Location**: `backend/db/`
- **Files**: `development.sqlite3`, `test.sqlite3`
- **Persists**: Yes, even after container stops
- **Reset**: `bundle exec rails db:reset`

### Gem Dependencies
- **Location**: `/workspace/ett/bundle` (Docker volume)
- **Persists**: Across container rebuilds

### SSH Keys
- **Mounted**: `/home/vscode/.ssh` (read-only from host)
- **Use for**: GitHub authentication

---

## 🌐 Accessing Services

### From Browser
- Rails API: `http://localhost:3000`
- Web Frontend: `http://localhost:5000`

VS Code automatically forwards these ports. Just use localhost URLs.

### From VS Code Ports Panel
- Open terminal: `Ctrl+`` (backtick)
- Click "PORTS" tab at bottom
- Click "Open in Browser" for auto-opened tab

---

## 🔄 Rebuilding Container

### When to Rebuild
- After editing `.devcontainer/Dockerfile`
- After major changes to `Gemfile`
- If container is corrupted

### How to Rebuild
```
Ctrl+Shift+P → "Dev Containers: Rebuild Container"
```
Takes 2-3 minutes.

---

## 🚨 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Docker daemon not running" | Start Docker Desktop, wait 30 sec |
| "Permission denied" (Linux) | `sudo usermod -aG docker $USER` then log out/in |
| "Address already in use (port 3000)" | `kill $(lsof -t -i:3000)` OR use `-p 3001` |
| "Database is locked" | `rm db/development.sqlite3 && rails db:create` |
| "Gem not found" | `rm Gemfile.lock && bundle install` |

**Full troubleshooting**: See `.devcontainer/DEVCONTAINER.md`

---

## 📚 Documentation

Read in this order:

1. **[00-START-HERE.md](00-START-HERE.md)** (overview, entry point)
2. **[DEVCONTAINER-QUICKSTART.md](DEVCONTAINER-QUICKSTART.md)** (setup guide)
3. **[.devcontainer/DEVCONTAINER.md](.devcontainer/DEVCONTAINER.md)** (full reference)
4. **[PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)** (implementation roadmap)

---

## 🆚 vs. Manual Setup (Old Way)

| Feature | Dev Container | Manual |
|---------|---|---|
| Setup Time | 2-3 min | 30-60 min |
| Identical on all systems | ✅ Yes | ❌ No |
| Works on Windows | ✅ Yes | ❌ Limited |
| Requires Docker | ✅ Yes | ❌ No |
| Pre-configured | ✅ Yes | ❌ Manual |
| **Recommended** | ⭐ YES | Only if no Docker |

---

## ✨ Key Features

✅ **One-Click Setup** — "Reopen in Container" and you're done  
✅ **Zero Configuration** — Docker handles everything  
✅ **Identical Environment** — Same on macOS, Linux, Windows  
✅ **Full Debugging** — Breakpoints in Rails and tests  
✅ **Predefined Tasks** — Common commands at your fingertips  
✅ **Auto Port Forwarding** — 3000 and 5000 just work  
✅ **Data Persistence** — SQLite databases survive container restarts  
✅ **Extensions Pre-Installed** — Ruby LSP, Prettier, GitLens ready to go

---

## 🎯 Next Steps

### Now:
1. ✅ Read [00-START-HERE.md](00-START-HERE.md) (5 min)
2. ✅ Install VS Code (if needed)
3. ✅ Install Docker Desktop (if needed)

### Then:
1. Open project: `code /home/matt/develop/clients/GreatEnough/ett`
2. Click notification: "Reopen in Container"
3. Wait 2-3 minutes
4. See: "✅ ETT Dev Environment Ready!"
5. Start developing!

### After Setup:
- Read [PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md) for implementation roadmap
- Each prompt covers one feature at a time
- Copy prompt → paste in chat → follow step-by-step

---

## 📋 Project Structure

```
/workspace/ett/
├── .devcontainer/           ← Container config
│   ├── Dockerfile
│   ├── devcontainer.json
│   ├── post-create-command.sh
│   └── DEVCONTAINER.md
├── .vscode/                 ← Workspace config
│   ├── settings.json
│   ├── extensions.json
│   ├── launch.json
│   └── tasks.json
├── backend/                 ← Rails API
│   ├── Gemfile (sqlite3)
│   ├── db/
│   └── ...
├── web-frontend/            ← HTML/CSS/JS
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── ...
├── ios-app/                 ← SwiftUI
│   ├── Podfile
│   └── ...
├── 00-START-HERE.md         ← Entry point
├── DEVCONTAINER-QUICKSTART.md
├── PROMPTS-PHASE-BY-PHASE.md
└── docker-compose.yml
```

---

## 🎉 Ready!

Your development environment is fully configured and ready to use.

👉 **Next**: Open the project in VS Code and click "Reopen in Container"

Questions? Read [00-START-HERE.md](00-START-HERE.md) or [DEVCONTAINER-QUICKSTART.md](DEVCONTAINER-QUICKSTART.md)

---

**You're all set!** 🚀

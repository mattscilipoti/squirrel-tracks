# 🐳 Emergent Task Tracker - VS Code Dev Container

**All-in-one development environment** with zero manual setup beyond opening the folder.

---

## ⚡ 30-Second Setup

1. **Prerequisites** (one-time)
   - Install [VS Code](https://code.visualstudio.com/) (v1.86+)
   - Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Start Docker Desktop

2. **Open Project**
   ```bash
   code /home/matt/develop/clients/GreatEnough/ett
   ```

3. **Reopen in Container**
   - VS Code shows notification: "Folder contains a Dev Container configuration"
   - Click "Reopen in Container"
   - Wait 2-3 minutes (first time only)

4. **Done!** 🎉
   - All dependencies installed
   - SQLite databases created
   - Ready to code

---

## 📦 What's Pre-Configured

### Environment
- ✅ Ruby 3.3.0
- ✅ Rails 7.1.1
- ✅ Node.js 20 (for web dev)
- ✅ SQLite 3 (lightweight, zero config)
- ✅ Bundler, Git, Curl, Vim

### VS Code
- ✅ Ruby LSP (syntax, autocomplete, debugging)
- ✅ Prettier (auto-formatting)
- ✅ GitLens (git integration)
- ✅ GitHub Copilot (optional AI assistance)
- ✅ Pre-configured tasks & launch configs
- ✅ Project-specific workspace settings

### Networking
- ✅ Port 3000 → Rails API (auto-forwarded)
- ✅ Port 5000 → Web Frontend (auto-forwarded)
- ✅ GitHub SSH keys mounted (read-only)

---

## 🚀 Quick Commands

### Start Backend
```bash
# Terminal → Run Task → "Rails: Start Server"
# OR
cd backend && bundle exec rails server
# → http://localhost:3000
```

### Start Web Frontend
```bash
# Terminal → Run Task → "Web: Start Dev Server"
# OR
cd web-frontend && python3 -m http.server 5000
# → http://localhost:5000
```

### Rails Console
```bash
cd backend && bundle exec rails console
# Interactive Ruby environment with app loaded
```

### Run Tests
```bash
cd backend && bundle exec rspec
# OR via Task: "Rails: Run Tests (RSpec)"
```

### Database Commands
```bash
cd backend

bundle exec rails db:create       # Create SQLite databases
bundle exec rails db:migrate      # Run pending migrations
bundle exec rails db:reset        # Drop & recreate (dev only)
bundle exec rails db:seed         # Load seed data (if any)
```

---

## 🔍 Debugging

### Debug Rails Server (with breakpoints)

1. In VS Code, open a Ruby file (e.g., `backend/app/models/session.rb`)
2. Click line number to set a breakpoint (red dot appears)
3. Press `F5` (or Ctrl+Shift+D → select "Rails server")
4. Rails starts with debugger attached
5. Make HTTP request to trigger breakpoint
6. Debugger pauses; step through code

### Debug Tests

1. Open test file (e.g., `backend/spec/models/session_spec.rb`)
2. Set breakpoint
3. Press `F5` → select "RSpec - current file"
4. Debugger pauses at breakpoint

### View Logs

Terminal → check output from running services
```bash
# Rails logs appear in terminal
# Web server logs appear in separate terminal tab
```

---

## 📁 Project Layout (Inside Container)

```
/workspace/ett/
├── backend/                      Rails 7.1 API
│   ├── app/
│   ├── config/
│   ├── db/
│   │   ├── development.sqlite3   ← Auto-created, persists data
│   │   ├── test.sqlite3
│   │   └── seeds.rb
│   ├── Gemfile
│   ├── Gemfile.lock              ← Lock file (commit this)
│   ├── config/database.yml       ← SQLite config (auto-generated)
│   └── bin/
│
├── web-frontend/                 Static HTML/CSS/JS
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── .gitignore
│
├── ios-app/                      Native iOS (SwiftUI)
│   ├── Podfile
│   ├── fastlane/
│   └── README.md
│
├── .devcontainer/                Container config
│   ├── Dockerfile
│   ├── devcontainer.json
│   ├── post-create-command.sh
│   └── DEVCONTAINER.md           ← Full details
│
├── .vscode/                       VS Code config (workspace-specific)
│   ├── settings.json             ← Format on save, tab size, etc.
│   ├── extensions.json           ← Recommended extensions
│   ├── launch.json               ← Debug configurations
│   ├── tasks.json                ← Predefined tasks
│   └── README.md
│
├── .env.template                 Config reference
├── README.md                      Project overview
├── SETUP-SUMMARY.md              Old setup (now container-based)
├── PROMPTS-PHASE-BY-PHASE.md    Implementation roadmap
├── docker-compose.yml            Alternative: compose-based setup
└── .gitignore                    Excludes container artifacts
```

---

## 🛠️ Available Tasks

Press `Ctrl+Shift+P` → type "Tasks:" to see all:

| Task | What It Does |
|------|--------------|
| `Rails: Start Server` | Start Rails API (http://localhost:3000) |
| `Rails: Database Create` | Create SQLite databases |
| `Rails: Database Migrate` | Run pending migrations |
| `Rails: Database Reset` | Drop & recreate (dev only) |
| `Rails: Run Tests (RSpec)` | Run all tests |
| `Rails: Rails Console` | Interactive Rails console |
| `Web: Start Dev Server` | Start static web server (http://localhost:5000) |
| `iOS: Pod Install` | Install iOS dependencies |
| `ETT: Full Setup` | Run complete setup (first time) |

---

## 🔧 Rebuilding Container

### When to Rebuild
- After editing `.devcontainer/Dockerfile`
- After major Gemfile changes
- If container is corrupted

### How to Rebuild
```
Ctrl+Shift+P → "Dev Containers: Rebuild Container"
```
Wait 2-3 minutes for rebuild.

---

## 💾 Data Persistence

### SQLite Databases
- Location: `backend/db/*.sqlite3`
- Persists: Even after stopping container
- Reset: `bundle exec rails db:reset`

### Gem Dependencies
- Location: `/workspace/ett/bundle` (Docker volume)
- Persists: Across container rebuilds

### SSH Keys
- Mounted at: `/home/vscode/.ssh` (read-only)
- Use for: Git authentication with GitHub

---

## 🌐 Accessing Services

**From Inside Container**:
- Rails: `http://localhost:3000`
- Web: `http://localhost:5000`

**From VS Code (Host Machine)**:
- Ports auto-forwarded
- Same URLs as above

**From Browser on Host**:
- Click "Open in Browser" in Ports tab (bottom panel)
- Or manually: `http://localhost:3000` or `http://localhost:5000`

---

## 🚨 Troubleshooting

### Container Won't Start

**"Docker daemon not running"**
- Start Docker Desktop, wait 30 sec, retry

**"Permission denied"** (Linux only)
- Run: `sudo usermod -aG docker $USER` then log out/back in

### Services Won't Start

**"Address already in use (port 3000)"**
```bash
# Inside container terminal
kill $(lsof -t -i:3000)
# OR use different port
bundle exec rails server -p 3001
```

**"Database is locked"**
```bash
cd backend
rm db/development.sqlite3
bundle exec rails db:create
```

### Dependencies Missing

**"Gem not found" after Gemfile change**
```bash
cd backend
rm Gemfile.lock
bundle install
```

**"Node modules not found"**
```bash
npm install
```

---

## 📚 Files to Read

1. **[.devcontainer/DEVCONTAINER.md](.devcontainer/DEVCONTAINER.md)** — Full dev container reference
2. **[PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)** — Implementation roadmap (copy prompts here)
3. **[.vscode/settings.json](.vscode/settings.json)** — Workspace settings
4. **[.vscode/tasks.json](.vscode/tasks.json)** — Available tasks

---

## 🆚 Dev Container vs. Old Setup

### Old (Manual)
- ❌ Install Ruby, PostgreSQL, dependencies manually
- ❌ Risk of version conflicts
- ❌ Different setup on macOS vs Linux vs Windows
- ⏱️ 30-60 min setup time

### New (Dev Container) ✨
- ✅ One click: "Reopen in Container"
- ✅ Identical environment for all developers
- ✅ Works on macOS, Linux, Windows
- ⏱️ 2-3 min first time, <1 sec thereafter

---

## 🎯 Next Steps

1. ✅ Open project in VS Code
2. ✅ Click notification: "Reopen in Container"
3. ✅ Wait for "✅ ETT Dev Environment Ready!" message
4. ✅ Open terminal (Ctrl+`)
5. ✅ Run: `cd backend && bundle exec rails server`
6. ✅ Open http://localhost:3000

**Then** follow [PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md) for implementation.

---

## 🆘 Need Help?

1. Check [.devcontainer/DEVCONTAINER.md](.devcontainer/DEVCONTAINER.md) (comprehensive reference)
2. Check troubleshooting section above
3. Check Docker logs: `docker logs ett-dev`
4. Try rebuilding: `Ctrl+Shift+P` → "Dev Containers: Rebuild Container"

---

**Ready?** Close this file and VS Code will prompt you to reopen in container! 🚀

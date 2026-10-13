# 🚀 START HERE - Emergent Task Tracker Dev Environment

## You have TWO ways to set up your dev environment:

### Option 1: VS Code Dev Container ⭐ (Recommended - One Click!)
**For**: macOS, Linux, Windows (with Docker)  
**Setup time**: 2-3 minutes first time (one-click)  
**Database**: SQLite (embedded, zero config)

👉 **Read**: [DEVCONTAINER-QUICKSTART.md](DEVCONTAINER-QUICKSTART.md)

### Option 2: Manual Setup
**For**: Linux/macOS without Docker  
**Setup time**: 30-60 minutes (manual steps)  
**Database**: SQLite (local install)

👉 **Read**: [README-DEV.md](README-DEV.md)

---

## 🎯 Quick Comparison

| Feature | Dev Container | Manual |
|---------|---|---|
| Setup time | 2-3 min | 30-60 min |
| Identical for all | ✅ Yes | ❌ No (OS dependent) |
| Works on Windows | ✅ Yes | ❌ Limited |
| Requires Docker | ✅ Yes | ❌ No |
| Pre-configured | ✅ Yes | ❌ Manual config |
| **Recommended** | ⭐ YES | Only if no Docker |

---

## ✨ The Easy Path (Dev Container)

1. **Prerequisites** (one-time):
   - Install [VS Code](https://code.visualstudio.com)
   - Install [Docker Desktop](https://www.docker.com/products/docker-desktop)

2. **Open project in VS Code**:
   ```bash
   code /home/matt/develop/clients/GreatEnough/ett
   ```

3. **Click notification**: "Reopen in Container"

4. **Wait 2-3 minutes** → See success message

5. **Start coding!**
   ```bash
   cd backend && bundle exec rails server
   # → http://localhost:3000
   ```

---

## 📚 All Documentation

| Document | Purpose | Read Time |
|----------|---------|-----------|
| **DEVCONTAINER-QUICKSTART.md** | Dev container setup & commands | 5 min |
| **.devcontainer/DEVCONTAINER.md** | Full reference (debugging, troubleshooting) | 15 min |
| **README-DEV.md** | Manual setup without Docker | 15 min |
| **PROMPTS-PHASE-BY-PHASE.md** | Implementation roadmap | 10 min |
| **.vscode/settings.json** | Workspace configuration | 5 min |

---

## 🎓 Implementation Phases (After Setup)

Once your environment is ready, follow these phases:

1. **Phase 1**: Rails API (models, endpoints)
2. **Phase 2**: Web Frontend (timer, tasks, sync)
3. **Phase 3**: iOS App (SwiftUI, Realm)
4. **Phase 4**: Advanced features (auth, analytics, Android)

**Prompts for each phase** are in [PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)

---

## ❓ Quick Decisions

**Q: Should I use Dev Container?**  
A: ✅ YES - unless you specifically can't use Docker or prefer manual setup

**Q: Why SQLite instead of PostgreSQL?**  
A: SQLite is embedded, zero-config, perfect for development. Scale to PostgreSQL if needed.

**Q: Can I switch from manual to Dev Container later?**  
A: ✅ Yes - Dev Container uses same code, just different environment

**Q: Will Dev Container slow down my machine?**  
A: No - Docker uses efficient isolation. Negligible impact for a small Rails app.

---

## 🚀 Next Steps

### If You Choose Dev Container (Recommended):
1. Read: [DEVCONTAINER-QUICKSTART.md](DEVCONTAINER-QUICKSTART.md)
2. Install: VS Code + Docker Desktop
3. Open project in VS Code
4. Click: "Reopen in Container"
5. Wait & enjoy! ✨

### If You Choose Manual Setup:
1. Read: [README-DEV.md](README-DEV.md)
2. Install: Ruby, PostgreSQL, dependencies
3. Run setup commands
4. Start coding

---

## 📞 Help

- **Dev Container issues?** → [.devcontainer/DEVCONTAINER.md](.devcontainer/DEVCONTAINER.md)
- **Manual setup issues?** → [README-DEV.md](README-DEV.md) troubleshooting section
- **Implementation help?** → [PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)

---

**Ready?** Pick your path and follow the guide!

👉 **Dev Container (Recommended)**: [DEVCONTAINER-QUICKSTART.md](DEVCONTAINER-QUICKSTART.md)  
👉 **Manual Setup**: [README-DEV.md](README-DEV.md)

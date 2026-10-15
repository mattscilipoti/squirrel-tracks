# 🚀 Emergent Task Tracker (ETT)

A digital version of [Emergent Task Timing](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/) with 15-minute interval tracking.

**Tech Stack**: Rails 7.1 API + Swift iOS + Plain HTML/CSS/JS Web  
**Status**: 🏗️ Development environment configured (ready for Phase 1)

---

## 📖 Documentation (Start Here)

| Document                                                   | Purpose                              |
| ---------------------------------------------------------- | ------------------------------------ |
| **[SETUP-SUMMARY.md](SETUP-SUMMARY.md)**                   | Quick overview of what was created   |
| **[README-DEV.md](README-DEV.md)**                         | Complete setup & rebuild guide       |
| **[PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)** | Custom AI prompts for implementation |
| **verify-env.sh**                                          | Check system prerequisites           |

---

## 🎯 Quick Start

### 1. Verify Prerequisites

```bash
cd /home/matt/develop/clients/GreatEnough/ett
./verify-env.sh
```

### 2. Rebuild Backend

```bash
cd backend
cp config/application.rb.template config/application.rb
cp config/database.yml.template config/database.yml
bundle install
rails db:create
rails server  # Runs on http://localhost:3000
```

### 3. Test Web Frontend

```bash
cd web-frontend
python3 -m http.server 5000  # Open http://localhost:5000
```

### Web Grid Actions

| Action                | Purpose                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Add                   | Add a task row to today's session. Enter in the task field also adds it.                                     |
| Clear Grid            | After confirmation, clear all filled bubbles while keeping task rows, memo, and notes.                       |
| Sync & Reload         | Push the current grid, tasks, and notes to Supabase, then reload the saved session. Requires a connection.   |
| Export CSV            | Download task totals and activity summaries for the current session. Works locally.                          |
| Resume auto-centering | Appears during the two-minute manual-scroll pause; immediately center on now and resume automatic centering. |

Hover over each action for its tooltip. Clear Grid saves the cleared grid locally;
use Sync & Reload to apply the clearing to Supabase. Sync & Reload treats the
current local grid as authoritative, rather than merging changes from other tabs.
Remove individual task rows with their remove control. Previous daily sessions
are not cleared by these actions.

Auto-fill Hour 1 was removed because repeating midnight's pattern across a full
day does not represent actual tracking. Reset All was removed as an unnecessary
bulk task-deletion action; individual row removal and Clear Grid remain available.

### Repeating Reminder

The reminder starts automatically and repeats every 15 minutes, with a quiet,
fading bell instead of a popup. It continues through daily session rollover.
Use **Volume** to set the bell level from 0 to 100%. Uncheck **Bell** to mute it
without stopping the countdown or losing the selected volume; unmuting restores
that level. Volume can also be adjusted while muted. Adjust **Every**
from 1 to 120 minutes to restart the countdown at that interval; this does not
change the grid's 15-minute bubbles. The interval, bell preference, volume, and next
reminder deadline are saved in this browser across reloads.

Browsers require a user interaction before allowing audio. If needed, select
**Enable bell audio**, after Date in the header, to unlock sound and hear a preview.
The button appears when Bell is enabled but the audio context is not running
(including an unknown, suspended, or interrupted state). It hides when audio
is running or Bell is intentionally muted. The browser audio state cannot detect
muted devices, disconnected speakers, or whether a person can actually hear it.
Device volume controls
the overall audible loudness in addition to the bell slider. Keep the app open
for reminders: closed pages, sleeping
devices, or suspended background tabs cannot reliably sound a bell. Timing
recovers when the page resumes, without replaying a backlog of missed bells.

### 4. Build iOS App

```bash
cd ios-app
pod install
open EmergenTaskTracker.xcworkspace  # Press ⌘R in Xcode
```

---

## 📁 Project Structure

```
ett/
├── backend/              Rails 7.1 API (REST endpoints)
├── web-frontend/         Plain HTML/CSS/JS (GitHub Pages ready)
├── ios-app/              Native iOS (SwiftUI + Realm)
├── README.md             This file
├── README-DEV.md         Full setup guide
├── SETUP-SUMMARY.md      Configuration overview
├── PROMPTS-PHASE-BY-PHASE.md  AI implementation prompts
├── verify-env.sh         Environment checker
└── .env.template         Configuration reference
```

---

## 💰 Cost Strategy

All tools are **FREE**:

- ✅ Rails 7.1 (open-source)
- ✅ PostgreSQL (open-source)
- ✅ SwiftUI (included in Xcode)
- ✅ Realm (open-source database)
- ✅ Vanilla JavaScript (no npm dependencies)

**Local development**: $0/month  
**Deployed (optional)**: ~$5/month on Railway or Render

---

## 🗺️ Implementation Roadmap

### Phase 1: Rails API Core ✅ Config created

- [ ] Session & Task models
- [ ] REST endpoints (POST/PATCH/GET)
- [ ] IntervalLog for analytics
- [ ] Integration tests
- **Status**: Ready for rebuild & implementation

### Phase 2: Web Frontend ✅ Code scaffolded

- [ ] 15-minute timer (start/pause/reset)
- [ ] Task input & logging
- [ ] Bubble grid visualization
- [ ] localStorage persistence
- [ ] API sync to backend
- [ ] CSV export
- **Status**: Ready for rebuild & implementation

### Phase 3: iOS App ✅ Structure created

- [ ] SwiftUI timer UI
- [ ] Realm local persistence
- [ ] API client & sync manager
- [ ] Background notifications
- [ ] PDF/CSV export
- **Status**: Ready for CocoaPods setup & implementation

### Phase 4: Advanced Features (Later)

- [ ] User authentication (JWT)
- [ ] Analytics endpoints
- [ ] Android app (Kotlin)
- [ ] Push notifications
- [ ] Widget (iOS 17+)

---

## 🚀 Next Steps

### For You (Manual):

1. Read [SETUP-SUMMARY.md](SETUP-SUMMARY.md) (5 min)
2. Follow [README-DEV.md](README-DEV.md) to rebuild all three components (30-60 min)
3. Verify each component works locally
4. Tell me when ready for Phase 1 implementation

### Then (AI-Assisted):

1. I'll guide you through [PROMPTS-PHASE-BY-PHASE.md](PROMPTS-PHASE-BY-PHASE.md)
2. Each prompt covers one feature (e.g., "Implement Timer", "Add API Sync")
3. You copy the prompt, paste into chat, and follow step-by-step
4. Test each feature before moving to next

---

## 💬 Key Files to Review

**Backend** (Rails):

- [backend/Gemfile](/backend/Gemfile) — Ruby dependencies (minimal)
- [backend/config/application.rb.template](/backend/config/application.rb.template) — Rails config + CORS

**Web** (HTML/JS):

- [web-frontend/index.html](/web-frontend/index.html) — UI structure
- [web-frontend/js/app.js](/web-frontend/js/app.js) — Timer & localStorage logic
- [web-frontend/js/api-client.js](/web-frontend/js/api-client.js) — Fetch wrapper (zero deps)
- [web-frontend/css/style.css](/web-frontend/css/style.css) — Responsive bubble grid

**iOS** (Swift):

- [ios-app/Podfile](/ios-app/Podfile) — Cocoapods (Realm)
- [ios-app/README.md](/ios-app/README.md) — iOS-specific setup

---

## ❓ FAQ

**Q: Why not use Next.js or React for the web?**  
A: Cost + simplicity. No build tools, no npm, no deployment complexity. Vanilla JS is fast enough for a timer app.

**Q: Why not cross-platform (Flutter/React Native)?**  
A: Native iOS (SwiftUI) is faster to develop and deploy for initial launch. Android can be added in Phase 4.

**Q: Can I deploy this?**  
A: Yes! Backend → Railway/Heroku, Web → GitHub Pages, iOS → App Store.

**Q: What's the total cost?**  
A: $0 for development, ~$5/month for small-scale production on Railway.

---

## 📚 Resources

- [Emergent Task Timing (Original Article)](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/)
- [Rails 7.1 Documentation](https://guides.rubyonrails.org/)
- [SwiftUI Documentation](https://developer.apple.com/swiftui/)
- [Realm Swift Documentation](https://www.mongodb.com/docs/realm/sdk/swift/)

---

## 📝 License

This project is open-source. Feel free to fork, modify, and share.

---

**Status**: Configuration complete. Ready for manual rebuild.  
**Next**: Follow [SETUP-SUMMARY.md](SETUP-SUMMARY.md) to get started.

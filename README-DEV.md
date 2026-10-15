# Emergent Task Tracker - Development Environment Setup

A Rails API + iOS + Web app for time-block task tracking.

**Project Goal**: Digital version of [Emergent Task Timing](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/) with 15-minute interval tracking.

---

## Directory Structure

```
ett/
├── backend/                 # Rails API (REST endpoints)
│   ├── Gemfile
│   ├── .ruby-version
│   ├── config/
│   │   ├── application.rb.template
│   │   └── database.yml.template
│   └── ...
├── web-frontend/            # Static HTML/CSS/JS app (GitHub Pages compatible)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── js/api-client.js
│   └── ...
├── ios-app/                 # Native iOS app (SwiftUI + Realm)
│   ├── Podfile
│   ├── fastlane/Fastfile
│   └── README.md
└── README.md               # This file
```

---

## Prerequisites

### System Requirements

- macOS 13+ (for iOS development) OR Linux/Windows (backend + web only)
- 10 GB free disk space

### Install Global Dependencies

**Ruby** (for Rails backend):

```bash
# macOS with Homebrew
brew install ruby@3.3
rbenv install 3.3.0

# Ubuntu/Debian
sudo apt-get install ruby ruby-dev bundler

# Verify
ruby --version  # Should be 3.3.0+
```

**Node.js** (optional; not required for this project, but useful for future tooling):

```bash
brew install node@20
# OR
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install nodejs
```

**Xcode** (for iOS development):

```bash
# macOS
xcode-select --install
# Then download full Xcode from App Store
```

**PostgreSQL** (for Rails backend):

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start

# Create development database (optional; will do via Rails)
createdb ett_development
```

---

## Phase 1: Rails API Backend

### Setup

```bash
cd backend

# Copy config templates
cp config/application.rb.template config/application.rb
cp config/database.yml.template config/database.yml

# Install Ruby gems
bundle install

# Initialize Rails
rails new . --api --database=postgresql --force
# (Skip if Rails files already exist)

# Create databases
rails db:create

# Run migrations (once models are added)
rails db:migrate

# Start server (runs on localhost:3000)
rails server
```

**Verify**:

- Server runs without errors
- `curl http://localhost:3000/api/health` returns OK (after implementing health endpoint)
- PostgreSQL is running: `psql -U postgres -d ett_development -c "SELECT 1;"`

---

## Phase 2: Web Frontend

### Setup

```bash
cd web-frontend

# No build step required!
# Just open index.html in a browser or run a simple server:

# Using Python
python3 -m http.server 5000

# Using Node (if installed)
npx http-server -p 5000

# Using Ruby (if installed)
ruby -run -ehttpd . -p5000
```

**Verify**:

- Open http://localhost:5000 in browser
- Timer displays "15:00"
- All buttons functional
- localStorage persists data (open DevTools → Application → Local Storage)

Sessions roll over to a blank session on a new local day, at startup, on the
minute refresh, or when returning to the tab. Active writes and syncs finish
before rollover. Previous cloud sessions remain unchanged; local snapshots are
retained in `ettGridHistory` in browser localStorage. There is no past-session
review screen yet. Local history is browser-specific and clearing site data
removes it.

Startup checks Supabase for sessions matching the local session date before
creating a new one. A populated current session is preferred; an empty or missing
local session pointer can recover today's newest populated cloud session instead
of displaying an empty duplicate. Conflicting nonempty local task data is kept
until the user confirms Refresh from DB. Failed cloud reads leave local data
intact and do not create replacement sessions.

The grid covers midnight to midnight in 96 quarter-hour slots. Current time is
automatically centered in the scrollable area beside the sticky task names.
Manual horizontal scrolling pauses centering for two minutes and displays a
countdown with a resume button. The time indicator continues updating during
the pause; centering resumes automatically at expiry. Day edges clamp to the
available scroll range.

The header summarizes filled bubbles rather than an editable work window.
First Activity is the earliest filled slot's start; Last Activity is the latest
filled slot's end (shown as `24:00` for the final slot). Session Span includes
gaps between those boundaries. Tracked Time counts distinct filled slots once,
even when several tasks share a slot; per-task totals still count each task's
bubbles. Empty activity summaries show `--`. Current Slot follows the local
clock from slot 1 at midnight to slot 96 at 23:45, independently of activity.
The existing saved `start_time` field now reflects First Activity, and CSV
metadata includes all four activity summaries. No schema migration is needed
for this header change.

### JavaScript Tests

From the repository root, run:

```bash
node --test web-frontend/js/*.test.cjs
```

Requires Node.js 18 or newer; no npm dependencies are needed. Tests supply explicit
dates and times to the calculation helpers without a browser or a mocked clock.
Coverage includes local-date formatting, clock-based slots, activity boundaries,
and current-time line positions in Eastern, UTC, and India timezones. Session
tests cover daily rollover, local archival, same-day reuse, and active-write guards.
Additional tests cover centering geometry, pause countdowns, resume behavior,
legacy grid conversion, and late-night intervals.

---

## Phase 3: iOS App

### Setup

```bash
cd ios-app

# Install CocoaPods dependencies
pod install

# Open workspace in Xcode
open EmergenTaskTracker.xcworkspace
```

**In Xcode**:

1. Select "EmergenTaskTracker" scheme
2. Select iPhone Simulator (e.g., iPhone 15)
3. Press ⌘R to build and run

**Verify**:

- App launches in simulator
- Timer displays and counts down
- Tasks can be added locally
- Realm stores data (check simulator app data folder)

---

## Integration Testing

### 1. Backend ↔ Web Frontend

**Start both**:

```bash
# Terminal 1: Backend
cd backend && rails server

# Terminal 2: Web Frontend
cd web-frontend && python3 -m http.server 5000
```

**Test**:

- Open http://localhost:5000
- Start timer, log a task
- Check Rails console for API requests
- Open DevTools Network tab to see POST/PATCH requests

### 2. Backend ↔ iOS App

**Start backend**:

```bash
cd backend && rails server
```

**In Xcode**:

- Update `APIClient` base URL to your local IP (e.g., `http://192.168.1.100:3000/api`)
- Run app in simulator
- Start timer, log task
- Check Rails console for API requests

---

## Cost-Effective Choices

| Component | Tool                                 | Why                                        | Cost                |
| --------- | ------------------------------------ | ------------------------------------------ | ------------------- |
| Backend   | Rails 7.1                            | Opinionated, fast development              | Free                |
| Database  | PostgreSQL                           | Reliable, FOSS                             | Free                |
| Web       | Vanilla JS                           | No build overhead, GitHub Pages compatible | Free                |
| iOS       | SwiftUI + Realm                      | Modern, lightweight, FOSS                  | Free                |
| VCS       | GitHub                               | Standard, CI/CD ready                      | Free (public repos) |
| Hosting   | Heroku Free Tier (legacy) or Railway | Minimal cost for hobby projects            | ~$5/mo              |

---

## Environment Variables

Create `.env` files in each directory for sensitive config:

**backend/.env**:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/ett_development
RAILS_ENV=development
```

**web-frontend/.env** (if needed later):

```
API_BASE_URL=http://localhost:3000/api
```

**ios-app/.env** (use Xcode build settings instead):

```
API_BASE_URL=http://192.168.1.100:3000/api
```

---

## Debugging

### Rails Backend

```bash
# Check database connection
rails db:version

# Run Rails console (interactive)
rails console

# Check logs
tail -f log/development.log
```

### Web Frontend

- Open DevTools (F12)
- Check Console for JS errors
- Check Network tab for API calls
- Check Application → Local Storage for state

### iOS App

- Open Xcode Console (⇧⌘C)
- Use `po` command to inspect objects
- Check Realm Studio: `/Applications/Realm Studio.app` (optional download)

---

## Next Steps

1. ✅ Review this setup guide
2. 📋 Install prerequisites (Ruby, PostgreSQL, Xcode)
3. 🚀 Run Phase 1 (Rails backend) following instructions above
4. 🌐 Run Phase 2 (Web frontend) after backend is stable
5. 📱 Run Phase 3 (iOS) in parallel with Phase 2

Once all phases pass verification, custom implementation prompts will guide feature development.

---

## Commands Reference

```bash
# Backend
cd backend && bundle install          # Install gems
cd backend && rails db:create         # Create databases
cd backend && rails server            # Start API

# Web Frontend
cd web-frontend && python3 -m http.server 5000  # Start web server

# iOS
cd ios-app && pod install            # Install dependencies
cd ios-app && open EmergenTaskTracker.xcworkspace  # Open in Xcode

# Clean up
cd backend && rails db:drop           # Drop databases
cd backend && rm -rf Gemfile.lock     # Remove lock file (for fresh install)
cd ios-app && rm -rf Pods Podfile.lock  # Remove pod dependencies
```

---

**Questions?** Check the individual README files in each directory or re-run setup instructions.

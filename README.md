# Squirrel Tracks

Where does all my time go?

> "If you’re working in a distracting environment, you’ve probably wondered what happened to the eight hours you just spent at work. The Emergent Task Timer (ETT) was designed to help answer that question. Using an interval timer, you log what you were doing every 15 minutes or so. You’ll quickly see where your time is going, and have a picture of what your day looked like. The results are often shocking!"
> -- David Seah, The Printable CEO, [on the Emergent Task Timer](http://davidseah.com/node/the-emergent-task-timer/)

This is a digital version of that [Emergent Task Timing](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/), with 15-minute interval tracking, for noticing where your day goes. Track tasks in 15-minute bubbles and use a gentle, adjustable reminder to check in throughout the day.

**Tech Stack**: Plain HTML/CSS/JS in the browser; optional [Supabase](https://supabase.com) (Postgres, Auth, Realtime) for sync across devices
**Status**: Web app live on GitHub Pages. Works local-only with no account; signing in adds cloud sync and live updates between tabs and devices. The Rails API and iOS app in this repo are early experiments and are not in use.

---

## 📖 Documentation

| Document                               | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Current architecture, database, and migration status |
| **[README-DEV.md](README-DEV.md)**     | Dev environment and deploying to GitHub Pages        |
| **[CLAUDE.md](CLAUDE.md)**             | Commands and conventions for Claude Code             |

SETUP-SUMMARY.md, PROMPTS-PHASE-BY-PHASE.md, 00-START-HERE.md, and the other setup notes in the
repo root date from the original Rails/iOS plan and no longer describe the app.

---

## 🎯 Quick Start

```bash
npm install                    # lint/format/test tooling only
web-frontend/start-server.sh   # serves the app at http://localhost:5000
npm test                       # unit tests
npm run lint && npm run format:check
```

Without sign-in the app stores everything in your browser. For cloud sync,
`web-frontend/js/config.js` holds the public Supabase URL and publishable key, and the SQL in
`supabase/migrations/` is applied manually, in order, in the Supabase SQL editor (see
[ARCHITECTURE.md](ARCHITECTURE.md)). Pushing to `main` deploys `web-frontend/` to GitHub Pages;
the footer shows the deployed commit.

## 🧭 Using the app

### Web Grid Actions

Use Date to switch sessions without relabeling the current day's data. Switching
keeps a per-day local snapshot; revisiting a day restores that snapshot first,
or loads its Supabase session when no local snapshot exists. A new day without
saved data starts blank. Failed cloud loads keep the previously selected session.
Past and future dates show an amber date field and **Not today: editing DATE**
warning. **Today** returns to the current day and removes the warning. Editing,
sync, refresh, clearing, and export apply to the selected session. The now-line
and Current Slot appear only for today. Reminder timing does not change.

Add stays visible beside the task input. Clear Grid, Sync & Reload, Refresh from
DB, and Export CSV are in the collapsed **Advanced** section in the same toolbar.
A pipe separates the data-changing controls from Export CSV. Expand Advanced
to access these actions; existing confirmations and tooltips remain in place.

| Action                | Purpose                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add                   | Add a task row to the selected day's session. Enter in the task field also adds it.                                                                |
| Clear Grid            | After confirmation, clear all filled bubbles while keeping task rows, memo, and notes.                                                             |
| Sync & Reload         | Push the current grid, tasks, and notes to Supabase, then reload the saved session. Requires a connection.                                         |
| Refresh from DB       | Read the selected day's session from Supabase and replace local tasks, bubbles, memo, and notes after confirmation. Does not upload local changes. |
| Export CSV            | Download task totals and activity summaries for the current session. Works locally.                                                                |
| Resume auto-centering | Appears during the two-minute manual-scroll pause; immediately center on now and resume automatic centering.                                       |

Hover over each action for its tooltip. Clear Grid saves the cleared grid locally;
use Sync & Reload to apply the clearing to Supabase. Sync & Reload treats the
current local grid as authoritative, rather than merging changes from other tabs.
Remove individual task rows with their remove control. Other days' sessions
are not cleared by these actions.

Create a task with Add, or choose **Reuse a task...** and **Add existing** to use
the same task ID on another day. The new day's row starts with empty bubbles.
New names are checked case-insensitively after trimming; if a name exists, reuse
it from the picker instead. The picker shows task IDs to distinguish any legacy
duplicates. Existing duplicates are not merged here; cleanup remains a separate
admin task.

Summary columns show **Day** time for the selected session and **All days** time
for the same task ID across sessions. Totals sum the tasks shown. Every filled
bubble contributes 15 minutes, with no compensation for overlaps. Other-day
totals use saved cloud counts and available per-session local snapshots, while
the selected day's total reflects live edits. CSV includes task IDs, daily
minutes, and all-days minutes. Local-only reusable tasks are browser-specific.

The **Reuse a task...** list shows every task in two groups: **Available to add**
and **Already on this day** (marked 🚫; these cannot be added again). Select any task
and press 🗑 to delete it permanently from every day. The confirmation shows when the
task was created and last updated, its total interval count, and its first and last 5
intervals (all of them when there are 10 or fewer). Unlike a row's ×, which only detaches the
task from the current day, deleting cannot be undone. Local-only tasks have no
recorded dates. When it finishes, a message names the deleted task and its interval count. Before deleting cloud-backed tasks, apply
[`20261019000000_delete_tasks_updated_at.sql`](supabase/migrations/20261019000000_delete_tasks_updated_at.sql),
which also makes a rename update the task's last-updated time.

### Live updates from other tabs and devices

When another tab or device changes the selected day (bubbles, tasks, renames,
memo, or notes), this page updates itself and shows a notice listing what changed,
for example `"Writing": +3 intervals` or `Renamed "A" to "B"`. The notice disappears
after 20 seconds or when dismissed. If this device has edits that failed to reach
Supabase, nothing is overwritten; the notice tells you to choose **Sync & Reload**
(keep this device's data) or **Refresh from DB** (take the cloud's). Apply
[`20261020000000_enable_realtime.sql`](supabase/migrations/20261020000000_enable_realtime.sql)
first. Live updates need the page to load supabase-js from jsDelivr; without it
the app works as before, just without live updates.

Click a task name in the grid to edit it. Enter or leaving the field saves;
Escape cancels. Blank names are rejected. Renaming changes the task's name across
all days, preserving its ID and every day's bubbles. Removing a row detaches it
from the selected day and removes only that day's bubbles; the reusable task and
other days' time remain. Local-only
names are saved in this browser; cloud-backed names are committed locally only
after Supabase accepts the update. A failed save leaves the old name in place.

Before renaming cloud-backed tasks, apply
[`20261015000001_allow_task_name_updates.sql`](supabase/migrations/20261015000001_allow_task_name_updates.sql)
in Supabase after the earlier migrations. It permits updating task names, not
other task columns, and does not change existing data. The existing anonymous
access model still does not provide per-user isolation.

Before using reusable tasks with Supabase, close all old app tabs and apply
[`20261016000000_reusable_tasks.sql`](supabase/migrations/20261016000000_reusable_tasks.sql)
and [`20261016000001_prevent_duplicate_task_names.sql`](supabase/migrations/20261016000001_prevent_duplicate_task_names.sql)
after the earlier migrations, then hard-refresh the app. The duplicate guard
does not merge existing duplicate names; new or renamed tasks cannot collide.
The reusable-task migration replaces
single-day task ownership with `session_tasks` links and adds RLS-aware task
totals views. Existing IDs, names, day associations, and bubbles are preserved;
no existing tasks are merged. Do not run the old frontend against the new schema
or use the expanded frontend with an unmigrated database.

**Refresh from DB** is the recovery action when local data is stale or the wrong
session is selected. It prefers the current session if it has saved tasks or
bubbles; otherwise it chooses the newest populated session for the selected date, falling
back to an empty session only if no populated one exists. Confirmation shows
the chosen session ID and task/bubble counts. Other cloud sessions are unchanged.
The previous local state is saved as `ettGridBeforeRefresh` in localStorage.
Already-synced changes cannot be undone by refreshing. The action waits for
pending writes and temporarily locks editing and auto-sync while it loads.

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
**Enable bell audio**, immediately before Advanced in the toolbar, to unlock sound and hear a preview.
The button appears when Bell is enabled but the audio context is not running
(including an unknown, suspended, or interrupted state). It hides when audio
is running or Bell is intentionally muted. The browser audio state cannot detect
muted devices, disconnected speakers, or whether a person can actually hear it.
Device volume controls
the overall audible loudness in addition to the bell slider. Keep the app open
for reminders: closed pages, sleeping
devices, or suspended background tabs cannot reliably sound a bell. Timing
recovers when the page resumes, without replaying a backlog of missed bells.

---

## 📁 Project Structure

```
squirrel_tracks/
├── web-frontend/         The app: plain HTML/CSS/JS, no build step
├── supabase/migrations/  SQL migrations (applied manually)
├── backend/              Legacy Rails API, not in use
├── ios-app/              Placeholder SwiftUI app, not in use
├── ARCHITECTURE.md       Current architecture reference
└── README-DEV.md         Dev environment and deployment
```

## 💰 Cost

Local-only mode needs no account or server. Hosting is GitHub Pages, and cloud sync uses a
Supabase project; check each provider's current free-tier limits.

## 💡 Ideas, not started

- Per-user data isolation (today every signed-in user shares the same rows)
- Analytics views over the interval history
- Native mobile apps (`ios-app/` is only a placeholder) and push notifications

---

## ❓ FAQ

**Q: Why not use Next.js or React for the web?**  
A: Simplicity. No framework and no build step; vanilla JS is fast enough for a timer app. The only runtime library is supabase-js, loaded from a CDN for live updates.

**Q: Can I use it without an account?**  
A: Yes. Choose "Continue offline" at the sign-in prompt, or run it without a `config.js`; data stays in your browser.

**Q: How is it deployed?**  
A: A GitHub Actions workflow publishes `web-frontend/` to GitHub Pages on every push to `main` (see [README-DEV.md](README-DEV.md)).

---

## 📚 Resources

- [Emergent Task Timing (Original Article)](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/)
- [Supabase Documentation](https://supabase.com/docs)

### ETT

- https://davidseah.com/2013/06/the-emergent-task-timer-revised-for-2013/
- https://clintonbegin.blogspot.ca/2012/09/emergent-task-timing.html
- example paper form, Revision 3a [ETT03-PROTO-0D6D2.pdf](http://davidseah.com/pub/downloads/pceo/ett/ETT03-PROTO-0D6D2.pdf)

### PWA

- tutorial: https://developers.google.com/web/fundamentals/codelabs/your-first-pwapp/

---

## 📝 License

This project is open-source. Feel free to fork, modify, and share.

---

**Status**: Configuration complete. Ready for manual rebuild.  
**Next**: Follow [SETUP-SUMMARY.md](SETUP-SUMMARY.md) to get started.

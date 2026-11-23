# Squirrel Tracks

Where does all my time go?

> "If you’re working in a distracting environment, you’ve probably wondered what happened to the eight hours you just spent at work. The Emergent Task Timer (ETT) was designed to help answer that question. Using an interval timer, you log what you were doing every 15 minutes or so. You’ll quickly see where your time is going, and have a picture of what your day looked like. The results are often shocking!"
> -- David Seah, The Printable CEO, [on the Emergent Task Timer](http://davidseah.com/node/the-emergent-task-timer/)

This is a digital version of that [Emergent Task Timing](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/), with 15-minute interval tracking, for noticing where your day goes. Track tasks in 15-minute bubbles and use a gentle, adjustable reminder to check in throughout the day.

**Tech Stack**: Plain HTML/CSS/JS in the browser, no build step and no server. Data is stored on your device ([Yjs](https://yjs.dev) in IndexedDB), so it works offline and belongs to you.
**Status**: Web app live on GitHub Pages. Local-first: no account and no cloud service of ours. Your devices sync end-to-end encrypted through a private GitHub repository of yours (or live, directly between devices), and you can also move data by exporting a backup and importing it elsewhere (merging, never overwriting). The Rails API and iOS app in this repo are early experiments and are not in use.

---

## 📖 Documentation

| Document                               | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Current architecture and data model           |
| **[README-DEV.md](README-DEV.md)**     | Dev environment and deploying to GitHub Pages |
| **[CLAUDE.md](CLAUDE.md)**             | Commands and conventions for Claude Code      |

SETUP-SUMMARY.md, PROMPTS-PHASE-BY-PHASE.md, 00-START-HERE.md, and the other setup notes in the
repo root date from the original Rails/iOS plan and no longer describe the app.

---

## 🎯 Quick Start

```bash
npm install                # tooling only; the app itself has no build step
npm start                  # serve the app at http://localhost:5000 (PORT=8080 npm start for another port)
npm run signaling          # run a signaling server for device pairing on port 4444
npm test                   # unit tests
npm run lint && npm run format:check
```

All scripts (`npm run` lists them):

| Command                                 | What it does                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `npm start`                             | Serve `web-frontend/` on port 5000 (`web-frontend/start-server.sh`)               |
| `npm run signaling`                     | Signaling server for pairing, port 4444 (`PORT=4455 npm run signaling` to change) |
| `npm run check:signaling -- wss://host` | Test whether a signaling address is reachable and speaks WebSocket                |
| `npm run devices -- list <owner/name>`  | List or remove the per-device files in a sync repository (see above)              |
| `npm test`                              | Unit tests                                                                        |
| `npm run lint` / `npm run format:check` | ESLint / Prettier check (`npm run format` rewrites files)                         |
| `npm run vendor`                        | Rebuild `web-frontend/vendor/yjs.js` after changing the Yjs-related dependencies  |

Everything is stored in your browser (IndexedDB), per browser and per address: `localhost:5000` and the
GitHub Pages site each have their own copy. Use **Back up** and **Import** under Advanced to move data
between them. Pushing to `main` deploys `web-frontend/` to GitHub Pages; the footer shows the deployed
commit. The app ships its own copy of Yjs in `web-frontend/vendor/`; after changing the Yjs versions in
`package.json`, run `npm run vendor` and commit the result.

### Moving from the Supabase version

Older versions synced through Supabase. To bring that data across, run
[`supabase/export-days.sql`](supabase/export-days.sql) in the Supabase SQL editor, save the result as a
`.json` file, and choose **Advanced → Import**. Data that was only saved in a browser (never synced) is
copied automatically the first time the new version opens at the same address. Importing is safe to
repeat: it merges, matching tasks by name.

## 🧭 Using the app

### Web Grid Actions

Click a bubble to toggle it. Shift-click another bubble in the same task row to
fill the entire range, including both endpoints. A shift-click in a different
row starts a new selection.

Use Date to switch days without relabeling the current day's data. A new day without
saved data starts blank. Past and future dates show an amber date field and **Not today: editing DATE**
warning. **Today** returns to the current day and removes the warning. Editing,
clearing, and export apply to the selected day. The now-line
and Current Slot appear only for today. Reminder timing does not change.

Add stays visible beside the task input. Clear Grid, Export CSV, Sync with GitHub, Live pairing, Back up, and Import are in the
collapsed **Advanced** section in the same toolbar. Expand Advanced
to access these actions; existing confirmations and tooltips remain in place.

| Action                | Purpose                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Add                   | Add a task row to the selected day. Enter in the task field also adds it.                                                             |
| Clear Grid            | After confirmation, clear all filled bubbles while keeping task rows, memo, and notes.                                                |
| Export CSV            | Download task totals and activity summaries for the selected day.                                                                     |
| Sync with GitHub      | Sync this device with your others through a private GitHub repository (encrypted). See [Syncing your devices](#syncing-your-devices). |
| Live pairing          | Advanced: direct live sync between devices that are open together; needs a signaling server of your own.                              |
| Back up               | Download all days and tasks as an `.ettbackup` file.                                                                                  |
| Import                | Merge an `.ettbackup` file, or a Supabase export `.json`, into this browser's data. Nothing is overwritten or removed.                |
| Resume auto-centering | Appears during the two-minute manual-scroll pause; immediately center on now and resume automatic centering.                          |

Hover over each action for its tooltip. Remove individual task rows with their remove control.
Other days are not cleared by these actions.

Create a task with Add, or choose **Reuse a task...** and **Add existing** to use
the same task on another day. The new day's row starts with empty bubbles.
New names are checked case-insensitively after trimming; if a name exists, reuse
it from the picker instead. If two devices each create a task with the same name while apart,
importing one into the other merges them into one task.

Summary columns show **Day** time for the selected day and **All days** time
for the same task across all days. Totals sum the tasks shown. Every filled
bubble contributes 15 minutes, with no compensation for overlaps. CSV includes task IDs, daily
minutes, and all-days minutes.

The **Reuse a task...** list shows every task in two groups: **Available to add**
and **Already on this day** (marked 🚫; these cannot be added again). Select any task
and press 🗑 to delete it permanently from every day. The confirmation shows when the
task was created, its total interval count, and its first and last 5
intervals (all of them when there are 10 or fewer). Unlike a row's ×, which only detaches the
task from the current day, deleting cannot be undone. When it finishes, a message names the
deleted task and its interval count.

### Syncing your devices

**Sync with GitHub** (Advanced → Sync with GitHub) is the main way. Your devices store encrypted copies
of your data as small files in a **private GitHub repository of yours** and merge each other's files.
They do not need to be open at the same time, there is no server to run, and GitHub only ever sees
scrambled data.

One-time setup, about three minutes:

1. On github.com, create a new **private** repository (for example `squirrel-tracks-data`) and tick
   **Add a README file**.
2. Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   Under **Repository access** choose _Only select repositories_ and pick that repository. Under
   **Permissions → Repository permissions** set **Contents** to **Read and write**. Nothing else is
   needed. Choose an expiry you are comfortable renewing.
3. In the app: Advanced → Sync with GitHub, enter `your-name/squirrel-tracks-data` and the token, and
   press **Connect**.
4. To add another device, copy the link shown in that dialog and open it on the other device, then
   enter a token there (a token per device is fine; the same one works too). The link carries the
   repository name and the encryption key, never the token.
   Always add a second device this way. Typing the repository in by hand is refused when the repository
   already holds another device's data, because the new device would invent a different key and the two
   could not read each other.

How it behaves:

- **Timing.** Changes are saved to GitHub about 10 seconds after you stop editing, and each device
  checks for others' changes when it opens, when you return to its tab, when it comes back online, and
  about once a minute. So it is not instant, but devices that are never open together still sync.
- **Merging.** Edits from different devices are combined: bubbles from both are kept, and for a rename
  or a memo the later edit wins. Edits made offline are published when the connection returns.
- **Each device owns one file** (`devices/<id>.bin`), so devices never overwrite each other. Every sync
  is a commit in the repository.
- **Encryption.** Files are AES-GCM encrypted in the browser with a key derived from the secret in the
  link. Whoever can read the repository cannot read your data without that key. File sizes and
  timestamps are visible.
- **The token** stays in that browser's localStorage. It can only touch the one repository you chose.
  If it expires or is revoked, the footer says so; make a new one and enter it in the dialog.
- **Disconnect this device** forgets the repository, key and token here and keeps your data. It
  does not touch the repository or other devices. To cut off a device, delete its token on GitHub.
- Anyone with the link _and_ access to the repository can read your data, so keep the link private.

The footer shows the state: **Synced with GitHub**, **Syncing with GitHub…**, or a plain-language problem
such as an expired token or a missing repository. Startup problems (for example a browser that blocks
local storage) show as a red banner at the top of the page.

#### Development vs production

The deployed site and your local copy never share data on their own: a browser keeps data separately for
each address (`localhost:5000` and your site's domain each have their own). The only place they could
cross is the sync settings, so keep those apart too:

- Use **two private repositories**, for example `nut-ledger` (production) and `nut-ledger-dev`, each with
  its own fine-grained token limited to that one repository. A token for the dev repository cannot read
  or write production data at all, which is why separate repositories beat separate folders in one
  repository (a token covers every folder and branch of its repository).
- Each repository has its own encryption key, so a dev device and a production device cannot read each
  other's files even by mistake.
- A page that was not stamped by the deploy workflow (anything you run locally) shows an orange **DEV**
  badge in the corner and `[DEV]` in the tab title, so test data is not mistaken for the real thing.
- To try production-like data in dev, use **Back up** on the production site and **Import** on dev. Import
  merges and does not sync back, as long as dev is connected to the dev repository.

#### Moving a browser to a different repository

Open Advanced → **Sync with GitHub**. To switch repositories:

1. Press **Disconnect this device** (optional but tidy; your data stays).
2. Enter the new repository and a token for it, and press **Connect**.

Connecting to a _different_ repository always starts a new key for it, and this browser's data is published
there. Connecting a browser to a repository that already holds another device's data is refused: open that
device's sync link instead, so both use the same key. Moving does not touch the old repository, so this
browser's old file stays there until you remove it (see below).

#### Cleaning up device files

Each browser that syncs leaves one file, `devices/<id>.bin`, in the repository. Files from browsers you
no longer use, or written under a different key, can be listed and removed from the command line:

```bash
export GITHUB_TOKEN=github_pat_...          # token with Contents read/write on the repository
export ETT_SYNC_LINK='https://…/#github=you/nut-ledger&secret=…'   # optional: the app's sync link

npm run devices -- list you/nut-ledger
npm run devices -- delete you/nut-ledger --unreadable        # remove files that cannot be decrypted
npm run devices -- delete you/nut-ledger 0123456789abcdef.bin --force   # remove a readable one
```

- The token is read from the environment, never from an argument, so it stays out of your shell history.
- With `ETT_SYNC_LINK` (Advanced → Sync with GitHub → Copy link) the tool can tell which files are
  readable; it also supplies the repository name. Without it, `list` still works but nothing can be
  identified as unreadable.
- Unreadable files hold nothing anyone can recover, so removing them is safe. A **readable** file belongs
  to a device whose latest data other devices may not have merged yet, so deleting it needs `--force`;
  make sure every device has synced first.
- `--dry-run` shows what would be deleted; `--yes` skips the typed confirmation.

#### Live pairing (advanced, optional, currently switched off)

> **Currently switched off.** The button is hidden and nothing connects, so there are no signaling
> errors. To bring it back, set `LIVE_PAIRING_ENABLED = true` in the module script of
> `web-frontend/index.html`. Nothing was removed, and a saved pairing resumes.

**Advanced → Live pairing** syncs devices directly with each other over WebRTC, instantly, but only
while both are open, and it needs a signaling server of your own. Most people do not need it.

You need a signaling server first (see below). Then choose **Advanced → Live pairing**, enter the
server's address under **Signaling server**, and **Create pairing link** on one device. Open the link on
another (or scan the QR code with your phone) and the two start syncing; repeat for each further
device. The footer shows **Syncing with N other devices** while they are connected. If it does not
connect, the footer and the **Sync details** list in the pairing dialog say why.

- **The link is the key.** It contains a random room name and secret, in the part of the URL after
  `#`, which browsers never send to a server. All traffic between your devices is encrypted with
  that secret. Anyone who has the link can read and change your data, so share it only with yourself.
- **Signaling server.** Devices find each other through a small signaling server that sees only
  encrypted set-up messages, never your data. There is no built-in one: the free public servers
  that y-webrtc used to point to have gone away. Run your own with `npm run signaling`
  (from this repo after `npm install`; listens on port 4444). Enter its address under
  **Signaling server** in the pairing dialog _before_ you share the link, since the link carries it.
  - To try it on one computer: `ws://localhost:4444`, with the app on `http://localhost:5000`.
  - To test any signaling address from a given machine: `npm run check:signaling -- wss://your.server`
    (needs only bash and curl; it reports whether DNS, the connection or the WebSocket handshake fails).
  - For other devices, and for the GitHub Pages site (https), the address must be `wss://` (the
    browser blocks plain `ws://` from an https page, except `localhost`). That means hosting the
    server somewhere with a TLS certificate, for example a small VPS or container behind a TLS
    proxy; it is stateless and uses almost no resources.
- **Unpair this device** stops syncing here and keeps your data. It does not remove other devices;
  to cut one off, unpair everywhere and create a new pairing, which has a new secret.
- Some networks (strict firewalls, some mobile carriers) block direct connections between devices.
- Tabs of the same browser sync with each other automatically.

Back up and Import also work as a manual fallback that needs nothing.

### Changes from other devices

When data from another device arrives (through GitHub, live pairing, or by importing a backup) and it changes the selected day
(bubbles, tasks, renames, memo, or notes), the page updates itself and shows a notice listing what
changed, for example `"Writing": +3 intervals` or `Renamed "A" to "B"`. The notice disappears
after 20 seconds or when dismissed. Text you are typing in memo or notes is kept unless the other
device changed the same field. Edits made on two devices at once are merged: bubbles from both
are kept, and for a rename or a memo the later edit wins.

Click a task name in the grid to edit it. Enter or leaving the field saves;
Escape cancels. Blank names are rejected. Renaming changes the task's name across
all days, preserving its identity and every day's bubbles. Removing a row detaches it
from the selected day and removes only that day's bubbles; the task and
other days' time remain.

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
├── web-frontend/         The app: plain HTML/CSS/JS, no build step (vendor/ holds the bundled Yjs)
├── supabase/             Retired Supabase schema and the one-off export query
├── backend/              Legacy Rails API, not in use
├── ios-app/              Placeholder SwiftUI app, not in use
├── ARCHITECTURE.md       Current architecture reference
└── README-DEV.md         Dev environment and deployment
```

## 💰 Cost

Nothing to run or pay for: GitHub Pages serves the files, and syncing uses a private repository on your
GitHub account (the free plan is plenty for the small encrypted files).

## 💡 Ideas, not started

- Analytics views over the interval history
- Native mobile apps (`ios-app/` is only a placeholder) and push notifications

---

## ❓ FAQ

**Q: Why not use Next.js or React for the web?**  
A: Simplicity. No framework and no build step; vanilla JS is fast enough for a timer app. The only runtime library is Yjs, bundled in `web-frontend/vendor/`.

**Q: Do I need an account?**  
A: No. There is no sign-in; data stays in your browser. Use Back up regularly, since clearing site data deletes it.

**Q: Can I use it on my phone and laptop?**  
A: Yes. Use Advanced → Sync with GitHub on each (they do not need to be open together), or move data by hand with Back up and Import. Either way the merge keeps both devices' changes.

**Q: How is it deployed?**  
A: A GitHub Actions workflow publishes `web-frontend/` to GitHub Pages on every push to `main` (see [README-DEV.md](README-DEV.md)).

---

## 📚 Resources

- [Emergent Task Timing (Original Article)](https://davidseah.com/2006/04/the-printable-ceo-iii-emergent-task-timing/)
- [Yjs Documentation](https://docs.yjs.dev)

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

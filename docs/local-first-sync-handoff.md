# Local-first sync through a private GitHub repo: handoff

A self-contained briefing for a Claude instance (or a person) who will turn this working design into a
project-independent skill plus prompts. Everything here was built and run in the Squirrel Tracks app
(a vanilla-JS, no-backend time tracker). Source paths are relative to that repo. Nothing here depends on
the conversation that produced it.

## 1. The idea in one paragraph

Every device keeps the **full data locally** in a CRDT (Yjs) persisted in IndexedDB, so the app works
offline with no account and no server of its own. To sync, each device publishes **one encrypted file of its
whole state** to a **private GitHub repository** the user owns, and merges the other devices' files. A
device only ever writes its own file, so there are no write conflicts; the CRDT merges everything else.
Devices never need to be online together. GitHub only sees ciphertext. An optional second path syncs
devices directly over WebRTC when both are open, but it needs a signaling server, so it is off by default.

## 2. Layers

```
UI (app-specific)                    app-grid.js, index.html
  └─ Store (app-specific model)      store.js           Yjs doc, flat maps, merge rules, import/export
       ├─ IndexedDB persistence      y-indexeddb        automatic, the source of truth on a device
       ├─ GitHub sync   (generic)    github-sync.js     encrypted per-device files via the REST contents API
       └─ Live pairing  (generic)    sync.js            y-webrtc + link/QR pairing, currently switched off
Tools (generic)                      scripts/devices.cjs (cleanup CLI), scripts/fake-github.cjs (test double),
                                     scripts/check-signaling.sh
Build                                npm run vendor: esbuild bundles yjs + y-indexeddb + y-webrtc + qrcode
                                     into web-frontend/vendor/yjs.js (committed; no CDN, works offline)
```

The app has **no build step** apart from that one generated, committed bundle. Scripts are classic
`<script>` tags sharing globals; a single `<script type="module">` imports the bundle, opens the store,
starts the sync objects and dispatches an `app-store-ready` event that the UI waits for.

## 3. Data model rules (the CRDT lessons)

These are the rules that made merging correct. They are the most reusable part of the idea.

- **Never nest shared types.** If two devices each create the same nested `Y.Map` while apart, Yjs keeps
  one and silently drops the other's contents. Use **flat `Y.Map`s keyed by composite strings**
  (`date|taskId|slot`, `date|field`). A test creates the same new day on two devices and asserts both keep
  their data.
- **Values must be primitives.** Task records are stored as JSON text. (Plain objects built in another JS
  realm are also rejected by Yjs with "Unexpected content type", which surfaced in the vm-based tests.)
- **Deletes are tombstones**, not removals: deleting a task writes `tombstones[id]=true`; readers filter.
  Clearing a bubble deletes its key (per-key LWW/removal).
- **Identity by UUID, uniqueness by rule.** Two devices can create the same name while apart; after a
  merge a deterministic `dedupeTasks` keeps the lowest id, moves the others' data onto it and tombstones
  the rest. Every device picks the same survivor, so they converge. Run it on load and after remote updates
  (origin-filtered so it does not loop).
- **Origins matter.** Local edits use origin `"local"`, merges from GitHub use `"github"`, imports
  `"import"`, dedupe `"dedupe"`. "Remote change" notifications fire for anything but local/dedupe. GitHub
  pulls must not mark the doc dirty or they would be pushed straight back.
- Imports (backup file, legacy localStorage, legacy cloud export) **merge**; nothing overwrites.

## 4. The GitHub sync protocol (`web-frontend/js/github-sync.js`)

**Repo layout.** `devices/<deviceId>.bin`, one file per browser/device. `deviceId` is 16 hex chars (8
random bytes), generated once and stored under its own storage key so it **survives disconnects**
(otherwise a re-join leaves an orphaned file behind; this really happened).

**File format.** `[1 byte version=1][12-byte random IV][AES-GCM ciphertext]` of
`Y.encodeStateAsUpdate(doc)` (the device's full state). Key: PBKDF2-SHA-256, 200 000 iterations, constant
app-specific salt string, of the shared **secret**. The secret is 16 random bytes, base64url (22 chars),
created on the first device.

**Secrets and links.** Settings per device (localStorage): `repo`, `secret`, `token`, `deviceId`.
The sync **link** is `<app url>#github=<owner/name>&secret=<secret>`. It carries repo and key and
**never the token**; the URL fragment is not sent to servers. A device that opens a link has repo+key but
no token, so it asks for one. The token is a **fine-grained personal access token** limited to the one
repository with _Contents: Read and write_, entered per device and kept only in that browser.

**API calls** (all from the browser; `api.github.com` sends `Access-Control-Allow-Origin: *`, allows
`Authorization`, `Content-Type`, `If-None-Match`, `X-GitHub-Api-Version`, methods GET/PUT/DELETE, and
exposes `ETag`; verified with a preflight request):

| Purpose                          | Call                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Verify repo and token on connect | `GET /repos/{repo}` → `private`, `permissions.push`                                                                     |
| List device files                | `GET /repos/{repo}/contents/devices` with `If-None-Match: <etag>` (304 = nothing new, 404 = none yet)                   |
| Download a file                  | `GET .../contents/devices/<id>.bin` with `Accept: application/vnd.github.raw+json`                                      |
| Publish own file                 | `PUT .../contents/devices/<id>.bin` body `{message, content: base64, sha?}`                                             |
| Cleanup tool                     | `DELETE .../contents/devices/<id>.bin` body `{message, sha}`; `GET /repos/{repo}/commits?path=...&per_page=1` for dates |

Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28`; use `cache: "no-store"` so manual ETags behave.

**Pull.** List with the stored ETag. For each file whose `sha` differs from the last one merged:
download, decrypt, `Y.applyUpdate(doc, state, "github")`, remember the sha. A file that fails to decrypt
is skipped and reported (wrong key or tampering); it never reaches the doc. If **our own file** is missing
we are dirty (publish everything we have); if our own file is undecryptable (written earlier under another
key) we are also dirty and overwrite it.

**Push.** Encode the full state, encrypt, `PUT` with the last known sha of our own file. On 409/422 (our
idea of the file's version is stale, e.g. another tab of the same device wrote it) pull, then retry once.
`dirty` is cleared only if no local change arrived while the request was in flight (a change counter).

**Schedule.** Push 10 s after the last local change (debounced); poll every 60 s while the page is
visible; also on `visibilitychange`→visible and on `online`. Failures leave the doc dirty and recover on
their own. Idle polls are a single conditional request (a 304 is cheap).

**Connect rules** (each added after a real failure):

1. `connect()` verifies the repo/token first and requires `permissions.push !== false`; it returns
   `{private}` so the UI can warn about a public repo.
2. A device **with no key for that repo** is **refused** if the repo already holds device files: it would
   invent a different key and neither side could read the other. It must join through the sync link.
3. **One key per repository.** The secret is reused only when reconnecting to the _same_ repo; a different
   repo gets a new secret, so environments never share a key.
4. Status values: `off`, `needs-token`, `syncing`, `ok`, `offline`, `error`; undecryptable files produce an
   error that names the files and says what to do.

## 5. Live pairing (`web-frontend/js/sync.js`), optional, switched off

`PeerSync` wraps y-webrtc's `WebrtcProvider`. Pairing = random room (16 bytes hex) + secret (16 bytes
base64url) in a link `#pair=<room>.<secret>[&signaling=<urls>]` (QR via `qrcode-generator`); the secret is
the provider's `password` (encrypts signaling and data). Verified working between two browser profiles
with a local signaling server. It is **disabled** (`LIVE_PAIRING_ENABLED = false` in `index.html`)
because it needs a signaling server and the free public ones are gone: the old default
(`wss://y-webrtc-eu.fly.dev`) stopped answering and was checked from two networks. Hosting options
researched in Nov 2026 (recheck, terms change often): Cloudflare Workers + Durable Objects (free plan,
SQLite-backed; would need a small Worker speaking the y-webrtc signaling protocol), Render free web
service (spins down after 15 min idle; works, slow first connect), Oracle Always Free (reduced in 2026),
Fly.io (no free tier for new accounts). Note an https page cannot open plain `ws://` except to
`localhost`, so other devices need `wss://`.

## 6. Security model (honest version)

- **Protected:** confidentiality of contents (AES-GCM, key never in the repo or in transit to GitHub);
  integrity of what is decrypted (GCM tag; a tampered file is rejected). The token never leaves the device.
- **Visible to anyone who can read the repo:** file names, sizes, commit times (activity pattern).
- **Not protected:** GitHub tokens cannot be limited to a folder or a branch, so anything that can write
  the repo can **delete or overwrite** any file (availability, and rollback to an older state). The
  ciphertext is not bound to its file name (no AAD), so swapping files between devices is not detected;
  an old state merges harmlessly but is a rollback vector. Anyone with the link _and_ repo read access can
  decrypt. Lost link + lost devices = unrecoverable data.
- **Not independently reviewed.** The design, code and tests were all produced in one working session.
  Treat a security review as outstanding work (§11).

## 7. Decision log

| Decision                                         | Why                                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-first, no app backend                      | The user wanted no vendor dependency and no always-on server.                                                                                      |
| Yjs CRDT over a hand-rolled merge                | Proven convergence; edits from offline devices never conflict.                                                                                     |
| Flat maps with composite keys                    | Nested maps lose data on concurrent creation (§3).                                                                                                 |
| One file per device, own file only               | No write races between devices; each merges the rest.                                                                                              |
| GitHub repo as the channel                       | Free, familiar, asynchronous (devices need not be online together), no server.                                                                     |
| Per-device token, secret in the link             | Link can be shared between your own devices without leaking write access.                                                                          |
| Repo per environment, not folder per environment | A token covers a whole repo, so dev code would hold prod's write access. Apps may share a repo per environment (folders); environments should not. |
| Dev badge keyed on the deploy stamp              | Only the deploy workflow writes a real `APP_VERSION.commit`; no domain hardcoding.                                                                 |
| Vendor the Yjs bundle                            | No CDN dependency; works offline; one reviewed artifact.                                                                                           |
| No default signaling server                      | Public ones disappear; a dead default produced silent failures.                                                                                    |
| Live pairing off, not deleted                    | Reversible with one constant; avoids connection errors.                                                                                            |

## 8. Gotchas found the hard way

- **Dual-package hazard:** CommonJS `require("yjs")` and the ESM copy that y-webrtc loads are different
  modules ("Yjs was already imported"). In tests that use y-webrtc, import Yjs as ESM everywhere.
- **y-webrtc keeps one room table per JS realm**, so two devices cannot share a room in one process.
  Tests run each device in a **worker thread** (own registry); they find each other over
  `BroadcastChannel`, which exercises the real encryption/protocol. WebRTC itself needs a browser.
- **`provider.destroy()` leaves y-webrtc's awareness timer running**; also call `awareness.destroy()`
  (done in `PeerSync.stop`) or timers leak on every reconnect. In Node it also keeps the process alive.
- **vm-based tests:** arrays/objects built inside a `vm` context have another realm's prototypes, so strict
  `deepEqual` fails; compare JSON forms.
- **Unref/clear test timers** (a pending `setTimeout` kept `node --test` alive for 8 s).
- **Prettier reformats Markdown tables**, which silently broke later text-anchored scripted edits twice.
  Re-read the file before anchoring on table rows, and make scripted edits fail loudly _before_ committing
  (`set -e`, assert on every replace).
- **Browser console noise:** failed WebSocket connections are always logged by the browser and cannot be
  silenced; stop the cause (unpair/disable) instead.
- **First load needs the network** (no service worker yet); data persistence asks the browser for
  `navigator.storage.persist()`.
- **A device that connects by hand to a populated repo** invents its own key (fixed by the refusal rule);
  the symptom is "data from another device could not be decrypted".

## 9. Verification status

**Automated** (`npm test`, 132 tests at time of writing, Node 20): store merge semantics (concurrent
edits, same-day creation, dedupe, legacy import), GitHub sync against an in-memory GitHub
(`scripts/fake-github.cjs`: convergence between devices never open together, concurrent edits, idle polls
download/write nothing, no push loops, stale-sha recovery for two tabs, wrong key, tampering, offline
recovery, token/rate-limit/offline messages, link round trip, repo-move key rules, device-id migration),
PeerSync with a fake provider plus a two-worker real-provider convergence test, the cleanup CLI.

**Confirmed by hand by the user:** GitHub sync between two browsers against real GitHub (after fixing the
mismatched-key incident); live pairing between two profiles via a local signaling server; Pages deploy of
the new version. **Not verified:** behaviour on a completely empty repo (setup says "add a README" to
avoid it), states above ~1 MB, sustained rate-limit behaviour, token expiry flow, mobile browsers
(especially iOS storage eviction), the CLI against real GitHub, anything on a custom WebRTC network.

## 10. Extraction map for the shared project

| File                                                  | Generic?                 | Needed changes                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-frontend/js/github-sync.js`                      | **Core, mostly generic** | Hard-coded: storage keys `ettGithubSync`/`ettGithubDeviceId`, folder `devices`, KDF salt `squirrel-tracks-github-sync-v1`, UI wording ("Advanced → Sync with GitHub"). Assumes Yjs (`encodeStateAsUpdate`/`applyUpdate`/`doc.on("update")`) and browser globals. |
| `web-frontend/js/sync.js`                             | Generic                  | Storage key `ettSyncPairing`; only if live pairing is kept.                                                                                                                                                                                                      |
| `scripts/devices.cjs`                                 | Generic                  | Reuses `GitHubSync`; follows its folder/key renames.                                                                                                                                                                                                             |
| `scripts/fake-github.cjs`                             | Generic                  | Add whatever endpoints new features use. Keep it the single GitHub double.                                                                                                                                                                                       |
| `scripts/check-signaling.sh`                          | Generic                  | Only relevant with live pairing.                                                                                                                                                                                                                                 |
| `web-frontend/vendor-src/entry.js` + `npm run vendor` | Generic recipe           | Pin versions; commit the output.                                                                                                                                                                                                                                 |
| `web-frontend/js/store.js`                            | **App-specific**         | Reuse the _patterns_ (flat maps, tombstones, dedupe, origins, legacy import), not the model.                                                                                                                                                                     |
| `web-frontend/js/app-grid.js`, `index.html`           | App-specific UI          | Reusable pieces: boot/module-loader pattern, sync dialog logic, footer status precedence, startup error banner (window error/unhandledrejection filtered to own origin + 5 s watchdog), DEV badge, token/secret handling.                                        |
| `web-frontend/js/*.test.cjs`, `scripts/*.test.cjs`    | Reusable as templates    | The test list in §9 is effectively the acceptance suite for any implementation.                                                                                                                                                                                  |

## 11. Suggested project-independent shape

Rename everything that says `ett`/`squirrel-tracks` to an **`appId`** option that namespaces: storage keys
(`<appId>:github`, `<appId>:device`), the KDF salt (`<appId>-sync-v1`), the IndexedDB name, and the repo
folder (`<appId>/devices/` for shared repos; the current un-namespaced `devices/` stays valid as "empty
folder name" for backward compatibility). Put the link parameters (`github`, `secret`, `folder`) in one
place. Replace the hard-wired Yjs dependency with a small **adapter**:

```js
new GitHubSync({
  appId: "my-app",
  adapter: { encodeState(): Uint8Array, applyState(bytes, origin): void, onLocalChange(cb): void },
  storage, fetch, now, subtle, randomBytes,      // all injectable, as today
});
```

so a non-Yjs app can supply its own mergeable state (the per-device-file, encrypted-blob transport does not
care what is inside, but the app must be able to merge two states without conflicts).

**Skill outline** (`local-first-github-sync/SKILL.md`): when to use / not use (single user, own devices; not
for multi-user or large data); decision tree (need both devices online at once? → WebRTC path; else GitHub
path); steps: (1) choose the data model and apply the CRDT rules of §3, (2) vendor the bundle, (3) store
layer + tests, (4) add GitHub sync + the in-memory GitHub double, (5) dialog, link and footer status, (6)
dev vs prod, (7) cleanup CLI, (8) checklist of the failure modes in §4 and §8.
**Prompts** worth providing: "add a local-first store to this app", "add GitHub sync", "separate dev and
production data", "review this sync implementation against the invariants", "migrate from a hosted backend
to local-first including a one-off export/import" (the Supabase migration here is a worked example:
export query → JSON → merging import).

## 12. Polish backlog (rough priority)

1. **Folder/namespace support** and the `appId` option (apps share one repo per environment; see §7).
2. **Adapter interface** and packaging as a module without globals (ESM + the current CJS test export).
3. **Remove unreadable files** button in the app (the CLI exists; stray files appear when a browser's
   data is cleared and it returns with a new device id).
4. **Dev safety:** warn when a DEV build connects to a repo that is not the dev one (naming convention or
   an explicit "environment" setting stored with the pairing).
5. **Token expiry:** check whether GitHub returns the fine-grained token's expiry on API responses and warn
   before it lapses; today the footer only reports a rejected token after the fact.
6. **Revocation/rotation:** removing a device means deleting its token, but the key stays valid; add "new
   key" (re-encrypt and republish everywhere) for a lost link.
7. **Integrity hardening:** bind ciphertext to file name/version with AES-GCM additional data; consider
   HKDF in place of PBKDF2 (the secret already has 128 bits of entropy, so the slow KDF adds little).
8. **History growth:** every push is a commit of an incompressible blob. Measure, then consider batching or
   a documented squash procedure.
9. **Opt-in integration test** against a real throwaway repo (env-gated), to close the §9 gaps (empty repo,
   large states, rate limits).
10. **Offline first load** (service worker) and iOS storage-eviction behaviour.
11. **Live updates between tabs of one browser** without WebRTC (y-indexeddb does not sync tabs live).
12. **Independent security review** of §4 and §6.

## 13. Questions the owner still has to answer

- Which other apps will use this, and is their state a Yjs document or something else (decides how much of
  the adapter work is needed)?
- Is a shared repo per environment wanted (folders per app), and what is the naming convention?
- Should the skill keep live pairing, or document it as an appendix only?
- How is the shared code distributed: copied by the skill into each project, or an installable package?

## 14. Reproduce and explore

```bash
npm install
npm test                       # 132 tests, in-memory GitHub, no network
npm start                      # serves web-frontend on :5000 (the page shows a DEV badge locally)
npm run vendor                 # rebuild web-frontend/vendor/yjs.js after changing dependency versions
npm run devices -- list owner/name     # needs GITHUB_TOKEN (and optionally ETT_SYNC_LINK)
```

Start reading at `ARCHITECTURE.md` (system overview), then `web-frontend/js/github-sync.js` and its test
`web-frontend/js/github-sync.test.cjs`. `CLAUDE.md` holds the working conventions for this repo.

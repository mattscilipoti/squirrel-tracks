/**
 * GitHubSync - syncs the Yjs document through a private GitHub repository.
 *
 * Each device owns one file, `devices/<deviceId>.bin`, holding the device's full Yjs state
 * encrypted with AES-GCM (key derived from a shared secret). A device only ever writes its
 * own file, so devices never overwrite each other; each one reads the others' files and
 * merges them with Yjs. Devices do not need to be open at the same time, and GitHub only
 * ever sees ciphertext.
 *
 * Talks to the GitHub REST "contents" API from the browser. Needs a fine-grained access
 * token limited to the one repository with "Contents: Read and write". The token stays on
 * the device (localStorage); the shared secret travels in a link (URL fragment) and the
 * token never does.
 *
 * Yjs, fetch, storage and crypto are injected so tests can run it without a network.
 */
class GitHubSyncError extends Error {
  constructor(message, { status = 0, kind = "api" } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // "api" | "network"
  }
}

class GitHubSync {
  static STORAGE_KEY = "ettGithubSync";
  // Identifies this browser's file in the repository. Kept when the device disconnects, so
  // joining again replaces its old file instead of leaving a stray one behind.
  static DEVICE_KEY = "ettGithubDeviceId";
  static DIR = "devices";
  static PUSH_DELAY_MS = 10000;
  static POLL_MS = 60000;
  static Error = GitHubSyncError;

  constructor({
    Y,
    doc,
    storage,
    fetch,
    randomBytes,
    subtle,
    autoSchedule = true,
    now = () => new Date(),
  } = {}) {
    this.Y = Y;
    this.doc = doc;
    this.storage = storage;
    this.fetchFn = fetch || ((...args) => globalThis.fetch(...args));
    this.randomBytes =
      randomBytes ||
      ((count) => globalThis.crypto.getRandomValues(new Uint8Array(count)));
    this.subtle = subtle || globalThis.crypto?.subtle;
    this.autoSchedule = autoSchedule;
    this.now = now;
    this.listeners = [];
    this.running = false;
    this.busy = false;
    this.again = false;
    this.dirty = false;
    this.changeCount = 0;
    this.etag = null;
    this.ownSha = null;
    this.known = new Map(); // file name -> sha already merged (or written by us)
    this.undecryptable = new Set();
    this.error = null;
    this.lastSuccess = null;
    this.keyPromise = null;
    // Devices set up before the id had its own storage key kept it inside the settings.
    const legacyId = this.settings?.deviceId;
    if (legacyId && !this.storage.getItem(GitHubSync.DEVICE_KEY))
      this.storage.setItem(GitHubSync.DEVICE_KEY, legacyId);
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  /** { repo, secret, token, deviceId } or null when not set up. */
  get settings() {
    try {
      const saved = JSON.parse(this.storage.getItem(GitHubSync.STORAGE_KEY));
      if (!GitHubSync.validRepo(saved?.repo)) return null;
      if (!/^[A-Za-z0-9_-]{16,}$/.test(saved?.secret || "")) return null;
      return {
        repo: saved.repo,
        secret: saved.secret,
        token: typeof saved.token === "string" && saved.token ? saved.token : null,
        deviceId: /^[0-9a-f]{16}$/.test(saved.deviceId || "") ? saved.deviceId : null,
      };
    } catch {
      return null;
    }
  }

  static validRepo(repo) {
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "");
  }

  static validToken(token) {
    return /^[A-Za-z0-9_]{20,}$/.test(token || "");
  }

  isConfigured() {
    return Boolean(this.settings?.token);
  }

  /** Joined from a link but no token entered on this device yet. */
  needsToken() {
    const settings = this.settings;
    return Boolean(settings && !settings.token);
  }

  save(settings) {
    this.storage.setItem(GitHubSync.STORAGE_KEY, JSON.stringify(settings));
    this.keyPromise = null;
  }

  newSecret() {
    return btoa(String.fromCharCode(...this.randomBytes(16)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }

  deviceId() {
    const saved = this.storage.getItem(GitHubSync.DEVICE_KEY);
    if (/^[0-9a-f]{16}$/.test(saved || "")) return saved;
    const id = Array.from(this.randomBytes(8), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    this.storage.setItem(GitHubSync.DEVICE_KEY, id);
    return id;
  }

  /**
   * Check the repository and token, then save them and start syncing. Keeps this
   * device's secret if it has one, otherwise makes a new one. Resolves to
   * { private } so the caller can warn about a public repository.
   */
  async connect({ repo, token }) {
    repo = String(repo || "").trim();
    token = String(token || "").trim();
    if (!GitHubSync.validRepo(repo))
      throw new GitHubSyncError('Enter the repository as "owner/name".');
    if (!GitHubSync.validToken(token))
      throw new GitHubSyncError("That does not look like a GitHub access token.");
    const info = await this.verify(repo, token);
    const existing = this.settings;
    // A device that has no key yet would invent its own, which cannot read the files of a
    // device that already published with a different one. It must join with that device's link.
    if (!existing?.secret && (await this.hasDeviceFiles(repo, token)))
      throw new GitHubSyncError(
        "This repository already holds data from another device, which this device can't read without that device's sync link. On the other device open Advanced → Sync with GitHub → Copy link, and open that link here. (Or use a new, empty repository.)",
      );
    this.stop();
    this.resetState();
    this.save({
      repo,
      token,
      secret: existing?.secret || this.newSecret(),
      deviceId: this.deviceId(),
    });
    await this.start(); // the first round, so problems show up straight away
    return info;
  }

  async verify(repo, token) {
    const response = await this.request("GET", `/repos/${repo}`, { token });
    if (!response.ok) throw this.errorFor(response, "check the repository");
    const info = await response.json();
    if (info.permissions && info.permissions.push === false)
      throw new GitHubSyncError(
        'The token can read this repository but not write to it. Give it "Contents: Read and write".',
      );
    return { private: info.private !== false };
  }

  async hasDeviceFiles(repo, token) {
    const response = await this.request(
      "GET",
      `/repos/${repo}/contents/${GitHubSync.DIR}`,
      { token },
    );
    if (response.status === 404) return false;
    if (!response.ok) throw this.errorFor(response, "check the repository");
    return (await response.json()).some(
      (file) => file.type === "file" && /^[0-9a-f]{16}\.bin$/.test(file.name),
    );
  }

  /** The link another device opens. It carries the repository and key, never the token. */
  link(base) {
    const settings = this.settings;
    if (!settings) return null;
    return `${base}#${new URLSearchParams({ github: settings.repo, secret: settings.secret })}`;
  }

  /** Join from a page's location.hash. Returns true when it held a valid link. */
  joinFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const repo = params.get("github");
    const secret = params.get("secret");
    if (!GitHubSync.validRepo(repo) || !/^[A-Za-z0-9_-]{16,}$/.test(secret || ""))
      return false;
    const existing = this.settings;
    const same = existing?.repo === repo && existing?.secret === secret;
    if (same) return true;
    this.stop();
    this.resetState();
    this.save({
      repo,
      secret,
      token: existing?.repo === repo ? existing.token : null,
      deviceId: this.deviceId(),
    });
    return true;
  }

  /** Forget the repository, key and token on this device. Data stays. */
  disconnect() {
    this.stop();
    this.resetState();
    this.storage.removeItem(GitHubSync.STORAGE_KEY);
    this.keyPromise = null;
    this.notify();
  }

  resetState() {
    this.etag = null;
    this.ownSha = null;
    this.known.clear();
    this.undecryptable.clear();
    this.error = null;
    this.lastSuccess = null;
    this.dirty = false;
  }

  // ── Encryption ───────────────────────────────────────────────────────────

  key() {
    this.keyPromise ||= (async () => {
      const encoder = new TextEncoder();
      const material = await this.subtle.importKey(
        "raw",
        encoder.encode(this.settings.secret),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      return this.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: encoder.encode("squirrel-tracks-github-sync-v1"),
          iterations: 200000,
          hash: "SHA-256",
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    return this.keyPromise;
  }

  /** Layout: [version 1][12-byte IV][AES-GCM ciphertext]. */
  async encrypt(bytes) {
    const iv = this.randomBytes(12);
    const cipher = new Uint8Array(
      await this.subtle.encrypt({ name: "AES-GCM", iv }, await this.key(), bytes),
    );
    const out = new Uint8Array(1 + iv.length + cipher.length);
    out[0] = 1;
    out.set(iv, 1);
    out.set(cipher, 1 + iv.length);
    return out;
  }

  async decrypt(bytes) {
    if (bytes[0] !== 1 || bytes.length < 30) throw new Error("Not a sync file.");
    return new Uint8Array(
      await this.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(1, 13) },
        await this.key(),
        bytes.slice(13),
      ),
    );
  }

  // ── GitHub API ───────────────────────────────────────────────────────────

  async request(method, path, { token, body, etag, raw = false } = {}) {
    const headers = {
      Authorization: `Bearer ${token ?? this.settings?.token}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (body) headers["Content-Type"] = "application/json";
    try {
      return await this.fetchFn(`https://api.github.com${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new GitHubSyncError("Can't reach GitHub. Check your connection.", {
        kind: "network",
      });
    }
  }

  errorFor(response, action) {
    const status = response.status;
    let message;
    if (status === 401) {
      message = "GitHub rejected the access token (wrong, expired or revoked).";
    } else if (status === 403) {
      message =
        response.headers.get("X-RateLimit-Remaining") === "0"
          ? "GitHub's rate limit was reached. It will recover on its own."
          : 'The token is not allowed to do that. Give it "Contents: Read and write" on this repository.';
    } else if (status === 404) {
      message = "Repository not found, or the token has no access to it.";
    } else {
      message = `GitHub returned an error (${status}) while trying to ${action}.`;
    }
    return new GitHubSyncError(message, { status });
  }

  static base64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }

  // ── Syncing ──────────────────────────────────────────────────────────────

  /** Read other devices' files and merge them into the document. True if anything changed. */
  async pull() {
    const { repo, deviceId } = this.settings;
    const dir = `/repos/${repo}/contents/${GitHubSync.DIR}`;
    const response = await this.request("GET", dir, { etag: this.etag });
    if (response.status === 304) return false;
    let files = [];
    if (response.status === 404) {
      this.etag = null; // nothing published yet
    } else if (!response.ok) {
      throw this.errorFor(response, "list the synced files");
    } else {
      this.etag = response.headers.get("ETag");
      files = (await response.json()).filter(
        (file) => file.type === "file" && /^[0-9a-f]{16}\.bin$/.test(file.name),
      );
    }
    const own = files.find((file) => file.name === `${deviceId}.bin`);
    this.ownSha = own?.sha || null;
    if (!own) this.dirty = true; // we have published nothing yet

    let changed = false;
    this.undecryptable.clear();
    for (const file of files) {
      if (this.known.get(file.name) === file.sha) continue;
      const content = await this.request("GET", `${dir}/${file.name}`, { raw: true });
      if (!content.ok) throw this.errorFor(content, "download a synced file");
      let state;
      try {
        state = await this.decrypt(new Uint8Array(await content.arrayBuffer()));
      } catch {
        this.undecryptable.add(file.name);
        continue;
      }
      this.Y.applyUpdate(this.doc, state, "github");
      this.known.set(file.name, file.sha);
      changed = true;
    }
    // Our own file is ours to replace: if we cannot read it, it was written under another
    // key (this device set up on its own before joining with the right link), so republish.
    if (this.undecryptable.delete(`${deviceId}.bin`)) this.dirty = true;
    return changed;
  }

  /** Publish this device's full state to its own file. */
  async push() {
    const { repo, deviceId } = this.settings;
    const name = `${deviceId}.bin`;
    const path = `/repos/${repo}/contents/${GitHubSync.DIR}/${name}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const seen = this.changeCount;
      const content = await this.encrypt(this.Y.encodeStateAsUpdate(this.doc));
      const body = {
        message: `Sync from device ${deviceId.slice(0, 8)}`,
        content: GitHubSync.base64(content),
      };
      if (this.ownSha) body.sha = this.ownSha;
      const response = await this.request("PUT", path, { body });
      if (response.ok) {
        const written = await response.json();
        this.ownSha = written.content.sha;
        this.known.set(name, this.ownSha);
        if (this.changeCount === seen) this.dirty = false;
        return;
      }
      // Our idea of the file's version was stale (another tab of this device wrote it).
      // Merge what is there, then try once more.
      if ((response.status === 409 || response.status === 422) && attempt === 0) {
        this.etag = null;
        await this.pull();
        continue;
      }
      throw this.errorFor(response, "save your data");
    }
  }

  /** One round: merge what others published, then publish our changes if there are any. */
  async sync() {
    if (!this.isConfigured()) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.notify();
    try {
      await this.pull();
      if (this.dirty) await this.push();
      this.error = null;
      this.lastSuccess = this.now();
    } catch (error) {
      this.error =
        error instanceof GitHubSyncError ? error : new GitHubSyncError(String(error));
    } finally {
      this.busy = false;
      this.notify();
      if (this.again) {
        this.again = false;
        this.schedulePush(0);
      }
    }
  }

  schedulePush(delay = GitHubSync.PUSH_DELAY_MS) {
    if (!this.autoSchedule) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync(), delay);
  }

  /** Begin syncing in the background. Resolves when the first round finishes. */
  start() {
    if (!this.isConfigured() || this.running) return null;
    this.running = true;
    this.onUpdate = (_update, origin) => {
      if (origin === "github") return;
      this.changeCount++;
      this.dirty = true;
      this.schedulePush();
    };
    this.doc.on("update", this.onUpdate);
    if (this.autoSchedule) {
      this.interval = setInterval(() => {
        if (!globalThis.document?.hidden) this.sync();
      }, GitHubSync.POLL_MS);
      this.onVisible = () => {
        if (!globalThis.document.hidden) this.sync();
      };
      this.onOnline = () => this.sync();
      globalThis.document?.addEventListener("visibilitychange", this.onVisible);
      globalThis.addEventListener?.("online", this.onOnline);
    }
    return this.sync();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.doc.off("update", this.onUpdate);
    clearTimeout(this.pushTimer);
    clearInterval(this.interval);
    globalThis.document?.removeEventListener("visibilitychange", this.onVisible);
    globalThis.removeEventListener?.("online", this.onOnline);
  }

  // ── Status ───────────────────────────────────────────────────────────────

  /** { state, message }: off, needs-token, syncing, ok, offline or error. */
  status() {
    const settings = this.settings;
    if (!settings) return { state: "off", message: "" };
    if (!settings.token)
      return {
        state: "needs-token",
        message: "Enter your GitHub access token to start syncing.",
      };
    if (this.error)
      return this.error.kind === "network"
        ? { state: "offline", message: this.error.message }
        : { state: "error", message: this.error.message };
    if (this.undecryptable.size) {
      const names = [...this.undecryptable].slice(0, 3).join(", ");
      return {
        state: "error",
        message: `Data from another device could not be decrypted (${names}): its encryption key differs. Open the sync link from your first device here. If that device is gone, delete the file in the repository on GitHub.`,
      };
    }
    if (this.busy || !this.lastSuccess)
      return { state: "syncing", message: "Syncing with GitHub…" };
    return { state: "ok", message: "Synced with GitHub" };
  }

  onChange(listener) {
    this.listeners.push(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = GitHubSync;
}

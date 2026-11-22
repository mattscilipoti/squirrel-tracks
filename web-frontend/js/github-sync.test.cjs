const assert = require("node:assert/strict");
const { test } = require("node:test");
const Y = require("yjs");
const GitHubSync = require("./github-sync.js");
const DataStore = require("./store.js");

const TOKEN = "github_pat_" + "a".repeat(30);
const REPO = "me/squirrel-data";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** The slice of GitHub's REST API the app uses, kept in memory. */
class FakeGitHub {
  constructor({ isPrivate = true, push = true } = {}) {
    Object.assign(this, { isPrivate, push, files: new Map(), version: 0, shas: 0 });
    this.token = TOKEN;
    this.calls = [];
    this.offline = false;
    this.rateLimited = false;
    this.fetch = this.fetch.bind(this);
  }

  json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers });
  }

  async fetch(url, init = {}) {
    if (this.offline) throw new TypeError("network down");
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const headers = init.headers || {};
    const call = {
      method,
      path,
      etag: headers["If-None-Match"],
      raw: /raw/.test(headers.Accept),
    };
    this.calls.push(call);
    if (headers.Authorization !== `Bearer ${this.token}`) return this.json(401, {});
    if (this.rateLimited) return this.json(403, {}, { "X-RateLimit-Remaining": "0" });
    if (path === `/repos/${REPO}`)
      return this.json(200, {
        private: this.isPrivate,
        permissions: { push: this.push },
      });
    const dir = `/repos/${REPO}/contents/devices`;
    if (path === dir && method === "GET") {
      if (!this.files.size) return this.json(404, { message: "Not Found" });
      const etag = `"v${this.version}"`;
      if (headers["If-None-Match"] === etag) return new Response(null, { status: 304 });
      const list = [...this.files].map(([name, file]) => ({
        name,
        type: "file",
        sha: file.sha,
      }));
      return this.json(200, list, { ETag: etag });
    }
    if (path.startsWith(`${dir}/`)) {
      const name = path.slice(dir.length + 1);
      const file = this.files.get(name);
      if (method === "GET") {
        return file
          ? new Response(file.bytes, { status: 200 })
          : this.json(404, { message: "Not Found" });
      }
      if (method === "PUT") {
        const body = JSON.parse(init.body);
        if (file && body.sha !== file.sha)
          return this.json(409, { message: "sha mismatch" });
        if (!file && body.sha) return this.json(422, { message: "sha not needed" });
        const sha = `sha${++this.shas}`;
        this.files.set(name, { sha, bytes: Buffer.from(body.content, "base64") });
        this.version++;
        return this.json(file ? 200 : 201, { content: { sha } });
      }
    }
    return this.json(404, {});
  }

  count(method, pattern) {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path)).length;
  }
}

let ids = 0;
function device(github, { storage = memoryStorage() } = {}) {
  const doc = new Y.Doc();
  const store = new DataStore(Y, doc, { idFactory: () => `t${++ids}` });
  const sync = new GitHubSync({
    Y,
    doc,
    storage,
    fetch: github.fetch,
    autoSchedule: false,
  });
  return { doc, store, sync, storage };
}

const join = async (host, guest) => {
  const link = host.sync.link("https://example.org/");
  assert.equal(guest.sync.joinFromHash(link.slice(link.indexOf("#"))), true);
  await guest.sync.connect({ repo: REPO, token: TOKEN });
};

const bubbles = (store, date = "2026-11-22") =>
  store.readDay(date).gridData.map((row) => row.flatMap((f, slot) => (f ? [slot] : [])));

test("connecting checks the repository and token and reports a public repo", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  assert.deepEqual(await a.sync.connect({ repo: REPO, token: TOKEN }), { private: true });
  assert.equal(a.sync.isConfigured(), true);
  assert.equal(a.sync.status().state, "ok");

  const publicRepo = device(new FakeGitHub({ isPrivate: false }));
  assert.deepEqual(await publicRepo.sync.connect({ repo: REPO, token: TOKEN }), {
    private: false,
  });
});

test("connecting rejects bad input, bad tokens, unknown repos and read-only tokens", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  await assert.rejects(a.sync.connect({ repo: "nonsense", token: TOKEN }), /owner\/name/);
  await assert.rejects(a.sync.connect({ repo: REPO, token: "short" }), /access token/);
  await assert.rejects(
    a.sync.connect({ repo: REPO, token: "github_pat_" + "b".repeat(30) }),
    /rejected the access token/,
  );
  await assert.rejects(
    a.sync.connect({ repo: "me/other", token: TOKEN }),
    /not found|no access/,
  );
  await assert.rejects(
    device(new FakeGitHub({ push: false })).sync.connect({ repo: REPO, token: TOKEN }),
    /Contents: Read and write/,
  );
  assert.equal(a.sync.isConfigured(), false, "nothing is saved after a failed connect");
});

test("a device's data is published encrypted, not as readable text", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const id = a.store.createTask("Secret project name");
  a.store.setCell("2026-11-22", id, 5, true);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  assert.equal(github.files.size, 1);
  const [{ bytes }] = [...github.files.values()];
  assert.equal(bytes[0], 1);
  assert.equal(bytes.includes(Buffer.from("Secret project name")), false);
  assert.equal(bytes.toString("latin1").includes("2026-11-22"), false);
});

test("devices that are never open together converge through the repository", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const b = device(github);
  const id = a.store.createTask("Writing");
  a.store.setCell("2026-11-22", id, 5, true);
  a.store.setDayField("2026-11-22", "memo", "from A");
  await a.sync.connect({ repo: REPO, token: TOKEN });

  await join(a, b); // B arrives later and receives A's data
  assert.deepEqual(b.store.readDay("2026-11-22").tasks, ["Writing"]);
  assert.deepEqual(bubbles(b.store), [[5]]);
  assert.equal(b.store.readDay("2026-11-22").memo, "from A");

  b.store.setCell("2026-11-22", id, 6, true); // B edits while A is closed
  await b.sync.sync();
  await a.sync.sync(); // A opens later
  assert.deepEqual(bubbles(a.store), [[5, 6]]);
});

test("edits made on two devices at once are merged", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const b = device(github);
  const id = a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  await join(a, b);

  a.store.setCell("2026-11-22", id, 1, true);
  b.store.setCell("2026-11-22", id, 2, true);
  b.store.setDayField("2026-11-22", "notes", "b's notes");
  await a.sync.sync();
  await b.sync.sync();
  await a.sync.sync();
  for (const d of [a, b]) {
    assert.deepEqual(bubbles(d.store), [[1, 2]]);
    assert.equal(d.store.readDay("2026-11-22").notes, "b's notes");
  }
});

test("a new device with its own data publishes it for the others", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const b = device(github);
  const id = b.store.createTask("Only on B");
  b.store.setCell("2026-11-21", id, 9, true);
  await join(a, b);
  await a.sync.sync();
  assert.deepEqual(a.store.readDay("2026-11-21").tasks, ["Only on B"]);
});

test("an idle round downloads nothing and writes nothing", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const puts = github.count("PUT", /./);
  const downloads = github.calls.filter((c) => c.raw).length;
  github.calls.length = 0;
  await a.sync.sync();
  await a.sync.sync();
  assert.equal(github.count("PUT", /./), 0);
  assert.equal(puts, 1);
  assert.equal(github.calls.filter((c) => c.raw).length, 0);
  assert.equal(downloads, 0, "our own file was never downloaded");
  assert.equal(github.calls[1].etag, '"v1"', "later checks are conditional");
});

test("changes that came from GitHub are not pushed back", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const b = device(github);
  const id = a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  await join(a, b);
  a.store.setCell("2026-11-22", id, 3, true);
  await a.sync.sync();
  const before = github.count("PUT", /./);
  await b.sync.sync();
  assert.equal(b.sync.dirty, false);
  await b.sync.sync();
  assert.equal(github.count("PUT", /./), before);
});

test("two tabs of one device recover from a stale file version", async () => {
  const github = new FakeGitHub();
  const storage = memoryStorage();
  const tab1 = device(github, { storage });
  const id = tab1.store.createTask("Writing");
  await tab1.sync.connect({ repo: REPO, token: TOKEN });
  const tab2 = device(github, { storage });
  tab2.sync.keyPromise = null;
  await tab2.sync.start();
  tab1.store.setCell("2026-11-22", id, 1, true);
  tab2.store.setCell("2026-11-22", id, 2, true);
  await tab1.sync.sync(); // tab1 writes the shared file
  await tab2.sync.sync(); // tab2's version is stale, so it merges and retries
  await tab1.sync.sync();
  assert.deepEqual(bubbles(tab1.store), [[1, 2]]);
  assert.deepEqual(bubbles(tab2.store), [[1, 2]]);
  assert.equal(tab2.sync.status().state, "ok");
});

test("a device with a different key cannot read the data and says so", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const id = a.store.createTask("Writing");
  a.store.setCell("2026-11-22", id, 1, true);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const stranger = device(github);
  stranger.sync.joinFromHash(`#github=${REPO}&secret=${"x".repeat(22)}`); // a different key
  await stranger.sync.connect({ repo: REPO, token: TOKEN });
  assert.deepEqual(stranger.store.readDay("2026-11-22").tasks, []);
  assert.equal(stranger.sync.status().state, "error");
  assert.match(stranger.sync.status().message, /decrypted/);
});

test("a new device cannot invent its own key for a repository that already has data", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const b = device(github);
  await assert.rejects(
    b.sync.connect({ repo: REPO, token: TOKEN }),
    /already holds data from another device.*sync link/s,
  );
  assert.equal(b.sync.settings, null, "nothing was saved, so no mismatched key exists");
  assert.equal(github.files.size, 1, "and nothing was written to the repository");
});

test("a device that set up with the wrong key recovers by joining with the right link", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const b = device(github);
  const idA = a.store.createTask("From A");
  a.store.setCell("2026-11-22", idA, 1, true);
  const idB = b.store.createTask("From B");
  b.store.setCell("2026-11-22", idB, 2, true);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  b.sync.joinFromHash(`#github=${REPO}&secret=${"y".repeat(22)}`); // B went its own way
  await b.sync.connect({ repo: REPO, token: TOKEN });
  await a.sync.sync();
  assert.equal(a.sync.status().state, "error");
  assert.equal(b.sync.status().state, "error");

  b.sync.disconnect(); // what the user does, then opens A's link
  await join(a, b);
  await a.sync.sync();
  for (const d of [a, b]) {
    assert.equal(d.sync.status().state, "ok");
    assert.deepEqual(d.store.readDay("2026-11-22").tasks.sort(), ["From A", "From B"]);
  }
});

test("joining from a link keeps the token out of the link and asks for one", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const link = a.sync.link("https://example.org/app/");
  assert.match(link, /^https:\/\/example\.org\/app\/#github=/);
  assert.equal(link.includes(TOKEN), false);

  const b = device(github);
  assert.equal(b.sync.joinFromHash(link.slice(link.indexOf("#"))), true);
  assert.equal(b.sync.needsToken(), true);
  assert.equal(b.sync.isConfigured(), false);
  assert.equal(b.sync.status().state, "needs-token");
  assert.equal(b.sync.settings.secret, a.sync.settings.secret);
  for (const hash of ["", "#github=nope", "#github=me/x&secret=short", "#other=1"])
    assert.equal(b.sync.joinFromHash(hash), false, hash);
});

test("disconnecting forgets the repository, key and token but not the data", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  a.sync.disconnect();
  assert.equal(a.sync.settings, null);
  assert.equal(a.sync.status().state, "off");
  assert.equal(a.storage.getItem(GitHubSync.STORAGE_KEY), null);
  assert.deepEqual(
    a.store.liveTasks().map((t) => t.name),
    ["Writing"],
  );
  a.store.createTask("More");
  const puts = github.count("PUT", /./);
  await a.sync.sync();
  assert.equal(github.count("PUT", /./), puts, "stopped syncing");
});

test("problems are reported with a plain explanation and recover on their own", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });

  github.offline = true;
  await a.sync.sync();
  assert.equal(a.sync.status().state, "offline");

  github.offline = false;
  github.rateLimited = true;
  await a.sync.sync();
  assert.equal(a.sync.status().state, "error");
  assert.match(a.sync.status().message, /rate limit/);

  github.rateLimited = false;
  github.token = "github_pat_" + "z".repeat(30); // revoked on GitHub's side
  await a.sync.sync();
  assert.match(a.sync.status().message, /rejected the access token/);

  github.token = TOKEN;
  await a.sync.sync();
  assert.equal(a.sync.status().state, "ok");
});

test("edits made while offline are published once the connection returns", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const id = a.store.createTask("Writing");
  await a.sync.connect({ repo: REPO, token: TOKEN });
  github.offline = true;
  a.store.setCell("2026-11-22", id, 4, true);
  await a.sync.sync();
  assert.equal(a.sync.dirty, true);
  github.offline = false;
  await a.sync.sync();
  assert.equal(a.sync.dirty, false);
  const b = device(github);
  await join(a, b);
  assert.deepEqual(bubbles(b.store), [[4]]);
});

test("a tampered file is ignored instead of corrupting the data", async () => {
  const github = new FakeGitHub();
  const a = device(github);
  const id = a.store.createTask("Writing");
  a.store.setCell("2026-11-22", id, 1, true);
  await a.sync.connect({ repo: REPO, token: TOKEN });
  const [name, file] = [...github.files][0];
  const bytes = Buffer.from(file.bytes);
  bytes[bytes.length - 1] ^= 0xff;
  github.files.set(name, { sha: "tampered", bytes });
  const b = device(github);
  await join(a, b);
  assert.deepEqual(b.store.readDay("2026-11-22").tasks, []);
  assert.equal(b.sync.status().state, "error");
});

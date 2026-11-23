const assert = require("node:assert/strict");
const { test } = require("node:test");
const Y = require("yjs");
const GitHubSync = require("../web-frontend/js/github-sync.js");
const DataStore = require("../web-frontend/js/store.js");
const { FakeGitHub, TOKEN, REPO } = require("./fake-github.cjs");
const { run, parseArgs, parseLink } = require("./devices.cjs");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

let ids = 0;
/** A real app device syncing into the fake repository. */
async function appDevice(github, { secret } = {}) {
  const doc = new Y.Doc();
  const store = new DataStore(Y, doc, { idFactory: () => `t${++ids}` });
  store.createTask("Writing");
  const sync = new GitHubSync({
    Y,
    doc,
    storage: memoryStorage(),
    fetch: github.fetch,
    autoSchedule: false,
  });
  if (secret) sync.joinFromHash(`#github=${REPO}&secret=${secret}`);
  await sync.connect({ repo: REPO, token: TOKEN });
  return sync;
}

/** Two good devices plus one stray file written under another key. */
async function scenario() {
  const github = new FakeGitHub();
  const a = await appDevice(github);
  const link = a.link("https://example.org/");
  const b = new GitHubSync({
    Y,
    doc: new Y.Doc(),
    storage: memoryStorage(),
    fetch: github.fetch,
    autoSchedule: false,
  });
  b.joinFromHash(link.slice(link.indexOf("#")));
  await b.connect({ repo: REPO, token: TOKEN });
  await appDevice(new FakeGitHubSharing(github), { secret: "z".repeat(22) });
  return { github, link, names: [...github.files.keys()] };
}

// The stray device talks to the same files but encrypts with a different key.
function FakeGitHubSharing(github) {
  return { fetch: github.fetch };
}

function runCli(args, { github, env = {}, answers = [] } = {}) {
  let output = "";
  const prompts = [];
  return run({
    argv: args,
    env: { GITHUB_TOKEN: TOKEN, ...env },
    fetch: github?.fetch,
    stdout: { write: (text) => (output += text) },
    confirm: async (question) => {
      prompts.push(question);
      return answers.shift() ?? "";
    },
  }).then((code) => ({ code, output, prompts }));
}

test("parses arguments and sync links", () => {
  assert.deepEqual(parseArgs(["delete", "me/repo", "0123456789abcdef", "--force"]), {
    command: "delete",
    repo: "me/repo",
    names: ["0123456789abcdef.bin"],
    flags: { force: true },
  });
  assert.throws(() => parseArgs(["list", "--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["list", "what is this"]), /Do not understand/);
  const secret = "s".repeat(22);
  assert.deepEqual(parseLink(`https://x.org/app/#github=me/repo&secret=${secret}`), {
    repo: "me/repo",
    secret,
  });
  assert.equal(parseLink("https://x.org/#github=bad&secret=short"), null);
  assert.equal(parseLink(""), null);
});

test("needs a token, a repository and a recognised command", async () => {
  assert.equal((await runCli(["list", REPO], { env: { GITHUB_TOKEN: "" } })).code, 2);
  assert.equal((await runCli(["list"])).code, 2);
  const unknown = await runCli(["frobnicate", REPO]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.output, /Unknown command/);
  assert.equal((await runCli(["--help"])).code, 0);
});

test("list shows every device file with size, date and readability", async () => {
  const { github, link, names } = await scenario();
  const result = await runCli(["list", REPO], { github, env: { ETT_SYNC_LINK: link } });
  assert.equal(result.code, 0);
  assert.match(result.output, /3 device files/);
  for (const name of names) assert.ok(result.output.includes(name), name);
  assert.equal((result.output.match(/ readable/g) || []).length, 2);
  assert.equal((result.output.match(/UNREADABLE/g) || []).length, 1);
  assert.match(result.output, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test("list without the link works but cannot tell what is readable", async () => {
  const { github } = await scenario();
  const result = await runCli(["list", REPO], { github });
  assert.equal(result.code, 0);
  assert.match(result.output, /not checked/);
  assert.match(result.output, /ETT_SYNC_LINK/);
});

test("list of a repository with no device files says so", async () => {
  const result = await runCli(["list", REPO], { github: new FakeGitHub() });
  assert.equal(result.code, 0);
  assert.match(result.output, /0 device files/);
});

test("bad tokens and unknown repositories give a plain error", async () => {
  const github = new FakeGitHub();
  github.token = "github_pat_" + "q".repeat(30);
  const rejected = await runCli(["list", REPO], { github });
  assert.equal(rejected.code, 1);
  assert.match(rejected.output, /rejected the access token/);
  const link = `https://x.org/#github=me/other&secret=${"s".repeat(22)}`;
  const mismatch = await runCli(["list", REPO], {
    github: new FakeGitHub(),
    env: { ETT_SYNC_LINK: link },
  });
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.output, /for me\/other, not me\/squirrel-data/);
});

test("--unreadable removes only files that cannot be decrypted, after confirmation", async () => {
  const { github, link, names } = await scenario();
  const before = new Set(names);
  const env = { ETT_SYNC_LINK: link };

  const declined = await runCli(["delete", REPO, "--unreadable"], {
    github,
    env,
    answers: ["wrong/repo"],
  });
  assert.equal(declined.code, 1);
  assert.match(declined.output, /Not confirmed/);
  assert.equal(github.files.size, 3);

  const done = await runCli(["delete", REPO, "--unreadable"], {
    github,
    env,
    answers: [REPO],
  });
  assert.equal(done.code, 0);
  assert.equal(github.files.size, 2);
  assert.equal(done.prompts.length, 1);
  const gone = [...before].filter((name) => !github.files.has(name));
  assert.equal(gone.length, 1);
  assert.ok(done.output.includes(`deleted ${gone[0]}`));
  // What is left is still readable by the devices that own it.
  const after = await runCli(["list", REPO], { github, env });
  assert.equal((after.output.match(/UNREADABLE/g) || []).length, 0);
});

test("readable device files need --force, and without the link every file does", async () => {
  const { github, link, names } = await scenario();
  const env = { ETT_SYNC_LINK: link };
  const readable = (await runCli(["list", REPO], { github, env })).output
    .split("\n")
    .find((line) => line.includes(" readable"))
    .trim()
    .split(" ")[0];
  assert.ok(names.includes(readable));

  const refused = await runCli(["delete", REPO, readable, "--yes"], { github, env });
  assert.equal(refused.code, 1);
  assert.match(refused.output, /Refusing to delete/);
  assert.equal(github.files.size, 3);

  const blind = await runCli(["delete", REPO, readable, "--yes"], { github });
  assert.equal(blind.code, 1, "unknown readability counts as risky");

  const forced = await runCli(["delete", REPO, readable, "--yes", "--force"], {
    github,
    env,
  });
  assert.equal(forced.code, 0);
  assert.equal(github.files.size, 2);
});

test("--dry-run changes nothing, and --yes skips the question", async () => {
  const { github, link } = await scenario();
  const env = { ETT_SYNC_LINK: link };
  const dry = await runCli(["delete", REPO, "--unreadable", "--dry-run"], {
    github,
    env,
  });
  assert.equal(dry.code, 0);
  assert.match(dry.output, /Dry run/);
  assert.equal(github.files.size, 3);
  assert.equal(dry.prompts.length, 0);

  const yes = await runCli(["delete", REPO, "--unreadable", "--yes"], { github, env });
  assert.equal(yes.code, 0);
  assert.equal(yes.prompts.length, 0);
  assert.equal(github.files.size, 2);
});

test("misuse of delete is explained and deletes nothing", async () => {
  const { github, link } = await scenario();
  const needsLink = await runCli(["delete", REPO, "--unreadable"], { github });
  assert.equal(needsLink.code, 2);
  assert.match(needsLink.output, /needs ETT_SYNC_LINK/);

  const missing = await runCli(["delete", REPO, "ffffffffffffffff.bin", "--yes"], {
    github,
    env: { ETT_SYNC_LINK: link },
  });
  assert.equal(missing.code, 1);
  assert.match(missing.output, /not in me\/squirrel-data/);

  const nothing = await runCli(["delete", REPO, "--unreadable", "--yes"], {
    github: new FakeGitHub(),
    env: { ETT_SYNC_LINK: link },
  });
  assert.equal(nothing.code, 0);
  assert.match(nothing.output, /Nothing to delete/);
  assert.equal(github.files.size, 3);
});

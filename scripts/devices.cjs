#!/usr/bin/env node
// List and clean up the per-device files in a Squirrel Tracks sync repository.
//
//   export GITHUB_TOKEN=github_pat_...        # fine-grained token, Contents read/write on the repo
//   export ETT_SYNC_LINK='https://.../#github=owner/name&secret=...'   # optional, enables readability checks
//   npm run devices -- list owner/name
//   npm run devices -- delete owner/name 0123456789abcdef.bin
//   npm run devices -- delete owner/name --unreadable
//
// The token comes from the environment, never from an argument, so it stays out of shell history.

const GitHubSync = require("../web-frontend/js/github-sync.js");
const { webcrypto } = require("node:crypto");

const USAGE = `Usage:
  npm run devices -- list   [owner/name]
  npm run devices -- delete [owner/name] <file.bin>... | --unreadable   [--yes] [--force] [--dry-run]

Environment:
  GITHUB_TOKEN    required. A token with Contents read/write on the repository.
  ETT_SYNC_LINK   optional. The sync link from the app (Advanced -> Sync with GitHub -> Copy link).
                  It carries the repository and encryption key, so the tool can tell which device
                  files are readable. Without it, nothing can be identified as unreadable.

delete:
  Files that cannot be decrypted (a different key, or tampered with) can be deleted freely.
  A readable file holds a device's data that other devices may not have merged yet, so deleting
  it needs --force. --dry-run shows what would happen. --yes skips the typed confirmation.`;

const FILE_NAME = /^[0-9a-f]{16}\.bin$/;

function parseArgs(argv) {
  const parsed = { command: null, repo: null, names: [], flags: {} };
  const flagNames = {
    "--yes": "yes",
    "--force": "force",
    "--unreadable": "unreadable",
    "--dry-run": "dryRun",
    "--help": "help",
    "-h": "help",
  };
  for (const arg of argv) {
    if (flagNames[arg]) parsed.flags[flagNames[arg]] = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (!parsed.command) parsed.command = arg;
    else if (GitHubSync.validRepo(arg) && !FILE_NAME.test(arg) && !parsed.repo)
      parsed.repo = arg;
    else if (FILE_NAME.test(arg) || /^[0-9a-f]{16}$/.test(arg))
      parsed.names.push(arg.endsWith(".bin") ? arg : `${arg}.bin`);
    else throw new Error(`Do not understand "${arg}".`);
  }
  return parsed;
}

function parseLink(text) {
  if (!text) return null;
  const hash = text.includes("#") ? text.slice(text.indexOf("#")) : text;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const repo = params.get("github");
  const secret = params.get("secret");
  if (!GitHubSync.validRepo(repo) || !/^[A-Za-z0-9_-]{16,}$/.test(secret || ""))
    return null;
  return { repo, secret };
}

/** A GitHubSync used only for its API calls and decryption; it never syncs a document. */
function makeClient({ repo, token, secret, fetch }) {
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
  storage.setItem(
    GitHubSync.STORAGE_KEY,
    JSON.stringify({
      repo,
      token,
      secret: secret || "x".repeat(22),
      deviceId: "0".repeat(16),
    }),
  );
  return new GitHubSync({
    Y: null,
    doc: null,
    storage,
    fetch,
    subtle: webcrypto.subtle,
    randomBytes: (count) => webcrypto.getRandomValues(new Uint8Array(count)),
    autoSchedule: false,
  });
}

async function listDevices(client, repo, canCheck) {
  const dir = `/repos/${repo}/contents/${GitHubSync.DIR}`;
  const response = await client.request("GET", dir);
  if (response.status === 404) return [];
  if (!response.ok) throw client.errorFor(response, "list the device files");
  const files = (await response.json()).filter(
    (file) => file.type === "file" && FILE_NAME.test(file.name),
  );
  const devices = [];
  for (const file of files) {
    const device = {
      name: file.name,
      sha: file.sha,
      size: file.size,
      date: null,
      readable: null,
    };
    const commits = await client.request(
      "GET",
      `/repos/${repo}/commits?path=${encodeURIComponent(`${GitHubSync.DIR}/${file.name}`)}&per_page=1`,
    );
    if (commits.ok)
      device.date = (await commits.json())[0]?.commit?.committer?.date || null;
    if (canCheck) {
      const content = await client.request("GET", `${dir}/${file.name}`, { raw: true });
      if (!content.ok) throw client.errorFor(content, "download a device file");
      try {
        await client.decrypt(new Uint8Array(await content.arrayBuffer()));
        device.readable = true;
      } catch {
        device.readable = false;
      }
    }
    devices.push(device);
  }
  return devices;
}

function describe(device, canCheck) {
  const kb = `${(device.size / 1024).toFixed(1)} KB`.padStart(9);
  const when = (device.date || "unknown").replace("T", " ").slice(0, 16).padEnd(16);
  const status = !canCheck
    ? "not checked"
    : device.readable
      ? "readable"
      : "UNREADABLE (different key or damaged)";
  return `  ${device.name}  ${kb}  ${when}  ${status}`;
}

async function run({
  argv,
  env = process.env,
  fetch = globalThis.fetch,
  stdout = process.stdout,
  confirm = async () => "",
}) {
  const out = (line = "") => stdout.write(`${line}\n`);
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    out(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.flags.help || !args.command) {
    out(USAGE);
    return args.flags.help ? 0 : 2;
  }
  if (!["list", "delete"].includes(args.command)) {
    out(`Unknown command "${args.command}".\n\n${USAGE}`);
    return 2;
  }
  const token = env.GITHUB_TOKEN;
  if (!GitHubSync.validToken(token)) {
    out(
      "Set GITHUB_TOKEN to an access token with Contents read/write on the repository.",
    );
    return 2;
  }
  const link = parseLink(env.ETT_SYNC_LINK);
  if (env.ETT_SYNC_LINK && !link) {
    out(
      "ETT_SYNC_LINK is not a valid sync link (expected ...#github=owner/name&secret=...).",
    );
    return 2;
  }
  const repo = args.repo || link?.repo;
  if (!repo) {
    out("Say which repository: add owner/name, or set ETT_SYNC_LINK.");
    return 2;
  }
  if (link && link.repo !== repo) {
    out(
      `ETT_SYNC_LINK is for ${link.repo}, not ${repo}. Its key would not match this repository.`,
    );
    return 2;
  }
  const canCheck = Boolean(link);
  const client = makeClient({ repo, token, secret: link?.secret, fetch });

  try {
    const devices = await listDevices(client, repo, canCheck);
    if (args.command === "list") {
      out(`${repo}: ${devices.length} device file${devices.length === 1 ? "" : "s"}`);
      devices.forEach((device) => out(describe(device, canCheck)));
      if (!canCheck && devices.length)
        out("\nSet ETT_SYNC_LINK to see which files are readable.");
      return 0;
    }

    // delete
    if (args.flags.unreadable && !canCheck) {
      out("--unreadable needs ETT_SYNC_LINK, to know which files cannot be read.");
      return 2;
    }
    const targets = new Map();
    for (const name of args.names) {
      const device = devices.find((entry) => entry.name === name);
      if (!device) {
        out(`${name} is not in ${repo}. Nothing was deleted.`);
        return 1;
      }
      targets.set(name, device);
    }
    if (args.flags.unreadable)
      devices
        .filter((device) => device.readable === false)
        .forEach((d) => targets.set(d.name, d));
    if (!targets.size) {
      out("Nothing to delete. Name a file, or use --unreadable.");
      return args.names.length || args.flags.unreadable ? 0 : 2;
    }
    const risky = [...targets.values()].filter((device) => device.readable !== false);
    if (risky.length && !args.flags.force) {
      out("Refusing to delete files that may hold data no other device has merged yet:");
      risky.forEach((device) => out(describe(device, canCheck)));
      out("\nMake sure every device has synced, then add --force.");
      return 1;
    }
    out(`Will delete from ${repo}:`);
    targets.forEach((device) => out(describe(device, canCheck)));
    if (args.flags.dryRun) {
      out("\nDry run: nothing was deleted.");
      return 0;
    }
    if (!args.flags.yes) {
      const typed = await confirm(`\nType the repository name (${repo}) to confirm: `);
      if (String(typed).trim() !== repo) {
        out("Not confirmed. Nothing was deleted.");
        return 1;
      }
    }
    for (const device of targets.values()) {
      const response = await client.request(
        "DELETE",
        `/repos/${repo}/contents/${GitHubSync.DIR}/${device.name}`,
        {
          body: {
            message: `Remove device file ${device.name.slice(0, 8)}`,
            sha: device.sha,
          },
        },
      );
      if (!response.ok) throw client.errorFor(response, `delete ${device.name}`);
      out(`  deleted ${device.name}`);
    }
    return 0;
  } catch (error) {
    out(`Error: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  const readline = require("node:readline");
  const confirm = (question) =>
    process.stdin.isTTY
      ? new Promise((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
          });
        })
      : Promise.resolve("");
  run({ argv: process.argv.slice(2), confirm }).then((code) => process.exit(code));
}

module.exports = { run, parseArgs, parseLink };

// An in-memory stand-in for the slice of GitHub's REST API that the app and scripts use.
// Shared by web-frontend/js/github-sync.test.cjs and scripts/devices.test.cjs.

const TOKEN = "github_pat_" + "a".repeat(30);
const REPO = "me/squirrel-data";

class FakeGitHub {
  constructor({ repo = REPO, isPrivate = true, push = true } = {}) {
    Object.assign(this, { repo, isPrivate, push, files: new Map(), version: 0, shas: 0 });
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
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method || "GET";
    const headers = init.headers || {};
    this.calls.push({
      method,
      path,
      etag: headers["If-None-Match"],
      raw: /raw/.test(headers.Accept),
    });
    if (headers.Authorization !== `Bearer ${this.token}`) return this.json(401, {});
    if (this.rateLimited) return this.json(403, {}, { "X-RateLimit-Remaining": "0" });
    if (path === `/repos/${this.repo}`)
      return this.json(200, {
        private: this.isPrivate,
        permissions: { push: this.push },
      });
    if (path === `/repos/${this.repo}/commits`) {
      const file = this.files.get(
        String(parsed.searchParams.get("path")).split("/").pop(),
      );
      return this.json(200, file ? [{ commit: { committer: { date: file.date } } }] : []);
    }
    const dir = `/repos/${this.repo}/contents/devices`;
    if (path === dir && method === "GET") {
      if (!this.files.size) return this.json(404, { message: "Not Found" });
      const etag = `"v${this.version}"`;
      if (headers["If-None-Match"] === etag) return new Response(null, { status: 304 });
      const list = [...this.files].map(([name, file]) => ({
        name,
        type: "file",
        sha: file.sha,
        size: file.bytes.length,
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
        this.files.set(name, {
          sha,
          bytes: Buffer.from(body.content, "base64"),
          date: new Date().toISOString(),
        });
        this.version++;
        return this.json(file ? 200 : 201, { content: { sha } });
      }
      if (method === "DELETE") {
        const body = JSON.parse(init.body);
        if (!file) return this.json(404, { message: "Not Found" });
        if (body.sha !== file.sha) return this.json(409, { message: "sha mismatch" });
        this.files.delete(name);
        this.version++;
        return this.json(200, { commit: { sha: `commit${++this.shas}` } });
      }
    }
    return this.json(404, {});
  }

  count(method, pattern) {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path)).length;
  }
}

module.exports = { FakeGitHub, TOKEN, REPO };

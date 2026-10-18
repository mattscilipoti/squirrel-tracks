const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function client() {
  const context = vm.createContext({
    URLSearchParams,
    localStorage: { getItem: () => null },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "supabase-client.js"), "utf8") +
      '\nglobalThis.client = new SupabaseClient("https://example.supabase.co", "sb_publishable_test");',
    context,
  );
  return context.client;
}

test("sessions load global tasks through daily memberships", async () => {
  const db = client();
  db.request = async (method, route) => {
    assert.equal(method, "GET");
    assert.match(decodeURIComponent(route), /session_tasks\(task:tasks\(\*\)\)/);
    return [{ id: 1, session_tasks: [{ task: { id: 5, name: "Shared" } }] }];
  };
  const session = await db.getSession(1);
  assert.equal(session.tasks[0].id, 5);
  assert.equal((await db.getSessionsForDate("2026-10-16"))[0].tasks[0].name, "Shared");
});

test("creating a task attaches its stable ID without single-day ownership", async () => {
  const db = client();
  const calls = [];
  db.request = async (method, route, data) => {
    calls.push({ method, route, data });
    return route === "/tasks" ? [{ id: 5, name: data.name }] : [];
  };
  const task = await db.createTask(2, { name: "Shared" });
  assert.equal(task.id, 5);
  assert.equal(calls[0].data.session_id, undefined);
  assert.equal(calls[1].data.session_id, 2);
  assert.equal(calls[1].data.task_id, 5);
});

test("renaming is global and removing a task is day-specific", async () => {
  const db = client();
  const calls = [];
  db.request = async (method, route) => {
    calls.push({ method, route });
  };
  await db.updateTask(2, 5, { name: "Renamed" });
  await db.deleteTask(2, 5);
  assert.deepEqual(calls, [
    { method: "PATCH", route: "/tasks?id=eq.5" },
    { method: "DELETE", route: "/session_tasks?task_id=eq.5&session_id=eq.2" },
  ]);
});

test("catalog reads paginate rather than truncating reusable tasks", async () => {
  const db = client();
  let requests = 0;
  db.request = async (method, route) => {
    requests++;
    const params = new URL(route, "https://example.supabase.co").searchParams;
    return params.get("offset") === "0"
      ? Array.from({ length: 1000 }, (_, id) => ({ id }))
      : [{ id: 1000 }];
  };
  assert.equal((await db.getTaskCatalog()).length, 1001);
  assert.equal(requests, 2);
});

test("publishable key is not used as an Authorization bearer token", () => {
  const db = client();
  assert.equal(db.headers.apikey, "sb_publishable_test");
  assert.equal("Authorization" in db.headers, false);
  assert.equal(db.isAuthenticated(), false);
});

test("authenticated requests use only the user access token as bearer", () => {
  const db = client();
  db.setAccessToken("user-access-token");
  assert.equal(db.headers.apikey, "sb_publishable_test");
  assert.equal(db.headers.Authorization, "Bearer user-access-token");
  assert.equal(db.isAuthenticated(), true);
  db.setAccessToken(null);
  assert.equal("Authorization" in db.headers, false);
});

test("project configuration is optional and requires a publishable key", () => {
  const source = fs.readFileSync(path.join(__dirname, "supabase-client.js"), "utf8");
  const missingConfig = vm.createContext({ localStorage: { getItem: () => null } });
  vm.runInContext(source, missingConfig);
  assert.equal(vm.runInContext("hasSupabaseConfig()", missingConfig), false);
  assert.equal(vm.runInContext("getSupabaseClient()", missingConfig), null);

  const configured = vm.createContext({
    URL,
    localStorage: { getItem: () => null },
  });
  vm.runInContext("globalThis.window = globalThis", configured);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "config.js"), "utf8"), configured);
  vm.runInContext(source, configured);
  assert.equal(vm.runInContext("hasSupabaseConfig()", configured), true);
  assert.equal(
    vm.runInContext("SUPABASE_URL", configured),
    "https://fcofqalmrtbafmmiysow.supabase.co",
  );
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.indexOf("js/config.js") < html.indexOf("js/supabase-client.js"));

  const invalidKey = vm.createContext({
    URL,
    localStorage: { getItem: () => null },
    SUPABASE_CONFIG: {
      url: "https://example.supabase.co",
      publishableKey: "service_role_secret",
    },
  });
  vm.runInContext(source, invalidKey);
  assert.equal(vm.runInContext("hasSupabaseConfig()", invalidKey), false);
});

test("auth sessions are stored under a project-specific localStorage key", () => {
  const stored = new Map();
  const context = vm.createContext({
    URL,
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "supabase-client.js"), "utf8") +
      "\nglobalThis.Auth = SupabaseAuth;",
    context,
  );
  const first = new context.Auth("https://one.supabase.co", "sb_publishable_one");
  const second = new context.Auth("https://two.supabase.co", "sb_publishable_two");
  first._saveSession({
    access_token: "one-token",
    refresh_token: "one-refresh",
    expires_in: 60,
  });
  second._saveSession({
    access_token: "two-token",
    refresh_token: "two-refresh",
    expires_in: 60,
  });
  assert.equal(first.getSession().access_token, "one-token");
  assert.equal(second.getSession().access_token, "two-token");
  assert.equal(stored.size, 2);
});

test("a rejected cloud request reports unreachable even when browser online state is unknown", async () => {
  const connectivity = [];
  const context = vm.createContext({
    URLSearchParams,
    localStorage: { getItem: () => null },
    window: { dispatchEvent: (event) => connectivity.push(event.detail) },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    fetch: async () => {
      throw new Error("network unavailable");
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "supabase-client.js"), "utf8") +
      '\nglobalThis.db = new SupabaseClient("https://example.supabase.co", "sb_publishable_test");',
    context,
  );

  await assert.rejects(context.db.request("GET", "/sessions"), /network unavailable/);
  assert.deepEqual(connectivity, [false]);
});

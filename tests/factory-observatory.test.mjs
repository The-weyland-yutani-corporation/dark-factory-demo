import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkedState,
  detailEntities,
  normalize,
  reconcile,
  related,
  replay,
  safeUrl,
  validateAction,
} from "../.github/extensions/factory-observatory/model.mjs";
import {
  GitHubReader,
  jsonFile,
  live,
  loadLocal,
  localPolicy,
  resolveReplay,
  selected,
} from "../.github/extensions/factory-observatory/sources.mjs";
import {
  createProvider,
  startServer,
} from "../.github/extensions/factory-observatory/host.mjs";

const root = process.cwd(),
  repository = "owner/factory",
  sha = "a".repeat(40);
const control = await localPolicy(root);
const policy = {
  ...control.meta,
  transitions: control.control.lifecycle.goal.transitions,
};
const report = {
  schemaVersion: 1,
  mode: "local-simulation",
  liveServicesCalled: [],
  scenarios: [
    {
      id: "example",
      title: "Offline only",
      liveMutation: false,
      transitions: [{ from: "state:submitted", to: "state:planned" }],
    },
  ],
};
const pull = {
  number: 2,
  title: "PR",
  state: "open",
  head: { sha },
  body: "Fixes #1",
};
const raw = {
  issues: [
    {
      number: 1,
      title: "Goal",
      state: "open",
      labels: [{ name: "type:goal" }, { name: "state:implementing" }],
    },
  ],
  pulls: [pull],
};
const response = (body, headers = "") => ({
  stdout: `HTTP/2.0 200 OK\n${headers}\n\n${JSON.stringify(body)}`,
});
let directory, close;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "factory-observatory-"));
  close = [];
});
afterEach(async () => {
  for (const dispose of close) await dispose();
  await rm(directory, { recursive: true, force: true });
});
const observe = () => normalize(structuredClone(raw), repository, control.meta);

it("preserves identities and relationships without inventing initial history or stale success", () => {
  const first = reconcile(observe());
  expect(first.entities[0]).toMatchObject({ phase: 2, activity: "unknown" });
  expect(first.events).toEqual([]);
  expect(related(first, "issue:1")).toEqual(["issue:1", "pr:2"]);
  const next = observe();
  next.entities[0].native = "state:review";
  expect(reconcile(next, first).events).toHaveLength(1);
  expect(reconcile(observe(), first).events).toHaveLength(0);
  const changed = structuredClone(raw);
  changed.issues[0].labels = [];
  changed.pulls[0].state = "closed";
  const unknown = normalize(changed, repository, control.meta);
  expect(unknown.entities.map((e) => [e.id, e.phase, e.activity])).toEqual([
    ["issue:1", null, "unknown"],
    ["pr:2", null, "unknown"],
  ]);
  const stale = detailEntities(
    pull,
    [{ id: 1, head_sha: "b".repeat(40), conclusion: "success" }],
    [{ id: 2, commit_id: sha, state: "APPROVED" }],
    repository,
  );
  expect(stale.map((e) => e.activity)).toEqual(["unknown", "succeeded"]);
  expect(stale[1].detail).toContain("independence is not certified");
});

it("validates actions, bounded replay, persisted controls and evidence URLs", async () => {
  expect(() => validateAction("refresh", { dispatch: true })).toThrow();
  const snapshot = replay(report, repository, policy);
  expect(snapshot.events[0]).toMatchObject({ at: null, observedAt: null });
  expect(() =>
    replay({ ...report, liveServicesCalled: ["github"] }, repository, policy),
  ).toThrow();
  expect(() =>
    checkedState({ snapshot, selectedId: null, position: 2, error: null }),
  ).toThrow();
  for (const url of [
    "javascript:alert(1)",
    "https://github.com/elsewhere/repo",
    "https://github.com:444/owner/factory",
    "https://github.com/owner/factory?token=secret",
  ])
    expect(safeUrl(url, repository)).toBeNull();
  const file = join(directory, "report.json");
  await writeFile(file, JSON.stringify(report));
  expect(await resolveReplay(file, root, directory)).toBe(file);
  await expect(
    resolveReplay(join(root, "package.json"), root, directory),
  ).rejects.toThrow("Replay must");
});

it("limits reads, concurrency, cancellation and executable arguments", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const controller = new AbortController();
  const execute = async (command, args, options) => {
    expect(command).toBe("gh");
    expect(args.slice(0, 6)).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "--include",
    ]);
    expect(options.signal).toBe(controller.signal);
    peak = Math.max(peak, ++active);
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return response([], 'Link: <next>; rel="next"');
  };
  const reader = new GitHubReader(repository, controller.signal, 5, execute);
  await Promise.all(
    Array.from({ length: 5 }, () => reader.get("/issues?per_page=100")),
  );
  expect([calls, peak, reader.notes.length]).toEqual([5, 2, 5]);
  await expect(reader.get("/issues")).rejects.toThrow("budget");
  await expect(reader.get("/issues/1/lock")).rejects.toThrow("route");
  controller.abort();
  await expect(
    new GitHubReader(repository, controller.signal, 5, execute).get("/issues"),
  ).rejects.toThrow("cancelled");
});

it("respects rate-limit resets and exposes auth and timeout failures", async () => {
  const failure = (detail) => async () => {
    throw Object.assign(new Error("failed"), detail);
  };
  const limited = new GitHubReader(
    "rate/limited",
    null,
    20,
    failure({ stderr: "HTTP 429", stdout: "Retry-After: 120" }),
  );
  await expect(limited.get("/issues")).rejects.toThrow("rate limit");
  await expect(limited.get("/issues")).rejects.toThrow("retry after");
  for (const [detail, message] of [
    [{ stderr: "HTTP 403" }, "permission"],
    [{ killed: true }, "timed out"],
    [{ code: "ENOENT" }, "unavailable"],
  ]) {
    await expect(
      new GitHubReader(repository, null, 20, failure(detail)).get("/issues"),
    ).rejects.toThrow(message);
  }
});

it("keeps failed collections stale and detects a changing PR head", async () => {
  const schema = await jsonFile(
    join(root, ".github", "autonomy", "policy.schema.json"),
  );
  const execute = async (_command, args) => {
    const path = args.at(-1).split("?")[0];
    if (path.endsWith("/commits")) return response([{ sha }]);
    if (path.includes("/contents/"))
      return response({
        content: Buffer.from(
          JSON.stringify(
            path.endsWith("schema.json") ? schema : control.control,
          ),
        ).toString("base64"),
      });
    if (path.endsWith("/issues")) return response({ malformed: true });
    if (path.endsWith("/pulls")) return response([pull]);
    if (path.endsWith("/workflows")) return response({ workflows: [] });
    if (path.endsWith("/runs")) return response({ workflow_runs: [] });
    if (path.endsWith("/deployments")) return response([]);
    return response({ full_name: repository, default_branch: "main" });
  };
  const partial = await live(repository, null, observe(), execute);
  expect(partial.entities.find((e) => e.id === "issue:1").activity).toBe(
    "unknown",
  );
  expect(partial.notes.join(" ")).toContain("Unavailable issues");
  let reads = 0;
  await expect(
    selected(observe(), "pr:2", null, async (_command, args) => {
      if (args.at(-1).endsWith("/pulls/2"))
        return response({
          ...pull,
          head: { sha: ++reads === 1 ? sha : "b".repeat(40) },
        });
      return response(
        args.at(-1).includes("check-runs") ? { check_runs: [] } : [],
      );
    }),
  ).rejects.toThrow("head changed");
});

it("coalesces refresh, cancels hidden reads, isolates sources and persists new panels", async () => {
  let reads = 0,
    signal;
  const adapter = async (_repository, value) => {
    signal = value;
    reads++;
    return observe();
  };
  const provider = await createProvider(root, directory, () => {}, {
    repository,
    live: adapter,
  });
  const client = await provider.attach({ mode: "live" });
  close.push(client.close);
  await client.action("set_visibility", { visible: true });
  await Promise.all([client.action("refresh"), client.action("refresh")]);
  expect(reads).toBe(1);
  await client.action("select_source", { mode: "synthetic" });
  expect((await client.action("get_snapshot")).snapshot.mode).toBe("synthetic");
  const second = await (
    await createProvider(root, directory, () => {}, { repository })
  ).attach({ mode: "live" });
  close.push(second.close);
  expect((await second.action("get_snapshot")).snapshot.entities).toHaveLength(
    2,
  );
  const hanging = await createProvider(
    root,
    join(directory, "pending"),
    () => {},
    {
      repository,
      live: async (_repo, value) => {
        signal = value;
        await new Promise((resolve, reject) =>
          value.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      },
    },
  );
  const pending = await hanging.attach({ mode: "live" });
  close.push(pending.close);
  const read = pending.action("refresh").catch((error) => error.message);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await pending.action("set_visibility", { visible: false });
  expect(signal.aborted).toBe(true);
  expect(await read).toBe("cancelled");
});

it("keeps queued selection in its source and does not clear read failures with UI actions", async () => {
  let release,
    fail = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const provider = await createProvider(root, directory, () => {}, {
    repository,
    live: async () => {
      await gate;
      if (fail) throw new Error("authentication unavailable");
      return observe();
    },
    selected: async (snapshot) => snapshot,
  });
  const first = await provider.attach({ mode: "live" });
  const other = await provider.attach({ mode: "live" });
  close.push(first.close, other.close);
  await other.action("set_visibility", { visible: true });
  const refresh = first.action("refresh");
  const selection = first.action("select_item", { id: "issue:1" });
  await first.action("select_source", { mode: "synthetic" });
  release();
  await Promise.all([refresh, selection]);
  expect((await first.action("get_snapshot")).snapshot.mode).toBe("synthetic");
  expect((await other.action("get_snapshot")).selectedId).toBe("issue:1");
  fail = true;
  await expect(other.action("refresh")).rejects.toThrow("authentication");
  await other.action("select_item", { id: null });
  expect((await other.action("get_snapshot")).error).toContain(
    "authentication",
  );
});

it("protects loopback routes, body size and capability while serving a valid preview", async () => {
  const provider = await createProvider(root, directory, () => {}, {
    repository,
  });
  const server = await startServer(provider, { mode: "synthetic" });
  close.push(server.close);
  await server.action("refresh");
  const url = new URL(server.url),
    headers = { "x-canvas-key": url.hash.slice(1) };
  const state = new URL("/state", url);
  expect((await fetch(state)).status).toBe(400);
  expect(
    (
      await fetch(state, {
        headers: { ...headers, origin: "https://evil.example" },
      })
    ).status,
  ).toBe(400);
  const result = await fetch(state, { headers });
  expect(result.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  expect((await result.json()).snapshot.entities).toHaveLength(11);
  expect(
    (
      await fetch(new URL("/action", url), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", input: "x".repeat(17000) }),
      })
    ).status,
  ).toBe(413);
  expect(
    (await loadLocal("synthetic", "", root, directory, repository)).mode,
  ).toBe("synthetic");
});

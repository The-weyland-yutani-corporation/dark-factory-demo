import { createRequire } from "node:module";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkedState, digest, empty, goalPhase, reconcile, related, stages, text, validateAction } from "./model.mjs";
import { jsonFile, live, loadLocal, repositoryAt, resolveReplay, selected } from "./sources.mjs";
const Fastify = createRequire(new URL("../../../apps/api/package.json", import.meta.url))("fastify");

export async function createProvider(root, artifacts, log, adapters = {}) {
  artifacts = join(await realpath(dirname(artifacts)), basename(artifacts));
  await mkdir(artifacts, { recursive: true });
  if (await realpath(artifacts) !== artifacts) throw new Error("Artifact cache cannot be a symbolic link");
  const artifactRoot = adapters.artifactRoot ?? artifacts;
  const repository = adapters.repository ?? await repositoryAt(root);
  const stores = new Map();
  async function storeFor(source) {
    validateAction("select_source", source);
    const sourceKey = source.mode === "replay" ? await resolveReplay(source.replayPath, root, artifactRoot) : "";
    const key = digest([repository, source.mode, sourceKey]);
    if (!stores.has(key) && stores.size >= 12) throw new Error("Source cache limit reached for this provider");
    if (!stores.has(key)) stores.set(key, (async () => {
      const file = join(artifacts, `${key}.json`);
      let data = { snapshot: empty(source.mode, repository), selectedId: null, position: 0, error: null };
      try {
        const cached = await jsonFile(file);
        checkedState(cached);
        if (cached.snapshot.mode !== source.mode || cached.snapshot.repository !== repository) throw new Error("Stored canvas source does not match");
        data = cached;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      return {
        source: { mode: source.mode, replayPath: sourceKey }, file, data,
        clients: new Set(), tail: Promise.resolve(),
        refresh: null, controller: null, lastRequest: 0,
      };
    })());
    return stores.get(key);
  }
  async function save(store) {
    await writeFile(`${store.file}.tmp`, JSON.stringify(store.data), { mode: 0o600 });
    await rename(`${store.file}.tmp`, store.file);
  }
  function view(store) {
    const data = structuredClone(store.data);
    if (data.snapshot.mode === "replay") for (const event of data.snapshot.events.slice(0, data.position)) {
      const item = data.snapshot.entities.find(e => e.id === event.entityId);
      item.phase = goalPhase(event.detail);
      item.native = event.detail;
      item.activity = event.detail === "state:terminal" ? "terminal" : event.detail === "state:completed" ? "succeeded" : "queued";
    }
    return { ...data, source: store.source, stages, relatedIds: related(data.snapshot, data.selectedId), busy: !!store.refresh };
  }
  function queue(store, work) {
    const result = store.tail.then(async () => {
      store.controller = new AbortController();
      try {
        if (!store.clients.size) throw new Error("Observation cancelled: no connected canvas");
        await work(store.controller.signal);
        await save(store);
        return view(store);
      } catch (error) {
        store.data.error = text(error.message);
        await save(store);
        await log(store.data.error);
        throw error;
      } finally { store.controller = null; }
    });
    // The caller receives failures; the mutex itself must remain reusable.
    store.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async function refresh(store, manual) {
    if (store.refresh) return store.refresh;
    if (!manual && (Date.now() - store.lastRequest < 60000 || /rate limit/i.test([store.data.error, ...store.data.snapshot.notes].join(" ")))) return view(store);
    store.lastRequest = Date.now();
    store.refresh = queue(store, async signal => {
      if (!manual && ![...store.clients].some(c => c.visible)) return;
      const prior = store.data.snapshot;
      const next = store.source.mode === "live"
        ? await (adapters.live ?? live)(repository, signal, prior)
        : await loadLocal(store.source.mode, store.source.replayPath, root, artifactRoot, repository);
      store.data.snapshot = reconcile(next, prior);
      store.data.error = null;
      store.data.position = Math.min(store.data.position, next.events.length);
      if (!next.entities.some(e => e.id === store.data.selectedId)) store.data.selectedId = null;
    });
    store.refresh = store.refresh.then(data => ({ ...data, busy: false })).finally(() => { store.refresh = null; });
    return store.refresh;
  }
  return {
    async attach(source) {
      let store = await storeFor(source);
      let generation = 0;
      const client = { visible: false };
      store.clients.add(client);
      const suspend = current => { if (![...current.clients].some(c => c.visible)) current.controller?.abort(); };
      const detach = () => { store.clients.delete(client); suspend(store); };
      return {
        async action(name, input = {}) {
          validateAction(name, input);
          const current = store;
          if (name === "set_visibility") {
            client.visible = input.visible;
            suspend(current);
            return view(current);
          }
          if (name === "select_source") {
            const ticket = ++generation;
            const next = await storeFor(input);
            if (ticket !== generation) return view(store);
            if (next === store) return refresh(store, true);
            detach();
            store = next;
            store.clients.add(client);
            return refresh(store, true);
          }
          if (name === "refresh") return input.manual === false && !client.visible ? view(current) : refresh(current, input.manual ?? true);
          if (name === "select_item") return queue(current, async signal => {
            if (input.id && !current.data.snapshot.entities.some(e => e.id === input.id)) throw new Error("Item is not in this snapshot");
            current.data.selectedId = input.id;
            if (input.id && current.source.mode === "live") {
              for (const e of current.data.snapshot.entities) if (["check", "review"].includes(e.kind) && e.refs.includes(input.id)) {
                e.activity = "unknown";
                e.detail = "Stale / unverified exact-head evidence. Select the PR to reload.";
              }
              const next = await (adapters.selected ?? selected)(structuredClone(current.data.snapshot), input.id, signal);
              current.data.snapshot = reconcile(next, current.data.snapshot);
            }
          });
          if (name === "set_replay") return queue(current, async () => {
            if (current.source.mode !== "replay" || input.position > current.data.snapshot.events.length) throw new Error("Replay position is out of range");
            current.data.position = input.position;
          });
          return view(store);
        },
        close: async () => { generation++; detach(); await store.tail; },
      };
    },
  };
}
export async function startServer(provider, source) {
  const client = await provider.attach(source);
  const key = randomBytes(32).toString("hex");
  const assets = new Map([["/", ["ui.html", "text/html"]], ["/ui.mjs", ["ui.mjs", "text/javascript"]], ["/ui.css", ["ui.css", "text/css"]]]);
  const directory = dirname(fileURLToPath(import.meta.url));
  const app = Fastify({ bodyLimit: 16384, logger: false, forceCloseConnections: true });
  let origin;
  app.addHook("onRequest", async (req, reply) => {
    reply.headers({
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
    });
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) throw new Error("Untrusted request origin");
    if (!assets.has(req.url)) {
      const supplied = Buffer.from(String(req.headers["x-canvas-key"] ?? ""));
      if (supplied.length !== key.length || !timingSafeEqual(supplied, Buffer.from(key))) throw new Error("Invalid canvas capability");
    }
  });
  for (const [path, [file, type]] of assets) app.get(path, async (_req, reply) => reply.type(type).send(await readFile(join(directory, file))));
  app.get("/state", () => client.action("get_snapshot"));
  app.post("/action", req => client.action(req.body.action, req.body.input));
  app.setErrorHandler((error, _req, reply) => reply.code(error.statusCode ?? 400).send({ error: text(error.message) }));
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
  return { url: `${origin}/#${key}`, action: client.action, close: async () => { await client.close(); await app.close(); } };
}

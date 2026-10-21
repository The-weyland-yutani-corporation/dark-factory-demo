import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { actionSchemas, sourceSchema } from "./model.mjs";
import { createProvider, startServer } from "./host.mjs";
import { inside } from "./sources.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const instances = new Map();
let provider;
const session = await joinSession({
  canvases: [createCanvas({
    id: "factory-observatory",
    displayName: "Factory Observatory",
    description: "Explore read-only GitHub factory flow, linked evidence, synthetic examples, and offline replay.",
    inputSchema: sourceSchema,
    actions: Object.entries(actionSchemas).map(([name, inputSchema]) => ({
      name, inputSchema, description: `Factory observation/UI action: ${name}`,
      handler: async ctx => {
        const instance = instances.get(ctx.instanceId);
        if (!instance) throw new CanvasError("canvas_not_open", "Open the Factory Observatory first");
        try { return await instance.action(name, ctx.input ?? {}); }
        catch (error) { throw new CanvasError("observation_error", error.message); }
      },
    })),
    open: async ctx => {
      if (!provider) {
        const storage = session.workspacePath && await realpath(session.workspacePath);
        if (!storage || inside(await realpath(root), storage)) throw new CanvasError("artifact_workspace_missing", "A session artifact workspace outside the repository is required");
        provider = await createProvider(root, join(storage, "factory-observatory"),
          message => session.log(message, { level: "error" }), { artifactRoot: storage });
      }
      if (!instances.has(ctx.instanceId)) instances.set(ctx.instanceId, await startServer(provider, ctx.input));
      return { title: "Factory Observatory", url: instances.get(ctx.instanceId).url };
    },
    onClose: async ctx => {
      const instance = instances.get(ctx.instanceId);
      instances.delete(ctx.instanceId);
      await instance?.close();
    },
  })],
});

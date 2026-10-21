// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { axe } from "jest-axe";
import { stages } from "../.github/extensions/factory-observatory/model.mjs";
import { loadLocal } from "../.github/extensions/factory-observatory/sources.mjs";

afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([false, true])(
  "renders an accessible explicit preview with reduced motion %s",
  async (reduced) => {
    vi.resetModules();
    document.documentElement.lang = "en";
    document.body.innerHTML = (
      await readFile(
        join(
          process.cwd(),
          ".github",
          "extensions",
          "factory-observatory",
          "ui.html",
        ),
        "utf8",
      )
    )
      .split("<body>")[1]
      .split("</body>")[0];
    const snapshot = await loadLocal(
      "synthetic",
      "",
      process.cwd(),
      process.cwd(),
      "owner/factory",
    );
    snapshot.entities[0].title = "<img src=x onerror=alert(1)>";
    snapshot.events = [
      {
        id: "old",
        entityId: snapshot.entities[0].id,
        at: null,
        observedAt: null,
        from: 1,
        to: 2,
        detail: "old evidence",
      },
    ];
    const state = {
      snapshot,
      selectedId: null,
      position: 0,
      error: null,
      relatedIds: [],
      stages,
      source: { replayPath: "" },
    };
    vi.stubGlobal("matchMedia", () => ({
      matches: reduced,
      addEventListener: vi.fn(),
    }));
    vi.stubGlobal("setInterval", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(state))),
    );
    await import("../.github/extensions/factory-observatory/ui.mjs");
    expect(document.querySelectorAll(".station")).toHaveLength(8);
    expect(document.querySelectorAll(".pulse, img")).toHaveLength(0);
    expect(document.getElementById("status").textContent).toContain(
      "SYNTHETIC PREVIEW",
    );
    expect(document.getElementById("motion").getAttribute("aria-pressed")).toBe(
      String(reduced),
    );
    document
      .querySelector(".station")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.activeElement.id).toBe("inspector-title");
    expect((await axe(document.body)).violations).toEqual([]);
  },
);

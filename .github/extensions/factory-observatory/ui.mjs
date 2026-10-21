const $ = id => document.getElementById(id);
const element = (name, content) => {
  const node = document.createElement(name);
  if (content !== undefined) node.textContent = content;
  return node;
};
const svg = (name, attributes = {}, content) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
};
let state, station = null, zoom = 1;
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let playing = false, sequence = 0, pending = 0;
const seen = new Set();
let sourceKey;
const points = Array.from({ length: 8 }, (_, i) => { const angle = (-135 + i * 45) * Math.PI / 180; return [500 + 285 * Math.cos(angle), 415 + 285 * Math.sin(angle)]; });
async function request(action, input = {}, keepalive = false) {
  const ticket = ++sequence;
  pending++;
  $("step").disabled = true;
  try {
    const response = await fetch(action ? "/action" : "/state", {
      keepalive,
      method: action ? "POST" : "GET", headers: { "x-canvas-key": location.hash.slice(1), ...(action ? { "content-type": "application/json" } : {}) },
      ...(action ? { body: JSON.stringify({ action, input }) } : {}),
    });
    if (keepalive) {
      if (!response.ok) console.error("Canvas visibility notification rejected");
      return;
    }
    const data = await response.json();
    if (ticket !== sequence) return;
    if (!response.ok) throw new Error(data.error);
    const nextKey = `${data.snapshot.repository}:${data.snapshot.mode}:${data.source.replayPath}`;
    if (sourceKey !== nextKey) {
      seen.clear();
      const baseline = data.snapshot.mode === "replay" ? data.snapshot.events.slice(0, data.position) : data.snapshot.events;
      for (const event of baseline) seen.add(event.id);
      sourceKey = nextKey;
    }
    if (action !== "set_visibility" || JSON.stringify(state) !== JSON.stringify(data)) {
      state = data;
      render();
    }
  } catch (error) {
    if (keepalive) { console.error("Canvas visibility notification failed"); return; }
    if (ticket !== sequence) return;
    if (action) await request();
    $("error").hidden = false; $("error").textContent = error.message;
  } finally {
    pending--;
    if (state) $("step").disabled = pending > 0 || state.position >= state.snapshot.events.length;
  }
}
function workButton(item) {
  const button = element("button", item.title);
  button.dataset.focus = item.id;
  button.className = `work${state.selectedId === item.id ? " chosen" : ""}`;
  const detail = element("small", `${item.kind} · ${item.activity} · ${item.id}`);
  button.append(detail); button.onclick = () => request("select_item", { id: item.id });
  return button;
}
function draw() {
  const map = $("map"); map.replaceChildren();
  const center = station === null || zoom === 1 ? [500, 420] : points[station];
  map.setAttribute("viewBox", `${center[0] - 500 / zoom} ${center[1] - 420 / zoom} ${1000 / zoom} ${840 / zoom}`);
  const defs = svg("defs"), marker = svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  marker.append(svg("path", { d: "M0 0L10 5L0 10z", fill: "#12b956" })); defs.append(marker); map.append(defs);
  for (let i = 0; i < 8; i++) {
    const [x, y] = points[i], [a, b] = points[(i + 1) % 8], dx = a - x, dy = b - y, length = Math.hypot(dx, dy);
    map.append(svg("path", { d: `M${x + dx * 82 / length} ${y + dy * 82 / length} L${a - dx * 85 / length} ${b - dy * 85 / length}`, class: "route", "marker-end": "url(#arrow)" }));
  }
  const repairMarker = marker.cloneNode(true);
  repairMarker.id = "repair-arrow";
  repairMarker.firstChild.setAttribute("fill", "#249eff");
  defs.append(repairMarker);
  map.append(svg("path", { d: "M778 640 C965 645 965 175 778 190", class: "repair", "marker-end": "url(#repair-arrow)" }));
  map.append(svg("text", { x: 910, y: 430, class: "caption" }, "repair"));
  map.append(svg("text", { x: 500, y: 385, class: "mission" }, "INTENT / MISSION"));
  map.append(svg("text", { x: 500, y: 420, class: "caption" }, "Bounded work. Visible evidence."));
  map.append(svg("text", { x: 500, y: 450, class: "caption" }, `Policy ${state.snapshot.policy.version} · READ ONLY`));
  const related = new Set(state.relatedIds);
  const visible = state.snapshot.mode === "replay" ? state.snapshot.events.slice(0, state.position) : state.snapshot.events;
  const fresh = visible.filter(e => !seen.has(e.id));
  seen.clear();
  for (const event of visible) seen.add(event.id);
  state.stages.forEach((name, index) => {
    const items = state.snapshot.entities.filter(e => e.phase === index);
    const [x, y] = points[index];
    const pulse = !paused && fresh.some(e => e.to === index);
    const classes = ["station", station === index ? "selected" : "",
      items.some(e => related.has(e.id)) ? "related" : "", pulse ? "pulse" : ""];
    const node = svg("g", {
      class: classes.join(" "), transform: `translate(${x} ${y})`,
      role: "button", tabindex: 0, "aria-label": `${name}: ${items.length} observed records`,
    });
    node.dataset.focus = `station-${index}`;
    node.append(svg("circle", { r: 78 }), svg("text", { y: -40, class: "count" }, String(index + 1).padStart(2, "0")));
    const words = name.split(" "), middle = Math.ceil(words.length / 2);
    const lines = name.length > 15 ? [words.slice(0, middle).join(" "), words.slice(middle).join(" ")] : [name];
    lines.forEach((line, row) => node.append(svg("text", { y: row * 21 - 10 }, line)));
    node.append(svg("text", { y: 40, class: "count" }, `${items.length} observed`));
    const choose = () => { station = index; render(); $("inspector-title").focus(); };
    node.onclick = choose;
    node.onkeydown = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); choose(); } };
    map.append(node);
  });
}
function render() {
  const focus = document.activeElement?.getAttribute("data-focus");
  const { snapshot } = state;
  $("repository").textContent = snapshot.repository;
  $("source").value = snapshot.mode;
  $("report-label").hidden = snapshot.mode !== "replay";
  if (snapshot.mode === "replay" && document.activeElement !== $("report")) $("report").value = state.source.replayPath;
  const label = { live: "LIVE GITHUB OBSERVATION", synthetic: "SYNTHETIC PREVIEW — NOT REAL ACTIVITY", replay: "OFFLINE SIMULATION — NO LIVE OPERATIONS" }[snapshot.mode];
  $("status").textContent = `${label} · ${state.error ? "STALE / UNAVAILABLE" : snapshot.notes.some(n => /partial|unavailable/i.test(n)) ? "PARTIAL COVERAGE" : snapshot.collectedAt ? "Observed" : "Not loaded"} · ${snapshot.collectedAt ?? "No successful collection"} · read-only`;
  $("error").hidden = !state.error; $("error").textContent = state.error ?? "";
  $("motion").setAttribute("aria-pressed", String(paused)); $("motion").textContent = paused ? "Resume motion" : "Pause motion";
  $("play").textContent = playing ? "Pause" : "Play";
  $("inspector-title").textContent = station === null ? "Observed work" : state.stages[station]; $("inspector-title").tabIndex = -1;
  $("items").replaceChildren(...snapshot.entities.filter(e => (station === null || e.phase === station) && (!$("kind").value || e.kind === $("kind").value) && (!$("activity").value || e.activity === $("activity").value)).map(e => { const li = document.createElement("li"); li.append(workButton(e)); return li; }));
  $("rail").replaceChildren(...snapshot.entities.filter(e => e.phase === null).map(workButton));
  $("inspector").replaceChildren();
  const selected = snapshot.entities.find(e => e.id === state.selectedId);
  if (selected) {
    const heading = element("h3", selected.title);
    const evidence = element("pre", [selected.native, ...selected.shas, selected.key, selected.detail].filter(Boolean).join("\n\n"));
    $("inspector").append(heading, evidence);
    if (selected.url) {
      const link = element("a", "Open source evidence ↗"); link.href = selected.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      $("inspector").append(link);
    }
  }
  const visibleEvents = snapshot.events.filter(e => !state.selectedId || state.relatedIds.includes(e.entityId));
  $("events").replaceChildren(...visibleEvents.slice(-100).map(e => element("li", `${snapshot.mode === "replay" ? e.id : e.at ?? "Source timestamp unknown"} · ${e.detail}${e.observedAt ? ` · first observed ${e.observedAt}` : ""}`)));
  if (!visibleEvents.length) $("events").append(element("li", "No transitions observed in this window. An initial snapshot does not reconstruct history."));
  $("notes").replaceChildren(...[...snapshot.notes, `Policy ref: ${snapshot.policy.ref}; digest: ${snapshot.policy.digest || "unknown"}`, "Relations represent explicit references or a shared commit, not inferred causation."].map(n => element("li", n)));
  $("playback").hidden = snapshot.mode !== "replay";
  $("position").max = snapshot.events.length; $("position").value = state.position;
  $("step-label").textContent = `${state.position} / ${snapshot.events.length} steps`; draw();
  if (focus) [...document.querySelectorAll("[data-focus]")].find(node => node.dataset.focus === focus)?.focus();
}
$("source").onchange = () => { playing = false; station = null; request("select_source", { mode: $("source").value, replayPath: $("report").value }); };
$("report").onchange = () => {
  playing = false;
  station = null;
  request("select_source", { mode: "replay", replayPath: $("report").value });
};
$("refresh").onclick = () => request("refresh", { manual: true });
$("motion").onclick = () => { paused = !paused; if (paused) playing = false; render(); };
$("kind").onchange = $("activity").onchange = () => render();
$("zoom-in").onclick = () => { zoom = Math.min(3, zoom + .3); draw(); };
$("zoom-out").onclick = () => { zoom = Math.max(1, zoom - .3); draw(); };
$("fit").onclick = () => { zoom = 1; station = null; render(); };
$("clear").onclick = () => { station = null; request("select_item", { id: null }); };
$("position").oninput = () => { playing = false; request("set_replay", { position: Number($("position").value) }); };
$("step").onclick = () => request("set_replay", { position: Math.min(state.position + 1, state.snapshot.events.length) });
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; };
const visibility = () => { playing = false; request("set_visibility", { visible: document.visibilityState === "visible" }); };
document.addEventListener("visibilitychange", visibility);
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", event => { paused = event.matches; if (state) render(); });
const timers = [
  setInterval(() => { if (!pending && document.visibilityState === "visible") request("set_visibility", { visible: true }); }, 5000),
  setInterval(() => { if (!pending && document.visibilityState === "visible" && state?.snapshot.mode === "live") request("refresh", { manual: false }); }, 60000),
  setInterval(() => { if (!pending && document.visibilityState === "visible" && playing && state?.snapshot.mode === "replay") { if (state.position < state.snapshot.events.length) request("set_replay", { position: state.position + 1 }); else { playing = false; $("play").textContent = "Play"; } } }, 1200),
];
window.addEventListener("pagehide", () => {
  timers.forEach(clearInterval);
  document.removeEventListener("visibilitychange", visibility);
  request("set_visibility", { visible: false }, true);
});
await request();
await request("set_visibility", { visible: document.visibilityState === "visible" });
if (state) await request("refresh", { manual: state.snapshot.mode !== "live" });

import Ajv from "ajv2020/dist/2020.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { normalizeGoalKey } from "../../../scripts/intake/core.mjs";

export const stages = ["Signals", "Intake & Queue", "Build", "Checks", "Independent Review", "Integration / Merge", "Deploy", "Observe"];
export const modes = ["live", "synthetic", "replay"];
export const activities = ["queued", "running", "blocked", "paused", "terminal", "succeeded", "inactive", "unknown"];
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const array = (items, maxItems = 100) => ({ type: "array", items, maxItems });
const string = { type: "string", maxLength: 2000 };
const nullable = { type: ["string", "null"], maxLength: 2000 };
const phase = { type: ["integer", "null"], minimum: 0, maximum: 7 };
const ajv = new Ajv({ allErrors: true, strict: false });
const entitySchema = object({
  ...Object.fromEntries(["id", "title", "native", "detail"].map(k => [k, string])),
  kind: { enum: ["goal", "issue", "pr", "workflow", "check", "review", "incident", "deployment"] },
  phase, activity: { enum: activities }, at: nullable, url: nullable, key: nullable, shas: array(string), refs: array(string),
});
const snapshotSchema = object({
  version: { const: 1 }, mode: { enum: modes }, repository: string, collectedAt: nullable,
  policy: object({ ref: string, digest: string, version: string }),
  entities: array(entitySchema, 2000),
  events: array(object({ id: string, entityId: string, at: nullable, observedAt: nullable, detail: string, from: phase, to: phase }), 1000),
  notes: array(string),
});
const validateSnapshot = ajv.compile(snapshotSchema);
const stateSchema = object({
  snapshot: snapshotSchema, selectedId: nullable, error: nullable,
  position: { type: "integer", minimum: 0, maximum: 1000 },
});
const validateState = ajv.compile(stateSchema);
export const sourceSchema = object({ mode: { enum: modes }, replayPath: string }, ["mode"]);
export const actionSchemas = {
  get_snapshot: object({}), refresh: object({ manual: { type: "boolean" } }, []), select_source: sourceSchema,
  select_item: object({ id: nullable }),
  set_visibility: object({ visible: { type: "boolean" } }),
  set_replay: object({ position: { type: "integer", minimum: 0, maximum: 1000 } }),
};
const validators = Object.fromEntries(Object.entries(actionSchemas).map(([k, s]) => [k, ajv.compile(s)]));
export function validateAction(action, input) {
  assert(validators[action]?.(input), "Invalid canvas action or input");
}
export function validatePolicy(policy, schema) {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert(validate(policy), `Invalid autonomy policy: ${ajv.errorsText(validate.errors)}`);
  return policy;
}
export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const text = value => String(value ?? "").replace(/github_pat_[\w]+|gh[pousr]_[\w]+|Bearer\s+\S+/gi, "[redacted]").slice(0, 1800);
export function safeUrl(value, repository) {
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.search &&
      (url.pathname === `/${repository}` || url.pathname.startsWith(`/${repository}/`)) &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function entity(kind, id, fields) {
  return {
    id: `${kind}:${id}`, kind, phase: null, activity: "unknown",
    native: "", at: null, url: null, shas: [], refs: [], detail: "", key: null,
    ...fields, title: text(fields.title),
  };
}
export function empty(mode, repository, policy = { ref: "unavailable", digest: "", version: "unknown" }) {
  return { version: 1, mode, repository, collectedAt: null, policy, entities: [], events: [], notes: [] };
}
export function checked(snapshot) {
  assert(validateSnapshot(snapshot), `Invalid observation: ${ajv.errorsText(validateSnapshot.errors)}`);
  assert(Buffer.byteLength(JSON.stringify(snapshot)) < 2 * 1024 * 1024 - 4096, "Observation exceeds storage bound");
  assert(snapshot.entities.every(e => e.url === null || safeUrl(e.url, snapshot.repository) === e.url), "Unsafe evidence URL");
  return snapshot;
}
export function checkedState(data) {
  assert(validateState(data), "Invalid stored canvas state");
  checked(data.snapshot);
  assert(data.position <= data.snapshot.events.length, "Stored replay position is out of range");
  assert(data.selectedId === null || data.snapshot.entities.some(e => e.id === data.selectedId), "Stored selection is unavailable");
  return data;
}
export function goalPhase(state) {
  return ({
    "state:submitted": 1, "state:planned": 1,
    "state:implementing": 2, "state:review": 4,
    "state:reviewed": 5, "state:merging": 5, "state:completed": 5,
    "state:reported": 0, "state:investigating": 0, "state:resolved": 7,
  })[state] ?? null;
}
export function workflowPhase(path = "") {
  const name = path.split("/").at(-1)?.replace(/\.lock\.yml$|\.yml$/, "");
  const groups = [
    "terminal-incident", "goal-intake goal-planning",
    "coding-agent-assignment bounded-repair-routing",
    "ci code-security container-security", "independent-pr-review",
    "autonomous-integration autonomous-integration-complete",
    "delivery production infrastructure rollback", "incident-operations",
  ];
  const index = groups.findIndex(group => group.split(" ").includes(name));
  return index === -1 ? null : index;
}
function activity(item) {
  if (item.status === "in_progress") return "running";
  if (["queued", "waiting"].includes(item.status)) return "queued";
  if (item.conclusion === "success") return "succeeded";
  if (["failure", "timed_out", "action_required", "cancelled"].includes(item.conclusion)) return "blocked";
  return "unknown";
}
function issueActivity(item, labels, state) {
  if (labels.includes("autonomy:paused")) return "paused";
  if (state === "state:terminal") return "terminal";
  if (goalPhase(state) === null) return "unknown";
  if (labels.includes("repair:needed")) return "blocked";
  if (["state:completed", "state:resolved"].includes(state)) return "succeeded";
  return item.state !== "closed" && ["state:submitted", "state:planned"].includes(state) ? "queued" : "unknown";
}
function observed(kind, raw, repository, fields) {
  const shas = [raw.head?.sha, raw.head_sha, raw.sha, raw.commit_id, raw.merged_at && raw.merge_commit_sha].filter(v => typeof v === "string" && /^[a-f0-9]{40,64}$/.test(v));
  return entity(kind, raw.number ?? raw.id, {
    title: raw.title ?? raw.name ?? `Recorded ${kind}`,
    shas: [...new Set(shas)], native: text(raw.state ?? raw.status),
    at: raw.updated_at ?? raw.completed_at ?? raw.submitted_at ?? raw.created_at ?? null,
    url: safeUrl(raw.html_url, repository), ...fields,
  });
}
export function normalize(raw, repository, policy) {
  const result = empty("live", repository, policy);
  const add = (kind, raw, fields) => result.entities.push(observed(kind, raw, repository, fields));
  for (const item of raw.issues ?? []) {
    if (item.pull_request) continue;
    const labels = item.labels.map(l => l.name), states = labels.filter(l => l.startsWith("state:"));
    const kind = labels.includes("type:goal") ? "goal" : labels.includes("type:incident") ? "incident" : "issue";
    const classified = kind !== "issue" && states.length === 1 && labels.filter(l => l.startsWith("type:")).length === 1;
    const state = classified ? states[0] : "conflicting-or-missing-state";
    const key = kind === "goal" ? /^#{2,3} Goal key\r?\n+([^\r\n]+)/m.exec(item.body ?? "")?.[1] : /incident-fingerprint:([a-f0-9]+)/.exec(item.body ?? "")?.[1];
    const status = issueActivity(item, labels, state);
    add(kind, item, {
      id: `issue:${item.number}`,
      phase: ["paused", "terminal"].includes(status) || (status === "unknown" && item.state === "closed") ? null : goalPhase(state),
      activity: status,
      native: text(`${item.state}; ${labels.join(", ")}`), key: key ? normalizeGoalKey(text(key)) : null,
      detail: "Recorded lifecycle, not proof of running work. Select for available evidence; unrecorded budget usage remains unknown.",
    });
  }
  const issueIds = new Map(result.entities.map(e => [e.id.split(":")[1], e.id]));
  for (const item of raw.pulls ?? []) add("pr", item, {
    phase: item.merged_at ? 5 : item.state === "closed" ? null : 2,
    activity: item.merged_at ? "succeeded" : item.state === "closed" ? "unknown" : "queued",
    native: item.merged_at ? "merged" : item.state,
    refs: [...(item.body ?? "").matchAll(/\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d+)\b/gi)].map(m => issueIds.get(m[1])).filter(Boolean),
    detail: "Closing references express intent; select for exact-head checks and reviews.",
  });
  for (const item of raw.workflows ?? []) add("workflow", { ...item, id: `definition-${item.id}` }, {
    phase: workflowPhase(item.path), activity: "inactive",
    detail: "Workflow configuration, not a running job. Enabled does not mean executing.",
  });
  for (const item of raw.runs ?? []) add("workflow", { ...item, id: `run-${item.id}-${item.run_attempt ?? 1}` }, {
    phase: workflowPhase(item.path), activity: activity(item),
    native: `${item.status}/${item.conclusion ?? "pending"}`,
  });
  for (const item of raw.deployments ?? []) add("deployment", { ...item, title: `Deployment: ${item.environment}` }, {
    phase: 6, native: "status not loaded",
    detail: "Deployment records do not establish success or current health.",
  });
  return checked(result);
}
export function detailEntities(pull, checks, reviews, repository) {
  const convert = kind => item => {
    const check = kind === "check", sameHead = (check ? item.head_sha : item.commit_id) === pull.head.sha;
    const status = !sameHead ? "unknown" : check ? activity(item) : item.state === "APPROVED" ? "succeeded" : item.state === "CHANGES_REQUESTED" ? "blocked" : "unknown";
    return observed(kind, item, repository, {
      title: check ? item.name : `Review by ${text(item.user?.login ?? "unknown actor")}`,
      phase: check ? 3 : 4, activity: status,
      refs: [`pr:${pull.number}`], native: `${sameHead ? "" : "stale: "}${item.state ?? `${item.status}/${item.conclusion ?? "pending"}`}`,
      detail: text(check ? item.output?.summary : `Recorded review; independence is not certified by this viewer. ${item.body ?? ""}`),
    });
  };
  return [...checks.map(convert("check")), ...reviews.map(convert("review"))];
}
export function reconcile(next, previous, now = new Date().toISOString()) {
  next.entities = [...new Map(next.entities.map(e => [e.id, e])).values()];
  next.collectedAt = now;
  if (next.mode !== "live") return checked(next);
  const old = new Map(previous?.entities.map(e => [e.id, e]) ?? []), events = [...previous?.events ?? []];
  if (previous?.collectedAt) for (const item of next.entities) {
    const before = old.get(item.id);
    if (before?.native === item.native && before?.at === item.at && JSON.stringify(before?.shas) === JSON.stringify(item.shas)) continue;
    events.push({
      id: `${item.id}:${digest([item.native, item.at, item.shas])}`, entityId: item.id,
      at: item.at, observedAt: now, from: before?.phase ?? null, to: item.phase,
      detail: text(`Observed ${before ? "change" : "arrival"}: ${item.title} (${item.native})`).slice(0, 240),
    });
  }
  next.events = [...new Map(events.map(e => [e.id, e])).values()].slice(-1000);
  const keys = next.entities.filter(e => e.key).map(e => `${e.kind}:${e.key}`);
  if (new Set(keys).size < keys.length) next.notes.push("Duplicate keys observed; distinct records were not collapsed.");
  return checked(next);
}
export function related(snapshot, id) {
  const adjacency = new Map(snapshot.entities.map(e => [e.id, new Set(e.refs)])), commits = new Map();
  for (const e of snapshot.entities) {
    for (const ref of e.refs) adjacency.get(ref)?.add(e.id);
    for (const sha of e.shas) {
      if (!commits.has(sha)) commits.set(sha, []);
      commits.get(sha).push(e);
    }
  }
  for (const group of commits.values()) for (const pr of group.filter(e => e.kind === "pr")) for (const other of group) {
    adjacency.get(pr.id).add(other.id);
    adjacency.get(other.id).add(pr.id);
  }
  const ids = new Set(id ? [id] : []);
  for (const current of ids) for (const next of adjacency.get(current) ?? []) if (adjacency.has(next)) ids.add(next);
  return [...ids];
}
export function replay(report, repository, policy) {
  if (report.schemaVersion !== 1 || report.mode !== "local-simulation" || !Array.isArray(report.liveServicesCalled) || report.liveServicesCalled.length || !Array.isArray(report.scenarios) || report.scenarios.length > 100) throw new Error("Expected a bounded offline simulation report");
  const result = empty("replay", repository, { ref: policy.ref, digest: policy.digest, version: policy.version });
  for (const scenario of report.scenarios) {
    if (typeof scenario.id !== "string" || typeof scenario.title !== "string" || scenario.liveMutation !== false || !Array.isArray(scenario.transitions)) throw new Error("Invalid simulation scenario");
    const item = entity("goal", `replay-${scenario.id}`, { title: scenario.title, phase: 1, activity: "queued", native: "state:submitted", detail: "Ordered simulation, not real deployment or elapsed time." });
    result.entities.push(item);
    let state = "state:submitted";
    for (const transition of scenario.transitions) {
      if (transition.from !== state || !policy.transitions.some(t => t.from === transition.from && t.to === transition.to)) throw new Error("Unsupported or discontinuous replay transition");
      state = transition.to;
      result.events.push({ id: `step-${result.events.length + 1}`, entityId: item.id, at: null, observedAt: null, detail: state, from: goalPhase(transition.from), to: goalPhase(state) });
    }
  }
  assert(new Set(result.entities.map(e => e.id)).size === result.entities.length, "Duplicate simulation scenario IDs");
  result.notes.push("Offline simulation: ordered steps, no live operations or production timing.");
  return checked(result);
}

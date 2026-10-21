import { execFile as execute } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { checked, detailEntities, digest, empty, entity, normalize, replay, safeUrl, text, validatePolicy } from "./model.mjs";

const execFile = promisify(execute);
const cooldowns = new Map();
const routes = [
  /^$/, /^\/issues(?:\/\d+(?:\/(?:comments|timeline))?)?$/,
  /^\/pulls(?:\/\d+(?:\/reviews)?)?$/, /^\/actions\/(?:runs|workflows)$/,
  /^\/deployments(?:\/\d+\/statuses)?$/,
  /^\/commits(?:\/[a-f0-9]{40,64}\/check-runs)?$/,
  /^\/contents\/\.github\/autonomy\/policy(?:\.schema)?\.json$/,
];
export const inside = (root, file) => { const rel = relative(root, file); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };
export async function jsonFile(path) {
  if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("JSON artifact exceeds 2 MiB");
  const content = await readFile(path, "utf8");
  try { return JSON.parse(content); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("Invalid JSON artifact");
    throw error;
  }
}
export async function repositoryAt(root) {
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], { cwd: root, windowsHide: true, timeout: 10000 });
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(stdout.trim());
  if (!match) throw new Error("The owning origin must be a credential-free GitHub.com repository URL");
  return match[1];
}
export class GitHubReader {
  constructor(repository, signal, limit = 20, execute = execFile) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || repository.split("/").some(p => /^\.+$/.test(p))) throw new Error("Invalid repository");
    Object.assign(this, { repository, signal, limit, execute, count: 0, running: 0, waiting: [], notes: [] });
  }
  async get(endpoint) {
    if (!routes.some(r => r.test(endpoint.split("?")[0]))) throw new Error("GitHub read route is not permitted");
    if ((cooldowns.get(this.repository) ?? 0) > Date.now()) throw new Error(`GitHub rate limit: retry after ${new Date(cooldowns.get(this.repository)).toISOString()}`);
    if (++this.count > this.limit) throw new Error("GitHub read budget exhausted; coverage is incomplete");
    if (this.running === 2) await new Promise(resolve => this.waiting.push(resolve)); else this.running++;
    try {
      this.signal?.throwIfAborted();
      const { stdout } = await this.execute("gh",
        ["api", "--hostname", "github.com", "--method", "GET", "--include", `repos/${this.repository}${endpoint}`],
        { encoding: "utf8", windowsHide: true, signal: this.signal, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      const boundary = /\r?\n\r?\n/.exec(stdout);
      if (!boundary) throw new Error("GitHub returned no HTTP headers");
      const headers = stdout.slice(0, boundary.index);
      if (/rel="next"/i.test(headers) && !endpoint.startsWith("/commits?")) this.notes.push(`Partial coverage: ${endpoint.split("?")[0] || "repository"} is capped at 100 records.`);
      return JSON.parse(stdout.slice(boundary.index + boundary[0].length));
    } catch (error) {
      if (this.signal?.aborted) throw new Error("Observation cancelled");
      const detail = String(error.stderr ?? error.message);
      if (/rate.limit|429|retry-after/i.test(detail)) {
        const headers = String(error.stdout ?? ""), retry = /retry-after:\s*(\d+)/i.exec(headers), reset = /x-ratelimit-reset:\s*(\d+)/i.exec(headers);
        const until = Math.max(Date.now() + 60000, retry ? Date.now() + Number(retry[1]) * 1000 : reset ? Number(reset[1]) * 1000 : 0);
        cooldowns.set(this.repository, until);
        throw new Error(`GitHub rate limit: automatic polling paused; retry after ${new Date(until).toISOString()}`);
      }
      if (/401|403|authenticate|login/i.test(detail)) throw new Error("GitHub authentication or read permission unavailable; use your existing gh authentication outside this canvas.");
      if (error.code === "ENOENT") throw new Error("GitHub CLI is unavailable; install/configure gh outside this canvas.");
      if (error.killed || error.code === "ETIMEDOUT") throw new Error("GitHub read timed out");
      throw new Error("GitHub read failed; check connectivity and the owning repository's availability.");
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.running--;
    }
  }
}
const metadata = (control, ref) => ({ ref, digest: digest(control), version: control.schemaVersion });
export async function localPolicy(root) {
  const base = join(root, ".github", "autonomy");
  const control = validatePolicy(await jsonFile(join(base, "policy.json")), await jsonFile(join(base, "policy.schema.json")));
  return { control, meta: metadata(control, "workspace") };
}
export async function live(repository, signal, previous, execute) {
  const reader = new GitHubReader(repository, signal, 20, execute);
  const info = await reader.get("");
  if (info.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error("GitHub repository identity changed");
  const [commit] = await reader.get(`/commits?sha=${encodeURIComponent(info.default_branch)}&per_page=1`);
  if (!/^[a-f0-9]{40,64}$/.test(commit?.sha)) throw new Error("GitHub returned an invalid policy commit");
  const [policyFile, schemaFile] = await Promise.all(["policy.json", "policy.schema.json"].map(name => reader.get(`/contents/.github/autonomy/${name}?ref=${commit.sha}`)));
  const decode = item => JSON.parse(Buffer.from(item.content, "base64").toString("utf8"));
  const control = validatePolicy(decode(policyFile), decode(schemaFile));
  const requests = {
    issues: "/issues?state=all&sort=updated&direction=desc&per_page=100",
    pulls: "/pulls?state=all&sort=updated&direction=desc&per_page=100",
    workflows: "/actions/workflows?per_page=100",
    runs: "/actions/runs?per_page=100", deployments: "/deployments?per_page=100",
  };
  const raw = {};
  const failures = [];
  await Promise.all(Object.entries(requests).map(async ([name, endpoint]) => {
    try {
      const value = await reader.get(endpoint);
      raw[name] = value.workflows ?? value.workflow_runs ?? value;
      if (!Array.isArray(raw[name]) || raw[name].length > 100) throw new Error("Unexpected or oversized collection");
    } catch (error) {
      delete raw[name];
      failures.push(name);
      reader.notes.push(`Unavailable ${name}: ${text(error.message)} Prior observations, if any, are stale.`);
    }
  }));
  signal?.throwIfAborted();
  const result = normalize(raw, repository, metadata(control, commit.sha));
  const origin = e => ["goal", "issue", "incident"].includes(e.kind) ? "issues" : e.kind === "pr" ? "pulls" : e.kind === "deployment" ? "deployments" : e.id.startsWith("workflow:definition-") ? "workflows" : "runs";
  for (const e of previous?.entities ?? []) if (!["check", "review"].includes(e.kind) && failures.includes(origin(e))) {
    result.entities.push({ ...e, activity: "unknown", detail: text(`STALE collection: ${e.detail}`) });
  }
  result.notes = [...reader.notes, "Observed GitHub records only. Raw production telemetry is not connected. History is bounded, not a complete audit log."];
  return checked(result);
}
export async function selected(snapshot, id, signal, execute) {
  const item = snapshot.entities.find(e => e.id === id);
  if (!item) throw new Error("Selected item is outside the observed snapshot");
  const reader = new GitHubReader(snapshot.repository, signal, 5, execute);
  const number = id.split(":")[1];
  if (!/^\d+$/.test(number)) return snapshot;
  if (item.kind === "pr") {
    const pull = await reader.get(`/pulls/${number}`);
    const [checks, reviews] = await Promise.all([reader.get(`/commits/${pull.head.sha}/check-runs?per_page=100`), reader.get(`/pulls/${number}/reviews?per_page=100`)]);
    const after = await reader.get(`/pulls/${number}`);
    if (pull.head.sha !== after.head.sha) throw new Error("PR head changed during observation; refresh before inspecting checks.");
    snapshot.entities = snapshot.entities.filter(e => !["check", "review"].includes(e.kind) || !e.refs.includes(id));
    snapshot.entities.push(...detailEntities(pull, checks.check_runs, reviews, snapshot.repository));
    item.shas = [pull.head.sha, ...(pull.merged_at ? [pull.merge_commit_sha] : [])];
    item.native = pull.merged_at ? "merged" : pull.state;
    item.phase = pull.merged_at ? 5 : pull.state === "closed" ? null : 2;
    item.activity = pull.merged_at ? "succeeded" : pull.state === "closed" ? "unknown" : "queued";
  } else if (["goal", "issue", "incident"].includes(item.kind)) {
    const comments = await reader.get(`/issues/${number}/comments?per_page=100`);
    const evidence = comments.filter(c => /contract digest|budget reserved|repair|evidence/i.test(c.body ?? "")).slice(-5);
    item.detail = text(evidence.map(c => `${text(c.body).replace(/<!--[\s\S]*?-->/g, "").slice(0, 260)}\n${safeUrl(c.html_url, snapshot.repository) ?? ""}`).join("\n\n")) || "No supported budget/evidence comments observed. Usage remains unknown.";
  } else if (item.kind === "deployment") {
    const statuses = await reader.get(`/deployments/${number}/statuses?per_page=100`);
    const latest = statuses[0];
    item.native = latest?.state ?? "status unavailable";
    item.activity = latest?.state === "success" ? "succeeded" : ["failure", "error"].includes(latest?.state) ? "blocked" : "unknown";
    item.detail = `${text(latest?.description)} Deployment status is not ongoing production-health evidence.`;
  }
  snapshot.notes.push(...reader.notes);
  return checked(snapshot);
}
export async function loadLocal(mode, path, root, artifacts, repository) {
  const { control, meta } = await localPolicy(root);
  if (mode === "synthetic") {
    const fixture = await jsonFile(join(root, ".github", "extensions", "factory-observatory", "synthetic.json"));
    const result = empty(mode, repository, meta);
    result.entities = fixture.map(([kind, id, title, phase, activity, refs]) => entity(kind, `synthetic-${id}`, { title, phase, activity, refs, native: `synthetic ${activity}`, detail: "Synthetic example, not repository activity or a customer outcome." }));
    result.notes.push("Synthetic Preview only. Fixtures do not represent live work, production health, or customer results.");
    return checked(result);
  }
  const candidate = await resolveReplay(path, root, artifacts);
  return replay(await jsonFile(candidate), repository, { ...meta, transitions: control.lifecycle.goal.transitions });
}
export async function resolveReplay(path, root, artifacts) {
  path ||= join("reports", "demo", "report.json");
  const candidate = await realpath(isAbsolute(path) ? path : join(root, path));
  const allowed = [join(await realpath(root), "reports", "demo"), await realpath(artifacts)];
  if (!candidate.endsWith(".json") || !allowed.some(p => inside(p, candidate))) throw new Error("Replay must be a JSON report inside reports/demo or this session's artifact directory");
  return candidate;
}

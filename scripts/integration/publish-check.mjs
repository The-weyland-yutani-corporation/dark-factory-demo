import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.CHECK_SHA;
const conclusion = process.env.CHECK_CONCLUSION;
const token = process.env.GITHUB_CHECK_TOKEN;
const detailsPath = process.env.CHECK_DETAILS_PATH;

if (!repository || !sha || !token) {
  throw new Error(
    "GITHUB_REPOSITORY, CHECK_SHA, and GITHUB_CHECK_TOKEN are required",
  );
}
if (!["success", "failure"].includes(conclusion ?? "")) {
  throw new Error("CHECK_CONCLUSION must be success or failure");
}

let details = "";
if (detailsPath) {
  details = await readFile(detailsPath, "utf8").catch(() => "");
}

const output = {
  title:
    conclusion === "success"
      ? "Autonomous integration policy passed"
      : "Autonomous integration policy denied",
  summary:
    process.env.CHECK_SUMMARY ??
    "The trusted integration controller evaluated this commit.",
  text: details.slice(0, 60_000),
};

execFileSync(
  "gh",
  ["api", "--method", "POST", `repos/${repository}/check-runs`, "--input", "-"],
  {
    input: `${JSON.stringify({
      name: "autonomous-integration/evidence",
      head_sha: sha,
      status: "completed",
      conclusion,
      external_id: `autonomous-integration:${sha}:${process.env.GITHUB_RUN_ID ?? "local"}`,
      details_url: process.env.GITHUB_SERVER_URL
        ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined,
      output,
    })}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, GH_TOKEN: token },
  },
);

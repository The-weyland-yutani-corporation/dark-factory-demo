import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter(
    (file) =>
      !file.startsWith("node_modules/") &&
      !file.startsWith("coverage/") &&
      !file.startsWith("dist/") &&
      !file.endsWith("package-lock.json"),
  );

const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9]{36,255}\b/],
  ["Azure storage key", /\bAccountKey=[A-Za-z0-9+/=]{40,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];
const findings = [];

for (const file of files) {
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of signatures) {
    if (pattern.test(content)) findings.push(`${file}: possible ${name}`);
  }
}

if (findings.length > 0) {
  findings.forEach((finding) => console.error(finding));
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} files.`);
}

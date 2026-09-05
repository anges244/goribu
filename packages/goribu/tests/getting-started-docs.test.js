import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps the published getting-started path synchronized with the repository guide", () => {
  const guideUrl = new URL("../../../docs/getting-started.md", import.meta.url);
  const guide = readFileSync(guideUrl, "utf8").replace(/^# Getting started\n\n/, "");
  const site = readFileSync(new URL("../../../site/src/content/docs/installation.md", import.meta.url), "utf8")
    .replace(/^---\n[\s\S]*?\n---\n\n/, "");
  expect(site.trimEnd()).toBe(guide.replace(/\]\(\.\/([a-z0-9-]+)\.md\)/g, "](/docs/$1)").trimEnd());
  expect(site).not.toMatch(/\]\(\.\//);

  // All local onward links must work both in the checkout and on the site.
  for (const [, topic] of guide.matchAll(/\]\(\.\/([a-z0-9-]+)\.md\)/g)) {
    expect(existsSync(new URL(`./${topic}.md`, guideUrl)), topic).toBe(true);
    expect(existsSync(new URL(`../../../site/src/routes/docs/${topic}.jsx`, import.meta.url)), topic).toBe(true);
  }
  const shell = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]).join("\n");
  // Parse the actual command blocks, without installing, logging in or deploying.
  const syntax = spawnSync("sh", ["-n"], { input: shell, encoding: "utf8", cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
  expect(syntax.error).toBeUndefined();
  expect(syntax.status, syntax.stderr).toBe(0);
});

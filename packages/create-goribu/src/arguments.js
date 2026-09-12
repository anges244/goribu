export const HELP = `Usage: create-goribu <project-name> [--js] [--goribu-tarball <path>]

Create a TypeScript app with Tailwind, or choose JavaScript with --js.

  --js                    Generate JavaScript instead of TypeScript.
  --goribu-tarball <path>  Use a local packed Goribu .tgz for development.
  --help, -h              Show this help.

Examples:
  npx create-goribu my-app
  npx create-goribu my-app --js

Project names: 1–50 lowercase letters, digits or hyphens, starting with a letter
and ending with a letter or digit. Pass a name, not a path. The target must not exist.

Dependencies, Git, login, provisioning, and deployment remain your next steps.`;

export function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  let name;
  let tarball;
  let javascript = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--js") {
      if (javascript) fail('Option "--js" was supplied more than once.\nKeep one --js flag to create a JavaScript app.');
      javascript = true;
    } else if (value === "--goribu-tarball") {
      if (tarball !== undefined) fail('Option "--goribu-tarball" was supplied more than once.\nPass one local Goribu archive.');
      tarball = argv[++index];
      if (!tarball || tarball.startsWith("-")) {
        fail('Missing file path after "--goribu-tarball".\nPass a local archive, for example: --goribu-tarball "/path/to/goribu.tgz"');
      }
    } else if (value.startsWith("-")) {
      const repair = value === "--ts" ? "TypeScript is the default. Remove --ts and run the command again."
        : value === "--jss" || value === "-js" || value === "--javascript" ? "Did you mean --js to create a JavaScript app?"
        : "Supported options: --js, --goribu-tarball <path>, --help.\nRun npx create-goribu --help for examples.";
      fail(`Unknown option ${JSON.stringify(value)}.\n${repair}`);
    } else if (name !== undefined) {
      fail(`Unexpected extra argument ${JSON.stringify(value)}.\nPass one project name, for example: npx create-goribu my-app${javascript ? " --js" : ""}`);
    } else {
      name = value;
    }
  }
  if (!name) fail("Missing project name.\nRun: npx create-goribu my-app\nAdd --js for JavaScript; TypeScript is the default.");
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    fail(`Expected a project name, received path ${JSON.stringify(name)}.\nRun this command from the parent directory and pass a name such as my-app.`);
  }
  if (!/^[a-z](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(name)) {
    fail(`Invalid project name ${JSON.stringify(name)}.\nUse 1–50 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit; for example, my-app.`);
  }
  return { name, tarball, language: javascript ? "javascript" : "typescript" };
}

function fail(message) { throw new Error(`[Goribu] ${message}`); }

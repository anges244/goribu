import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readNavigationEnvelope } from "../browser/read-navigation-envelope.js";

/** Complete the draft emitted by Vite only with successfully written snapshots. */
export function createStaticNavigationOutput(clientDir) {
  const manifestFile = join(clientDir, "_goribu/navigation.json");
  let draft;
  try {
    draft = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (cause) {
    throw new Error("[Goribu] Static navigation has no valid build identity. Run `goribu build` to build the browser, Worker, and static output together.", { cause });
  }
  if (!/^[a-f0-9]{32}$/.test(draft?.buildId) || draft.routes !== null) {
    throw new Error("[Goribu] Static navigation requires a fresh unfinished build manifest. Run `goribu build` again instead of reusing previous output.");
  }
  const buildId = draft.buildId;
  const routes = Object.create(null);
  return {
    async write(route, html) {
      // These are Goribu-owned inert scripts, emitted by ClientEntry with escaped
      // JSON. Read the existing render; never run a GET handler a second time.
      const identity = readScript(html, "__GORIBU_ROUTE__");
      const props = readScript(html, "__GORIBU_PROPS__");
      if (identity?.id !== route.id || identity.buildId !== buildId || identity.status !== 200) {
        throw new Error(`[Goribu] Prerendered route ${JSON.stringify(route.id)} has inconsistent hydration data. Keep one unmodified <ClientEntry /> in the Document and rebuild.`);
      }
      const payload = { kind: "render", routeId: route.id, props, meta: identity.meta, status: 200 };
      // Share the browser's strict protocol/metadata validation at build time.
      await readNavigationEnvelope(new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      }));
      const source = JSON.stringify({ ...payload, buildId });
      const digest = createHash("sha256").update(source).digest("hex");
      const asset = `/_goribu/navigation/${buildId}/${digest}.json`;
      const file = join(clientDir, asset.slice(1));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
      routes[route.pathname] = { routeId: route.id, asset };
    },
    finish() {
      writeFileSync(manifestFile, JSON.stringify({ buildId, routes }));
    },
  };
}

function readScript(html, id) {
  // Match the exact framework serialization, including an optional CSP nonce.
  // Refuse missing/duplicate reserved IDs rather than selecting arbitrary data.
  // HTML attributes start after whitespace. A word boundary also matches the
  // suffix of unrelated names such as data-id and data-route-id.
  const mentions = [...html.matchAll(new RegExp(`[\\t\\n\\f\\r ]id=["']${id}["']`, "g"))];
  const scripts = [...html.matchAll(new RegExp(`<script id="${id}" type="application/json"(?: nonce="[^"]*")?>([^<]*)</script>`, "g"))];
  if (mentions.length !== 1 || scripts.length !== 1) {
    throw new Error(`[Goribu] Cannot save static navigation: the prerendered Document must contain exactly one ${id} hydration script. Render <ClientEntry /> once and do not reuse Goribu's reserved IDs.`);
  }
  try {
    return JSON.parse(scripts[0][1]);
  } catch (cause) {
    throw new Error(`[Goribu] Cannot read ${id} from prerendered HTML. Keep Goribu's hydration scripts unchanged and rebuild.`, { cause });
  }
}

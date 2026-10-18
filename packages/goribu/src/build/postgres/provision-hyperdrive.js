import { isApplicationConfig } from "../../runtime/application-config.js";
import { getCloudflareAccess } from "../cloudflare-access.js";
import { readPostgresEnv } from "./read-postgres-env.js";
import { parsePostgresUrl } from "./parse-postgres-url.js";

/** Provision the two managed configs, or validate the caching modes of BYO configs. */
export async function provisionHyperdrive(options) {
  const { projectRoot, appConfig } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig)) {
    throw new TypeError("[Goribu] provisionHyperdrive requires projectRoot and the defineConfig() result from goribu.config.js.");
  }
  if (appConfig.database?.type !== "postgres") return null;
  const stdout = options.stdout ?? process.stdout;
  if (typeof stdout?.write !== "function") {
    throw new TypeError("[Goribu] provisionHyperdrive requires a writable stdout stream; pass process.stdout.");
  }
  const byo = appConfig.database.hyperdriveId !== undefined;
  const configs = [
    { name: `${appConfig.name}-postgres`, field: "hyperdriveId", disabled: true },
    { name: `${appConfig.name}-postgres-cached`, field: "hyperdriveCachedId", disabled: false },
  ];
  // Validate the origin before authentication or any remote writes. BYO owns its origin.
  const originSettings = byo ? undefined : readOrigin(projectRoot, stdout, configs);
  // Cloudflare's messages are included in errors; strip the credentials just in case.
  const secrets = byo ? [] : secretsOf(originSettings.origin.password);
  const access = options.access ?? await getCloudflareAccess({ projectRoot });
  const request = createRequest(access, options.fetch ?? globalThis.fetch, secrets);

  if (byo) {
    const remote = [];
    for (const config of configs) {
      const id = appConfig.database[config.field];
      remote.push((await request(`/${encodeURIComponent(id)}`, `config ${config.field}`)).result);
    }
    for (const [index, config] of configs.entries()) {
      const actual = remote[index];
      if (actual?.id !== appConfig.database[config.field]) throw invalidResponse(`config ${config.field}`);
      if (actual?.caching?.disabled !== config.disabled) {
        throw new Error(`[Goribu] Hyperdrive config ${config.field} must have caching ${config.disabled ? "disabled" : "enabled"}. Correct its caching setting in Cloudflare or supply the matching ID in goribu.config.js, then rerun \`goribu deploy\`. Goribu does not modify BYO configs.`);
      }
    }
    return { id: remote[0].id, cachedId: remote[1].id };
  }

  const label = `configs ${configs.map(({ name }) => name).join(" and ")}`;
  const inventory = [];
  let totalPages;
  for (let page = 1; page <= (totalPages ?? 1); page++) {
    const payload = await request(`?page=${page}`, label);
    const pages = payload.result_info?.total_pages;
    if (!Array.isArray(payload.result) || !Number.isInteger(pages) || pages < 0 ||
        (pages === 0 && (page !== 1 || payload.result.length !== 0)) ||
        (totalPages !== undefined && pages !== totalPages)) {
      throw invalidResponse(label);
    }
    totalPages = pages;
    if (payload.result.some((config) => typeof config?.name !== "string" || !validId(config?.id))) {
      throw invalidResponse(label);
    }
    inventory.push(...payload.result);
  }
  // Resolve BOTH names before writing: ambiguity in the second must not mutate the first.
  const existing = configs.map(({ name }) => {
    const matches = inventory.filter((config) => config?.name === name);
    if (matches.length > 1) {
      throw new Error(`[Goribu] More than one Hyperdrive config is named ${name}. Rename the extra configs in Cloudflare or set hyperdriveId and hyperdriveCachedId in goribu.config.js, then rerun \`goribu deploy\`. No configs were changed.`);
    }
    if (matches.length === 1 && !validId(matches[0].id)) throw invalidResponse(`config ${name}`);
    return matches[0];
  });

  const ids = [];
  for (const [index, config] of configs.entries()) {
    const previous = existing[index];
    const body = { ...originSettings, caching: { disabled: config.disabled } };
    if (!previous) body.name = config.name;
    const { result } = await request(previous ? `/${encodeURIComponent(previous.id)}` : "", `config ${config.name}`, {
      method: previous ? "PATCH" : "POST", body,
    });
    if (!validId(result?.id) || result.name !== config.name ||
        (previous && result.id !== previous.id) || result.caching?.disabled !== config.disabled) {
      throw invalidResponse(`config ${config.name}`);
    }
    ids.push(result.id);
    stdout.write(`✓ ${previous ? "Updated" : "Created"} Hyperdrive config ${config.name}\n`);
  }
  return { id: ids[0], cachedId: ids[1] };
}

function readOrigin(projectRoot, stdout, configs) {
  const { url } = readPostgresEnv({ projectRoot, target: "production" });
  const { parameters, ...origin } = parsePostgresUrl(url.value, url.source);
  const sslmodes = parameters.filter(([key]) => key === "sslmode").map(([, value]) => value);
  if (sslmodes.some((value) => value !== "require")) {
    throw new Error(`[Goribu] Hyperdrive configs ${configs.map(({ name }) => name).join(" and ")} only support sslmode=require from POSTGRES_URL in .env.production. Use sslmode=require or omit sslmode. verify-ca and verify-full require a CA upload: configure those in Cloudflare and set hyperdriveId and hyperdriveCachedId in goribu.config.js.`);
  }
  if (origin.host.includes("-pooler") || origin.port === 6543 || origin.port === 6432) {
    stdout.write("[Goribu] Warning: POSTGRES_URL in .env.production appears to use a pooler. Switch to your provider's direct connection string; Hyperdrive already pools connections.\n");
  }
  return { origin, ...(sslmodes.length ? { mtls: { sslmode: "require" } } : {}) };
}

function createRequest(access, fetchImpl, secrets) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(access.accountId)}/hyperdrive/configs`;
  return async (path, label, { method = "GET", body } = {}) => {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method, redirect: "error",
        headers: { ...access.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Fetch exceptions can contain request bodies. Never retain them as causes.
      throw new Error(`[Goribu] Could not reach Cloudflare for Hyperdrive ${label}. Check network connectivity. ${RETRY_HELP}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      if (response.status === 401 || response.status === 403) throw permissionError(label);
      throw invalidResponse(label);
    }
    if (!response.ok || payload?.success !== true) {
      const codes = Array.isArray(payload?.errors) ? payload.errors.map((error) => error?.code) : [];
      if (response.status === 401 || response.status === 403 ||
          (response.status < 500 && codes.some((code) => [10000, 10001, 9106, 9109].includes(code)))) {
        throw permissionError(label);
      }
      let repair;
      if (codes.includes(2013) || codes.includes(2008) || codes.includes(2007)) {
        const problem = codes.includes(2013) ? "rejected the database credentials" :
          codes.includes(2008) ? "could not resolve or reach the database host" : "requires a non-empty database password";
        repair = `Cloudflare ${problem}; fix POSTGRES_URL in .env.production, then rerun \`goribu deploy\`.`;
      } else if (codes.includes(2017)) {
        repair = `Cloudflare reports a duplicate name. Inspect configs with this exact name in Cloudflare. ${RETRY_HELP}`;
      } else if (codes.includes(2006)) {
        repair = "Cloudflare could not find the config. Check the selected account and any hyperdriveId / hyperdriveCachedId in goribu.config.js, then rerun `goribu deploy`.";
      } else {
        const said = cloudflareSaid(payload?.errors?.[0], secrets);
        repair = response.status >= 500
          ? `${said}Check Cloudflare service status. ${RETRY_HELP}`
          : `${said}Fix what Cloudflare reports (for a database problem, POSTGRES_URL in .env.production), then rerun \`goribu deploy\`.`;
      }
      throw new Error(`[Goribu] Cloudflare rejected Hyperdrive ${label} (${method}, HTTP ${response.status}). ${repair}`);
    }
    return payload;
  };
}

const RETRY_HELP = "Rerunning `goribu deploy` is safe: Goribu looks up exact config names before writing. It does not automatically retry a create.";

function permissionError(label) {
  return new Error(`[Goribu] Cloudflare denied access to Hyperdrive ${label}. Confirm the selected account and credentials have permission to read and write Hyperdrive configs. Run \`pnpm exec goribu cloudflare-login\` to refresh Wrangler login, or correct CLOUDFLARE_API_TOKEN permissions, then rerun \`goribu deploy\`.`);
}

function invalidResponse(label) {
  return new Error(`[Goribu] Cloudflare returned an unreadable or invalid response for Hyperdrive ${label}. Inspect the configs in Cloudflare and check service status. ${RETRY_HELP}`);
}

function secretsOf(password) {
  return [password, encodeURIComponent(password)].filter((secret) => secret.length > 0);
}

/** Quote Cloudflare's first error, without credentials, so unknown failures still teach. */
function cloudflareSaid(error, secrets) {
  if (typeof error?.message !== "string" || error.message.length === 0) return "";
  // Redact before truncating, so a cut can never leave part of a secret behind.
  let message = error.message;
  for (const secret of secrets) message = message.split(secret).join("<redacted>");
  return `Cloudflare said: ${error.code ?? "no code"} ${JSON.stringify(message.slice(0, 300))}. `;
}

function validId(id) {
  return typeof id === "string" && id.trim().length > 0;
}

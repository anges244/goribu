import { spawn as nodeSpawn } from "node:child_process";
import { resolve } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";
import {
  listRemoteD1Databases,
  normalizeRemoteD1Databases,
} from "./run-check.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** Create or reconcile the single D1 database declared by an application. */
export async function provisionD1(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] provisionD1({ projectRoot, appConfig }) requires the application project root.",
    );
  }
  const appConfig = options?.appConfig;
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError(
      "[Goribu] provisionD1({ appConfig }) requires the defineConfig() result from goribu.config.js.",
    );
  }
  if (appConfig.database === undefined) return null;

  const stdout = options?.stdout ?? process.stdout;
  if (stdout === null || typeof stdout.write !== "function") {
    throw new TypeError(
      "[Goribu] provisionD1({ stdout }) requires a writable output stream.",
    );
  }

  const inspectD1 = options?.inspectD1 ?? listRemoteD1Databases;
  const databases = normalizeRemoteD1Databases(
    await inspectD1({ projectRoot }),
  );
  const declaration = appConfig.database;
  const matches = databases.filter(
    (database) => database.name === declaration.name,
  );
  if (matches.length > 1) {
    throw new Error(
      `[Goribu] Cloudflare returned more than one D1 database named ${JSON.stringify(declaration.name)}. ` +
        "Goribu cannot provision or bind one safely; resolve the duplicate resources in Cloudflare and rerun `goribu deploy`.",
    );
  }

  const getAccess = options?.getAccess ?? getCloudflareAccess;
  const requestD1 = options?.requestD1 ?? requestCloudflareD1;
  let database = matches[0];

  if (database === undefined) {
    const mode = declaration.replication === false ? "disabled" : "auto";
    const access = await getAccess({ projectRoot });
    database = await requestD1({
      access,
      method: "POST",
      body: {
        name: declaration.name,
        read_replication: { mode },
      },
    });
    assertProvisionedDatabase(database, declaration.name, mode);
    stdout.write(`✓ Created database ${declaration.name}\n`);
    stdout.write(`${formatReplicationChange(mode)}\n`);
    return freezeDatabase(database);
  }

  if (declaration.replication === undefined) {
    return freezeDatabase(database);
  }

  const desiredMode = declaration.replication ? "auto" : "disabled";
  let access;
  let currentMode = database.readReplication;
  if (currentMode === undefined) {
    access = await getAccess({ projectRoot });
    const inspected = await requestD1({
      access,
      method: "GET",
      databaseId: database.uuid,
    });
    assertProvisionedDatabase(inspected, declaration.name);
    currentMode = inspected.readReplication;
  }

  if (currentMode !== desiredMode) {
    access ??= await getAccess({ projectRoot });
    const updated = await requestD1({
      access,
      method: "PUT",
      databaseId: database.uuid,
      body: { read_replication: { mode: desiredMode } },
    });
    assertProvisionedDatabase(updated, declaration.name, desiredMode);
    database = updated;
    stdout.write(`${formatReplicationChange(desiredMode)}\n`);
  }

  return freezeDatabase(database);
}

/** Resolve Wrangler's current credentials without reading its private storage. */
export async function getCloudflareAccess(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] getCloudflareAccess({ projectRoot }) requires the application project root.",
    );
  }
  const runJson = options?.runJson ?? runWranglerJson;
  const token = await runJson({
    projectRoot,
    args: ["auth", "token", "--json"],
    description: "read Wrangler's authenticated Cloudflare credentials",
  });
  const identity = await runJson({
    projectRoot,
    args: ["whoami", "--json"],
    description: "resolve Wrangler's Cloudflare account",
  });

  const accounts = identity?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(
      "[Goribu] Wrangler returned no Cloudflare accounts for resource provisioning. Run `wrangler login`, confirm account access, then rerun `goribu deploy`.",
    );
  }
  const requestedAccountId = Object.prototype.hasOwnProperty.call(
    options,
    "accountId",
  )
    ? options.accountId
    : process.env.CLOUDFLARE_ACCOUNT_ID;
  let account;
  if (requestedAccountId !== undefined) {
    account = accounts.find((candidate) => candidate?.id === requestedAccountId);
    if (account === undefined) {
      throw new Error(
        `[Goribu] CLOUDFLARE_ACCOUNT_ID ${JSON.stringify(requestedAccountId)} is not available to Wrangler's current credentials. ` +
          "Select an accessible account or log in again, then rerun `goribu deploy`.",
      );
    }
  } else if (accounts.length === 1) {
    [account] = accounts;
  } else {
    throw new Error(
      "[Goribu] Wrangler's credentials can access more than one Cloudflare account, so Goribu cannot safely choose where to provision resources. " +
        "Set CLOUDFLARE_ACCOUNT_ID to the intended account and rerun `goribu deploy`.",
    );
  }
  if (typeof account?.id !== "string" || account.id.length === 0) {
    throw new Error(
      "[Goribu] Wrangler returned an invalid Cloudflare account for resource provisioning. Update Wrangler, log in again, and rerun `goribu deploy`.",
    );
  }

  return Object.freeze({ accountId: account.id, headers: authHeaders(token) });
}

/** Call the official D1 REST API with credentials obtained through Wrangler. */
export async function requestCloudflareD1(options) {
  const access = options?.access;
  const method = options?.method;
  const databaseId = options?.databaseId;
  if (
    access === null ||
    typeof access !== "object" ||
    typeof access.accountId !== "string" ||
    access.headers === null ||
    typeof access.headers !== "object"
  ) {
    throw new TypeError(
      "[Goribu] requestCloudflareD1({ access }) requires resolved Wrangler credentials and an account id.",
    );
  }
  if (!new Set(["GET", "POST", "PUT"]).has(method)) {
    throw new TypeError(
      "[Goribu] requestCloudflareD1({ method }) requires GET, POST, or PUT.",
    );
  }

  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const suffix = databaseId === undefined ? "" : `/${encodeURIComponent(databaseId)}`;
  let response;
  try {
    response = await fetchImpl(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(access.accountId)}/d1/database${suffix}`,
      {
        method,
        headers: {
          ...access.headers,
          "Content-Type": "application/json",
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      },
    );
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not reach Cloudflare while provisioning D1. Check the network connection and rerun `goribu deploy`.",
      { cause },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(
      "[Goribu] Cloudflare returned an unreadable D1 provisioning response. Retry `goribu deploy`; if it persists, update Goribu and Wrangler.",
      { cause },
    );
  }
  if (!response.ok || payload?.success !== true) {
    throw new Error(
      `[Goribu] Cloudflare rejected D1 provisioning with HTTP ${response.status}. ` +
        "Confirm Wrangler is logged in with D1 Write permission and rerun `goribu deploy`.",
    );
  }
  return normalizeApiDatabase(payload.result);
}

async function runWranglerJson(options) {
  const spawn = options?.spawn ?? nodeSpawn;
  const resolveBin = options?.resolveBin ?? resolveWranglerBin;
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Wrangler for resource provisioning. Install dependencies (for example `pnpm install`) and rerun `goribu deploy`.",
      { cause },
    );
  }

  let child;
  try {
    child = spawn(process.execPath, [wranglerBin, ...options.args], {
      cwd: resolve(options.projectRoot),
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (cause) {
    throw wranglerProvisionError(options.description, cause);
  }
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  const { code, signal } = await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", (cause) =>
      rejectPromise(wranglerProvisionError(options.description, cause)),
    );
    child.on("close", (exitCode, terminatingSignal) =>
      resolvePromise({ code: exitCode, signal: terminatingSignal }),
    );
  });
  if (signal !== null || code !== 0) {
    throw wranglerProvisionError(options.description);
  }
  try {
    return JSON.parse(output);
  } catch (cause) {
    throw wranglerProvisionError(options.description, cause);
  }
}

function wranglerProvisionError(description, cause) {
  return new Error(
    `[Goribu] Could not ${description} for resource provisioning. Read the Wrangler error above, repair authentication, then rerun \`goribu deploy\`.`,
    { cause },
  );
}

function authHeaders(credentials) {
  if (
    (credentials?.type === "api_token" || credentials?.type === "oauth") &&
    typeof credentials.token === "string" &&
    credentials.token.length > 0
  ) {
    return Object.freeze({ Authorization: `Bearer ${credentials.token}` });
  }
  if (
    credentials?.type === "api_key" &&
    typeof credentials.key === "string" &&
    credentials.key.length > 0 &&
    typeof credentials.email === "string" &&
    credentials.email.length > 0
  ) {
    return Object.freeze({
      "X-Auth-Key": credentials.key,
      "X-Auth-Email": credentials.email,
    });
  }
  throw new Error(
    "[Goribu] Wrangler returned unsupported Cloudflare credentials for resource provisioning. Update Wrangler, log in again, and rerun `goribu deploy`.",
  );
}

function normalizeApiDatabase(database) {
  const readReplication = database?.read_replication?.mode;
  return {
    name: database?.name,
    uuid: database?.uuid,
    ...(readReplication === undefined ? {} : { readReplication }),
  };
}

function assertProvisionedDatabase(database, expectedName, expectedMode) {
  if (
    database === null ||
    typeof database !== "object" ||
    database.name !== expectedName ||
    typeof database.uuid !== "string" ||
    database.uuid.length === 0 ||
    (database.readReplication !== undefined &&
      database.readReplication !== "auto" &&
      database.readReplication !== "disabled") ||
    (expectedMode !== undefined && database.readReplication !== expectedMode)
  ) {
    throw new Error(
      "[Goribu] Cloudflare returned an unexpected D1 resource after provisioning. Inspect the database in Cloudflare and rerun `goribu check` before deploying again.",
    );
  }
}

function freezeDatabase(database) {
  return Object.freeze({
    name: database.name,
    uuid: database.uuid,
    ...(database.readReplication === undefined
      ? {}
      : { readReplication: database.readReplication }),
  });
}

function formatReplicationChange(mode) {
  return mode === "auto"
    ? "✓ Enabled global read replication"
    : "✓ Disabled global read replication";
}

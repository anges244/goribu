const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const DEFAULT_POSTGRES_PORT = 5432;

/**
 * Parse one PostgreSQL connection URL into the canonical immutable structure used by
 * development, migrations, and Hyperdrive provisioning.
 *
 * The original URL remains outside the result, but the parsed structure still contains
 * credentials. It stays in the CLI or Vite process and never goes into application
 * config, the generated Wrangler file, or logs. Query parameters stay as ordered
 * pairs because PostgreSQL URLs may repeat a parameter.
 */
export function parsePostgresUrl(value, source) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidUrl(
      source,
      "Set it to postgres://user:password@host:5432/database.",
    );
  }

  if (value !== value.trim()) {
    throw invalidUrl(
      source,
      "Remove leading or trailing whitespace, including quotes copied with the value.",
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalidUrl(
      source,
      "Use postgres://user:password@host:5432/database or postgresql://user:password@host:5432/database. In env files, wrap the value in double quotes if it contains #; an unquoted # starts a comment.",
    );
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw invalidUrl(
      source,
      'Use the "postgres:" or "postgresql:" scheme; other URL schemes cannot configure PostgreSQL.',
    );
  }

  const user = decodeUrlPart(url.username, "user", source);
  if (user.length === 0) {
    throw invalidUrl(
      source,
      "Include the database user before the password, for example postgres://postgres:postgres@localhost:5432/myapp.\nA local Postgres without password authentication accepts any password.",
    );
  }

  const password = decodeUrlPart(url.password, "password", source);
  if (password.length === 0) {
    throw invalidUrl(
      source,
      "Include the database password after the user, for example postgres://postgres:postgres@localhost:5432/myapp. Percent-encode reserved password characters such as @ as %40.\nA local Postgres without password authentication accepts any password.",
    );
  }

  if (url.hostname.length === 0) {
    throw invalidUrl(
      source,
      "Include the database host after the credentials, for example @localhost:5432.",
    );
  }

  const databasePath = url.pathname.slice(1);
  if (databasePath.length === 0 || databasePath.includes("/")) {
    throw invalidUrl(
      source,
      "Include exactly one database name after the host, percent-encoding a slash inside the name as %2F.",
    );
  }
  const database = decodeUrlPart(databasePath, "database name", source);
  if (database.length === 0) {
    throw invalidUrl(source, "Include a non-empty database name after the host.");
  }

  if (url.hash.length > 0) {
    throw invalidUrl(
      source,
      "Remove the URL fragment; PostgreSQL connection options belong in query parameters.",
    );
  }

  const port = url.port === "" ? DEFAULT_POSTGRES_PORT : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidUrl(
      source,
      "Use a TCP port from 1 to 65535, or omit it to use PostgreSQL's default port 5432.",
    );
  }

  const parameters = Object.freeze(
    Array.from(url.searchParams, ([name, parameterValue]) =>
      Object.freeze([name, parameterValue]),
    ),
  );

  return Object.freeze({
    scheme: url.protocol.slice(0, -1),
    user,
    password,
    host: normalizeHost(url.hostname),
    port,
    database,
    parameters,
  });
}

function normalizeHost(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function decodeUrlPart(value, label, source) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidUrl(
      source,
      `Correct the percent-encoding in the ${label}; every % must be followed by two hexadecimal digits.`,
    );
  }
}

function invalidUrl(source, instruction) {
  return new TypeError(
    `[Goribu] ${source} is not a usable PostgreSQL connection URL. ${instruction}`,
  );
}

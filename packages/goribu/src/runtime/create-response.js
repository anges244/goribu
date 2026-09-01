const RESPONSE_RESULT = Symbol("goribu.response-result");
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Create Goribu's handler-facing response builder.
 *
 * Terminal helpers return structured intent rather than constructing a Web
 * Response. Dispatch owns document/navigation serialization and SSR; the
 * application boundary owns cookie flushing and error pages.
 *
 * @param {{
 *   canRender: boolean,
 *   mode?: "production"|"development",
 *   formRenderContext?: { actionPathname: string, displayedPathname: string|null }|null,
 * }} options
 */
export function createResponse(options) {
  const canRender = options?.canRender;
  if (typeof canRender !== "boolean") {
    throw new TypeError(
      "[Goribu] createResponse({ canRender }) requires whether the matched route has a default page export. " +
        "Pass the route manifest's hasDefaultExport value.",
    );
  }

  const development = options?.mode === "development";
  const formRenderContext = options?.formRenderContext ?? null;
  let status = 200;
  let hasExplicitStatus = false;
  const pendingHeaders = new Map();

  const response = {
    status(code) {
      assertStatus(code, "res.status(code)");
      status = code;
      hasExplicitStatus = true;
      return response;
    },

    headers(headers) {
      mergeHeaders(pendingHeaders, headers);
      return response;
    },

    text(body) {
      assertNoExtraArguments(arguments, "res.text(body)");
      return terminal({
        kind: "text",
        status,
        headers: snapshotHeaders(pendingHeaders, {
          "content-type": "text/plain; charset=utf-8",
        }),
        body: body == null ? "" : String(body),
      });
    },

    json(data) {
      assertNoExtraArguments(arguments, "res.json(data)");
      return terminal({
        kind: "json",
        status,
        headers: snapshotHeaders(pendingHeaders, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: serializeJson(data, "res.json(data)"),
      });
    },

    invalid(errors, invalidStatus = 422) {
      if (arguments.length > 2) {
        throw new TypeError(
          "[Goribu] res.invalid(errors, status) accepts validation errors and an optional status. Remove extra arguments.",
        );
      }
      assertStatus(invalidStatus, "res.invalid(errors, status)");
      const normalizedErrors = normalizeFormErrors(errors, development);

      return terminal({
        kind: "invalid",
        status: invalidStatus,
        headers: snapshotHeaders(pendingHeaders, {
          "content-type": "application/json; charset=utf-8",
        }),
        errors: normalizedErrors,
        body: serializeJson(
          { errors: normalizedErrors },
          "res.invalid(errors, status)",
        ),
      });
    },

    redirect(location) {
      assertNoExtraArguments(arguments, "res.redirect(location)", {
        statusRepair: true,
      });
      assertLocation(location);

      const redirectStatus = hasExplicitStatus ? status : 303;
      if (!REDIRECT_STATUSES.has(redirectStatus)) {
        throw new RangeError(
          `[Goribu] Cannot redirect with status ${redirectStatus}. ` +
            "Use res.status(301), res.status(302), res.status(303), res.status(307), " +
            "or res.status(308) before res.redirect(location).",
        );
      }

      return terminal({
        kind: "redirect",
        status: redirectStatus,
        headers: snapshotHeaders(pendingHeaders, { location }),
        location,
      });
    },

    render(props = {}) {
      if (arguments.length > 1) {
        throw new TypeError(
          "[Goribu] res.render(props) accepts only props for the matched route's default page. " +
            "Remove the component or JSX argument and call res.render(props).",
        );
      }
      if (!canRender) {
        throw new Error(
          "[Goribu] res.render(props) requires the matched route to have a default page export. " +
            "Add a default export to the route or return res.text(), res.json(), res.invalid(), res.redirect(), or res.notFound().",
        );
      }

      assertFormRenderPath(formRenderContext);
      assertPropsObject(props, "res.render(props)");
      assertSerializableProps(props, "res.render(props)");
      return terminal({
        kind: "render",
        status,
        headers: snapshotHeaders(pendingHeaders),
        props,
      });
    },

    notFound(props = {}) {
      if (arguments.length > 1) {
        throw new TypeError(
          "[Goribu] res.notFound(props) accepts one props value. " +
            "Pass only the data for the application's 404 page.",
        );
      }

      assertPropsObject(props, "res.notFound(props)");
      assertSerializableProps(props, "res.notFound(props)");
      return terminal({
        kind: "not-found",
        status: 404,
        headers: snapshotHeaders(pendingHeaders),
        props,
      });
    },
  };

  return response;
}

/** Return whether a handler value came from one of Goribu's terminal helpers. */
export function isResponseResult(value) {
  return Boolean(value) && value[RESPONSE_RESULT] === true;
}

function terminal(result) {
  Object.defineProperty(result, RESPONSE_RESULT, { value: true });
  return Object.freeze(result);
}

function assertStatus(code, source) {
  if (!Number.isInteger(code) || code < 200 || code > 599) {
    throw new RangeError(
      `[Goribu] ${source} requires an integer HTTP status from 200 through 599. ` +
        `Received ${String(code)}.`,
    );
  }
}

function assertNoExtraArguments(args, signature, options = {}) {
  if (args.length <= 1) return;

  const repair = options.statusRepair
    ? `Set an explicit redirect status with res.status(code).redirect(location).`
    : `Set the status by chaining res.status(code).${signature.slice("res.".length)}.`;
  throw new TypeError(
    `[Goribu] ${signature} does not accept a status or options argument. ${repair}`,
  );
}

function assertLocation(location) {
  if (typeof location !== "string" || location.length === 0) {
    throw new TypeError(
      "[Goribu] res.redirect(location) requires a non-empty URL or path string. " +
        "Pass a destination such as \"/dashboard\".",
    );
  }

  validateHeader("location", location);
}

function mergeHeaders(target, headers) {
  if (!isPlainObject(headers)) {
    throw new TypeError(
      "[Goribu] res.headers(headers) requires a plain object whose values are strings or arrays of strings. " +
        "Pass headers such as { \"cache-control\": \"no-store\" }.",
    );
  }

  for (const name of Object.keys(headers)) {
    const value = headers[name];
    if (
      typeof value !== "string" &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new TypeError(
        `[Goribu] Response header "${name}" must be a string or an array of strings. ` +
          "Convert numbers and other values to strings before calling res.headers().",
      );
    }

    const normalizedName = validateHeader(name, value);
    target.set(
      normalizedName,
      Array.isArray(value) ? Object.freeze([...value]) : value,
    );
  }
}

function validateHeader(name, value) {
  try {
    const validator = new Headers();
    validator.set(name, "");
    for (const item of Array.isArray(value) ? value : [value]) {
      validator.append(name, item);
    }
    return [...validator.keys()][0];
  } catch (cause) {
    throw new TypeError(
      `[Goribu] Invalid response header "${name}". ` +
        "Use a valid HTTP header name and values without line breaks.",
      { cause },
    );
  }
}

function snapshotHeaders(pendingHeaders, frameworkHeaders = {}) {
  const snapshot = new Map();

  for (const [name, value] of Object.entries(frameworkHeaders)) {
    snapshot.set(name, value);
  }
  for (const [name, value] of pendingHeaders) {
    snapshot.set(name, value);
  }

  // Redirect destinations are explicit terminal intent and must override a
  // previously chained Location header.
  if (Object.hasOwn(frameworkHeaders, "location")) {
    snapshot.set("location", frameworkHeaders.location);
  }

  const headers = {};
  for (const [name, value] of snapshot) {
    Object.defineProperty(headers, name, {
      enumerable: true,
      value: Array.isArray(value) ? Object.freeze([...value]) : value,
    });
  }
  return Object.freeze(headers);
}

function serializeJson(data, source) {
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) {
      throw new TypeError("top-level value has no JSON representation");
    }
    return serialized;
  } catch (cause) {
    const repair =
      source === "res.json(data)"
        ? "Pass a JSON-serializable value without BigInt or circular references."
        : "Pass JSON-serializable error messages without BigInt or circular references.";
    throw new TypeError(
      `[Goribu] ${source} could not serialize the response body. ${repair}`,
      { cause },
    );
  }
}

function normalizeFormErrors(errors, development) {
  const normalized = typeof errors === "string" ? { root: errors } : errors;
  if (!isPlainObject(normalized)) {
    throw new TypeError(
      "[Goribu] res.invalid(errors, status) requires a message string or a plain object of field names to messages. Pass a string for a form-level error or an object such as { email: \"Enter a valid email.\" }.",
    );
  }

  if (development) {
    const nonStringKeys = Object.keys(normalized).filter(
      (key) => typeof normalized[key] !== "string",
    );
    if (nonStringKeys.length > 0) {
      try {
        console.warn(
          `[Goribu] res.invalid(errors, status) received non-string messages for ${nonStringKeys.map((key) => JSON.stringify(key)).join(", ")}. Form error values should be strings.`,
        );
      } catch {
        // A development warning must not replace the route response.
      }
    }
  }

  return normalized;
}

function assertFormRenderPath(context) {
  if (context === null) return;

  const actionPathname = context?.actionPathname;
  const displayedPathname = context?.displayedPathname;
  if (
    typeof actionPathname === "string" &&
    typeof displayedPathname === "string" &&
    actionPathname === displayedPathname
  ) {
    return;
  }

  const displayed =
    typeof displayedPathname === "string"
      ? JSON.stringify(displayedPathname)
      : "an unverified pathname";
  const action =
    typeof actionPathname === "string"
      ? JSON.stringify(actionPathname)
      : "an unknown action pathname";
  throw new Error(
    `[Goribu] res.render(props) cannot re-render ${displayed} from a form action handled at ${action}. ` +
      "Enhanced form rendering is allowed only when a parseable same-origin Referer has exactly the request pathname. " +
      "Return res.redirect() to move to another page, or res.json() to return data without replacing the displayed page.",
  );
}

function assertPropsObject(props, source) {
  if (!isPlainObject(props)) {
    throw new TypeError(
      `[Goribu] ${source} requires props to be a plain object. ` +
        "Pass an object, or call the helper without an argument when no props are needed.",
    );
  }
}

function assertSerializableProps(props, source) {
  const prefix = `[Goribu] ${source} requires JSON-serializable props.`;

  try {
    JSON.stringify(props, function validateValue(key, value) {
      // Optional object properties naturally disappear from JSON and remain
      // `undefined` when read by React. Array entries are different: JSON turns
      // them into `null`, so reject those rather than silently changing data.
      const isOmittedOptionalProperty =
        value === undefined && key !== "" && !Array.isArray(this);

      if (
        (!isOmittedOptionalProperty && value === undefined) ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint"
      ) {
        const property = key === "" ? "the root value" : `property "${key}"`;
        throw new TypeError(
          `${prefix} ${property} is ${value === undefined ? "undefined" : typeof value}. ` +
            "Remove it or convert it to JSON data before returning the response.",
        );
      }
      return value;
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(prefix)) throw cause;
    throw new TypeError(
      `${prefix} Remove circular references and pass only data that JSON.stringify can encode.`,
      { cause },
    );
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

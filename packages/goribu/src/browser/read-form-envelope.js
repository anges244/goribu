import { hasFormMediaType } from "../forms/form-protocol.js";
import { normalizeRouteMeta } from "../metadata/route-meta.js";

/** Parse and validate one negotiated form response without consuming the original. */
export async function readFormEnvelope(response) {
  if (!(response instanceof Response)) {
    throw new TypeError(
      "[Goribu] Cannot read a form response because fetch did not return a Web Response. Pass the Response returned by fetch() directly to readFormEnvelope().",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!hasFormMediaType(contentType)) {
    throw new TypeError(
      `[Goribu] Form submission returned ${JSON.stringify(contentType || "no Content-Type")} instead of Goribu's form response media type. Return res.json(), res.invalid(), res.redirect(), or res.render() from the Form action so the Worker can negotiate a form envelope, or use a plain form for this response.`,
    );
  }

  let payload;
  try {
    payload = await response.clone().json();
  } catch (cause) {
    throw new SyntaxError(
      "[Goribu] Form submission returned a malformed form response body. Return the result through res.json(), res.invalid(), res.redirect(), or res.render() instead of writing the form protocol body by hand.",
      { cause },
    );
  }

  if (!isPlainObject(payload) || typeof payload.type !== "string") {
    throw invalidEnvelope("a type-tagged object");
  }

  if (payload.type === "reload") {
    return Object.freeze({ type: "reload" });
  }

  if (payload.type === "json") {
    if (!Object.hasOwn(payload, "data")) {
      throw invalidEnvelope('JSON data shaped as { type: "json", data }');
    }
    return Object.freeze({ type: "json", data: payload.data });
  }

  if (payload.type === "invalid") {
    if (!isFormErrors(payload.errors)) {
      throw invalidEnvelope(
        'validation data shaped as { type: "invalid", errors: Record<string, string> }',
      );
    }
    return Object.freeze({
      type: "invalid",
      errors: Object.freeze({ ...payload.errors }),
    });
  }

  if (payload.type === "redirect") {
    if (typeof payload.to !== "string" || payload.to.length === 0) {
      throw invalidEnvelope(
        'redirect data shaped as { type: "redirect", to: "/destination" }',
      );
    }
    return Object.freeze({ type: "redirect", to: payload.to });
  }

  if (payload.type === "render") {
    if (
      typeof payload.route !== "string" ||
      payload.route.length === 0 ||
      !isPlainObject(payload.props) ||
      !Object.hasOwn(payload, "meta")
    ) {
      throw invalidEnvelope(
        'render data shaped as { type: "render", route, props, meta }',
      );
    }
    return Object.freeze({
      type: "render",
      routeId: payload.route,
      props: Object.freeze({ ...payload.props }),
      meta: normalizeRouteMeta(payload.meta, {
        source: "Form render metadata",
      }),
    });
  }

  throw invalidEnvelope('type "json", "invalid", "redirect", "render", or "reload"');
}

function invalidEnvelope(expectation) {
  return new TypeError(
    `[Goribu] Form submission returned an invalid envelope; expected ${expectation}. Rebuild the Worker and client together so they use the same protocol.`,
  );
}

function isFormErrors(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((message) => typeof message === "string");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

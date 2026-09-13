import { isFormMutationMethod } from "./form-protocol.js";

/** Normalize and fail closed on every unsupported Form method. */
export function normalizeFormMethod(value) {
  if (
    typeof value !== "string" ||
    (value.toLowerCase() !== "get" && !isFormMutationMethod(value.toUpperCase()))
  ) {
    throw new TypeError(
      '[Goribu] <Form> method must be "get", "post", "put", "patch", or "delete". Set the intended method explicitly and export its matching handler from the action route.',
    );
  }
  return value.toLowerCase();
}

export function isNativeFormMethod(method) {
  return method === "get" || method === "post";
}

/** Resolve submitter overrides against the browser location at submit time. */
export function resolveEffectiveSubmission(options) {
  const currentUrl = new URL(options.currentUrl);
  const submitter = options.submitter;

  const actionValue = hasAttribute(submitter, "formaction")
    ? submitter.getAttribute("formaction")
    : options.action;
  let actionUrl;
  try {
    actionUrl = new URL(actionValue ?? currentUrl.href, currentUrl);
  } catch (cause) {
    throw new TypeError(
      `[Goribu] <Form> could not resolve action ${JSON.stringify(actionValue)} against the current URL. Pass a valid same-origin HTTP(S) URL or path.`,
      { cause },
    );
  }

  const hasMethodOverride = hasAttribute(submitter, "formmethod");
  const methodValue = hasMethodOverride
    ? submitter.getAttribute("formmethod")
    : options.method;
  if (hasMethodOverride && !isNativeFormMethod(methodValue?.toLowerCase())) {
    throw new TypeError(
      '[Goribu] <Form> submitter formmethod must be "get" or "post". Set PUT, PATCH, or DELETE on <Form method> instead so Goribu can prevent submission before hydration.',
    );
  }
  const method = normalizeFormMethod(methodValue);

  const targetValue = hasAttribute(submitter, "formtarget")
    ? submitter.getAttribute("formtarget")
    : options.target;

  return Object.freeze({
    actionUrl,
    method,
    target: typeof targetValue === "string" ? targetValue : "",
  });
}

/** Build standard successful controls and choose Form's deterministic encoding. */
export function buildFormPayload(form, submitter) {
  const formData =
    submitter === null || submitter === undefined
      ? new FormData(form)
      : new FormData(form, submitter);
  const multipart = hasEnabledNamedFileInput(form.elements);

  return Object.freeze({
    formData,
    multipart,
    body: multipart ? formData : toSearchParams(formData, false),
  });
}

/** Replace the action query with successful non-file controls and preserve its hash. */
export function createGetSubmissionUrl(actionUrl, formData) {
  const destination = new URL(actionUrl.href);
  destination.search = toSearchParams(formData, true).toString();
  return destination;
}

export function hasEnabledNamedFileInput(elements) {
  for (const control of elements) {
    if (
      control?.tagName?.toLowerCase() === "input" &&
      control.type?.toLowerCase() === "file" &&
      !isControlDisabled(control) &&
      typeof control.name === "string" &&
      control.name.length > 0
    ) {
      return true;
    }
  }
  return false;
}

export function hasNamedControl(elements, name) {
  for (const control of elements) {
    if (control?.name === name) return true;
  }
  return false;
}

function toSearchParams(formData, dropFiles) {
  const searchParams = new URLSearchParams();
  for (const [name, value] of formData) {
    if (typeof value !== "string" && dropFiles) continue;
    searchParams.append(name, String(value));
  }
  return searchParams;
}

function isControlDisabled(control) {
  if (control.disabled === true) return true;
  try {
    return typeof control.matches === "function" && control.matches(":disabled");
  } catch {
    return false;
  }
}

function hasAttribute(value, name) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.hasAttribute === "function" &&
    value.hasAttribute(name) &&
    typeof value.getAttribute === "function"
  );
}

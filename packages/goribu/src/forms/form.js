import {
  createElement as h,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { readFormEnvelope } from "../browser/read-form-envelope.js";
import {
  captureFormNavigationVersion,
  loadDocument,
  navigateForm,
  renderFormPage,
} from "../navigation/navigation-runtime.js";
import {
  FORM_FAILURE_MESSAGE,
  FORM_MEDIA_TYPE,
  hasFormMediaType,
} from "./form-protocol.js";
import {
  buildFormPayload,
  createGetSubmissionUrl,
  hasEnabledNamedFileInput,
  hasNamedControl,
  isNativeFormMethod,
  normalizeFormMethod,
  resolveEffectiveSubmission,
} from "./form-submission.js";

const DEVELOPMENT = import.meta.env?.DEV === true;

/** A real form enhanced with GET navigation and negotiated mutation responses. */
export const Form = forwardRef(function Form(props, forwardedRef) {
  const {
    action,
    children,
    encType: ignoredEncType,
    method: methodProp,
    onResult,
    onSubmit,
    replace = false,
    reset = false,
    target,
    ...formProps
  } = props ?? {};
  const method = normalizeFormMethod(methodProp);
  const requiresHydration = !isNativeFormMethod(method);

  const formRef = useRef(null);
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef(null);
  const mountedRef = useRef(false);
  const invalidMarksRef = useRef(new Map());
  const warnedRef = useRef(new Set());
  const completionRef = useRef(null);
  const completionIdRef = useRef(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [state, setState] = useState({
    pending: false,
    errors: null,
    data: null,
    revision: 0,
  });
  const [hydrated, setHydrated] = useState(false);

  const setFormRef = useCallback(
    (form) => {
      formRef.current = form;
      assignRef(forwardedRef, form);
    },
    [forwardedRef],
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    setHydrated(true);
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      completionRef.current = null;
      inFlightRef.current = false;
      clearOwnedInvalidMarks(invalidMarksRef.current);
    };
  }, []);

  useEffect(() => {
    if (ignoredEncType !== undefined) {
      warnOnce(
        warnedRef.current,
        "encType",
        "[Goribu] <Form> ignored its encType prop because Goribu renders native forms with multipart/form-data so POST submitter overrides preserve files, while enhanced requests choose encoding from enabled named file inputs. Remove encType from this Form.",
      );
    }
  }, [ignoredEncType]);

  useLayoutEffect(() => {
    const completion = completionRef.current;
    if (completion === null || completion.id !== state.revision) return;
    completionRef.current = null;
    if (
      abandonIfStale(
        completion.navigationVersion,
        completion.signal,
        completion.previousData,
      )
    ) {
      return;
    }

    const form = formRef.current;
    if (form !== null && completion.invalidErrors !== null) {
      applyInvalidErrors({
        form,
        errors: completion.invalidErrors,
        action: completion.action,
        invalidMarks: invalidMarksRef.current,
        warnings: warnedRef.current,
      });
    }
    if (form !== null && completion.shouldReset) form.reset();

    let callbackError;
    try {
      onResultRef.current?.(completion.result);
    } catch (error) {
      callbackError = error;
    } finally {
      inFlightRef.current = false;
    }

    if (mountedRef.current && completion.afterResult !== null) {
      Promise.resolve(completion.afterResult()).catch((error) => {
        console.error("[Goribu] Form result navigation failed.", error);
      });
    }
    if (callbackError !== undefined) throw callbackError;
  }, [state.revision]);

  function warnOnce(warnings, key, message) {
    if (!DEVELOPMENT || warnings.has(key)) return;
    warnings.add(key);
    console.warn(message);
  }

  function settle(completion) {
    if (!mountedRef.current || completion.signal.aborted) return;
    if (abandonIfStale(completion.navigationVersion, completion.signal)) return;
    const id = ++completionIdRef.current;
    const record = { ...completion, id, previousData: null };
    completionRef.current = record;
    setState((previous) => {
      record.previousData = previous.data;
      return {
        pending: false,
        errors: completion.errors,
        data: completion.data,
        revision: id,
      };
    });
  }

  function abandonStaleSubmission(signal, restoredData = undefined) {
    if (!mountedRef.current || signal.aborted) return;
    abortControllerRef.current = null;
    inFlightRef.current = false;
    setState((previous) => ({
      pending: false,
      errors: null,
      data: restoredData === undefined ? previous.data : restoredData,
      revision: previous.revision,
    }));
  }

  function abandonIfStale(
    navigationVersion,
    signal,
    restoredData = undefined,
  ) {
    if (
      navigationVersion === null ||
      navigationVersion === undefined ||
      navigationVersion === captureFormNavigationVersion()
    ) {
      return false;
    }
    abandonStaleSubmission(signal, restoredData);
    return true;
  }

  function failWithoutResponse(signal, navigationVersion) {
    const errors = { root: FORM_FAILURE_MESSAGE };
    settle({
      signal,
      navigationVersion,
      errors,
      data: null,
      invalidErrors: null,
      shouldReset: false,
      action: null,
      result: { ok: false, errors },
      afterResult: null,
    });
  }

  function recoverFromProtocol(
    response,
    actionUrl,
    signal,
    navigationVersion,
  ) {
    const errors = { root: FORM_FAILURE_MESSAGE };
    settle({
      signal,
      navigationVersion,
      errors,
      data: null,
      invalidErrors: null,
      shouldReset: false,
      action: actionUrl.href,
      result: { ok: false, errors, response },
      afterResult: () => loadDocument(response.url),
    });
  }

  async function submitGet(actionUrl, formData, signal) {
    const destination = createGetSubmissionUrl(actionUrl, formData);
    let navigationVersion = null;
    try {
      const navigation = navigateForm(destination.href, { replace, signal });
      navigationVersion = captureFormNavigationVersion();
      await navigation;
      if (abandonIfStale(navigationVersion, signal)) return;
      settle({
        signal,
        navigationVersion,
        errors: null,
        data: null,
        invalidErrors: null,
        shouldReset: false,
        action: destination.href,
        result: { ok: true },
        afterResult: null,
      });
    } catch {
      if (abandonIfStale(navigationVersion, signal)) return;
      failWithoutResponse(signal, navigationVersion);
    }
  }

  async function submitMutation({
    actionUrl,
    body,
    effectiveMethod,
    currentUrl,
    navigationVersion,
    signal,
  }) {
    let response;
    try {
      response = await fetch(actionUrl.href, {
        method: effectiveMethod.toUpperCase(),
        headers: { accept: FORM_MEDIA_TYPE },
        credentials: "same-origin",
        referrer: currentUrl.href,
        referrerPolicy: "same-origin",
        signal,
        body,
      });
    } catch {
      if (abandonIfStale(navigationVersion, signal)) return;
      failWithoutResponse(signal, navigationVersion);
      return;
    }
    if (!mountedRef.current || signal.aborted) return;
    if (abandonIfStale(navigationVersion, signal)) return;
    if (!hasFormMediaType(response.headers.get("content-type"))) {
      recoverFromProtocol(response, actionUrl, signal, navigationVersion);
      return;
    }

    let envelope;
    try {
      envelope = await readFormEnvelope(response);
    } catch (error) {
      reportProtocolError(error);
      if (abandonIfStale(navigationVersion, signal)) return;
      recoverFromProtocol(response, actionUrl, signal, navigationVersion);
      return;
    }
    if (!mountedRef.current || signal.aborted) return;
    if (abandonIfStale(navigationVersion, signal)) return;

    if (envelope.type === "reload") {
      settle({
        signal,
        navigationVersion,
        errors: null,
        data: null,
        invalidErrors: null,
        shouldReset: false,
        action: actionUrl.href,
        result: { ok: true, response },
        afterResult: () => {
          if (abandonIfStale(navigationVersion, signal)) return;
          // A fragment-only navigation can leave the old document in place.
          // Recovery must request the action again, including its query.
          const documentUrl = new URL(actionUrl);
          documentUrl.hash = "";
          return loadDocument(documentUrl.href, { replace });
        },
      });
      return;
    }

    if (envelope.type === "json") {
      if (response.ok) {
        settle({
          signal,
          navigationVersion,
          errors: null,
          data: envelope.data,
          invalidErrors: null,
          shouldReset: reset === true,
          action: actionUrl.href,
          result: { ok: true, data: envelope.data, response },
          afterResult: null,
        });
      } else {
        const errors = { root: FORM_FAILURE_MESSAGE };
        settle({
          signal,
          navigationVersion,
          errors,
          data: null,
          invalidErrors: null,
          shouldReset: false,
          action: actionUrl.href,
          result: {
            ok: false,
            data: envelope.data,
            errors,
            response,
          },
          afterResult: null,
        });
      }
      return;
    }

    if (envelope.type === "invalid") {
      settle({
        signal,
        navigationVersion,
        errors: envelope.errors,
        data: null,
        invalidErrors: envelope.errors,
        shouldReset: false,
        action: actionUrl.href,
        result: { ok: false, errors: envelope.errors, response },
        afterResult: null,
      });
      return;
    }

    if (envelope.type === "redirect") {
      let destination;
      try {
        destination = new URL(envelope.to, actionUrl);
      } catch {
        recoverFromProtocol(response, actionUrl, signal, navigationVersion);
        return;
      }
      if (destination.protocol !== "http:" && destination.protocol !== "https:") {
        recoverFromProtocol(response, actionUrl, signal, navigationVersion);
        return;
      }

      settle({
        signal,
        navigationVersion,
        errors: null,
        data: null,
        invalidErrors: null,
        shouldReset: false,
        action: actionUrl.href,
        result: { ok: true, response },
        afterResult: () => {
          if (abandonIfStale(navigationVersion, signal)) return;
          return navigateForm(destination.href, { replace, signal });
        },
      });
      return;
    }

    let rendered;
    try {
      rendered = await renderFormPage(
        envelope.routeId,
        envelope.props,
        envelope.meta,
        {
          signal,
          version: navigationVersion,
          recoveryUrl: actionUrl.href,
          replace,
        },
      );
    } catch {
      if (abandonIfStale(navigationVersion, signal)) return;
      recoverFromProtocol(response, actionUrl, signal, navigationVersion);
      return;
    }
    if (abandonIfStale(navigationVersion, signal)) return;
    if (rendered === false) {
      // A newer navigation owns the screen. Treat this like an unmount: clear
      // local pending state without firing effects for the superseded page.
      abandonStaleSubmission(signal);
      return;
    }
    settle({
      signal,
      navigationVersion,
      errors: null,
      data: null,
      invalidErrors: null,
      shouldReset: reset === true,
      action: actionUrl.href,
      result: { ok: true, response },
      afterResult: null,
    });
  }

  function handleSubmit(event) {
    try {
      onSubmit?.(event);
    } catch (error) {
      if (requiresHydration) event.preventDefault();
      throw error;
    }
    if (event.defaultPrevented) return;

    const form = event.currentTarget;
    const submitter = event.submitter ?? event.nativeEvent?.submitter ?? null;
    const currentUrl = new URL(globalThis.window.location.href);
    let effective;
    try {
      effective = resolveEffectiveSubmission({
        action,
        currentUrl: currentUrl.href,
        method,
        submitter,
        target,
      });
    } catch (error) {
      event.preventDefault();
      throw error;
    }

    if (!isNativeFormMethod(effective.method)) {
      // HTML cannot submit these verbs. Every exit from here must keep the
      // browser from substituting its native form method.
      event.preventDefault();
      if (
        !["http:", "https:"].includes(effective.actionUrl.protocol) ||
        effective.actionUrl.origin !== currentUrl.origin ||
        (effective.target.length > 0 && effective.target.toLowerCase() !== "_self")
      ) {
        throw new TypeError(
          `[Goribu] <Form method="${effective.method}"> requires a same-origin HTTP(S) action and target="_self". Use an action in this app and omit target or set it to "_self"; browsers cannot submit this method natively.`,
        );
      }
    }

    if (effective.actionUrl.protocol !== "http:" && effective.actionUrl.protocol !== "https:") {
      warnOnce(
        warnedRef.current,
        "non-http-action",
        `[Goribu] <Form> did not enhance ${JSON.stringify(effective.actionUrl.href)} because only HTTP(S) actions are supported. Use a plain form or the appropriate native control for this destination.`,
      );
      return;
    }
    if (effective.actionUrl.origin !== currentUrl.origin) {
      warnOnce(
        warnedRef.current,
        "cross-origin-action",
        `[Goribu] <Form> did not enhance cross-origin action ${JSON.stringify(effective.actionUrl.href)}. Use a plain form when submitting outside ${JSON.stringify(currentUrl.origin)}.`,
      );
      return;
    }
    if (
      effective.target.length > 0 &&
      effective.target.toLowerCase() !== "_self"
    ) {
      warnOnce(
        warnedRef.current,
        "non-self-target",
        `[Goribu] <Form> did not enhance target ${JSON.stringify(effective.target)} because targeted submissions remain browser-owned. Use target="_self" or omit target to enable Goribu form handling.`,
      );
      return;
    }

    if (inFlightRef.current) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    inFlightRef.current = true;
    clearOwnedInvalidMarks(invalidMarksRef.current);
    if (hasNamedControl(form.elements, "root")) {
      warnOnce(
        warnedRef.current,
        "root-control",
        "[Goribu] <Form> contains a control named \"root\", which is reserved for form-level errors. Rename the control so field and form errors cannot collide.",
      );
    }

    let payload;
    try {
      payload = buildFormPayload(form, submitter);
    } catch (error) {
      inFlightRef.current = false;
      throw error;
    }

    const abortController = new AbortController();
    const navigationVersion = captureFormNavigationVersion();
    abortControllerRef.current = abortController;
    setState((previous) => ({
      pending: true,
      errors: null,
      data: previous.data,
      revision: previous.revision,
    }));

    if (
      effective.method === "get" &&
      hasEnabledNamedFileInput(form.elements)
    ) {
      warnOnce(
        warnedRef.current,
        "get-file",
        "[Goribu] <Form method=\"get\"> cannot put file values in a URL, so file entries were omitted from this navigation. Use method=\"post\" to upload files.",
      );
    }

    if (effective.method === "get") {
      void submitGet(effective.actionUrl, payload.formData, abortController.signal);
      return;
    }

    void submitMutation({
      actionUrl: effective.actionUrl,
      body: payload.body,
      effectiveMethod: effective.method,
      currentUrl,
      navigationVersion,
      signal: abortController.signal,
    });
  }

  const visibleState = {
    pending: state.pending,
    errors: state.errors,
    data: state.data,
  };
  const content = typeof children === "function" ? children(visibleState) : children;

  if (requiresHydration && !hydrated) {
    // No form owner exists yet, including for external controls using form=id.
    // An inert wrapper keeps the content visible without offering a submission
    // that the browser would silently turn into GET or POST.
    return h("div", { ...formProps, inert: true }, content);
  }

  return h(
    "form",
    {
      ...formProps,
      action,
      encType: "multipart/form-data",
      method: requiresHydration ? "post" : method,
      target,
      ref: setFormRef,
      onSubmit: handleSubmit,
    },
    content,
  );
});

function reportProtocolError(error) {
  try {
    console.error(error);
  } catch {
    // A broken console must not block the fail-closed document recovery.
  }
}

function assignRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null && typeof ref === "object") {
    ref.current = value;
  }
}

function clearOwnedInvalidMarks(invalidMarks) {
  for (const [control, previousValue] of invalidMarks) {
    if (control.getAttribute("aria-invalid") !== "true") continue;
    if (previousValue === null) {
      control.removeAttribute("aria-invalid");
    } else {
      control.setAttribute("aria-invalid", previousValue);
    }
  }
  invalidMarks.clear();
}

function applyInvalidErrors({ form, errors, action, invalidMarks, warnings }) {
  const invalidNames = new Set(
    Object.keys(errors).filter((name) => name !== "root"),
  );

  for (const name of invalidNames) {
    const named = form.elements.namedItem(name);
    const control = firstControl(named);
    if (control === null) {
      warnDevelopmentOnce(
        warnings,
        `missing-error:${name}`,
        `[Goribu] res.invalid() returned an error for ${JSON.stringify(name)}, but <Form> action ${JSON.stringify(action)} has no matching control. Rename the error key or the control so they match.`,
      );
      continue;
    }
    if (!invalidMarks.has(control)) {
      invalidMarks.set(control, control.getAttribute("aria-invalid"));
    }
    control.setAttribute("aria-invalid", "true");
  }

  let firstInvalid = null;
  for (const control of form.elements) {
    if (invalidNames.has(control?.name)) {
      firstInvalid = control;
      break;
    }
  }
  if (firstInvalid === null) return;

  firstInvalid.focus({ preventScroll: true });
  firstInvalid.scrollIntoView?.({ block: "center" });
}

function firstControl(value) {
  if (value === null || value === undefined) return null;
  if (value.nodeType === 1) return value;
  const first = value[0] ?? value.item?.(0) ?? null;
  return first?.nodeType === 1 ? first : null;
}

function warnDevelopmentOnce(warnings, key, message) {
  if (!DEVELOPMENT || warnings.has(key)) return;
  warnings.add(key);
  console.warn(message);
}

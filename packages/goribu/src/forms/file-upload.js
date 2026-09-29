import { createElement as h, Fragment, useContext, useLayoutEffect, useRef, useState } from "react";
import { FormUploadContext, UploadHintsContext } from "./upload-context.js";
import { LocationContext } from "../navigation/location-context.js";
import { upload, UploadError } from "./upload.js";

/** A single immediate upload, represented in its Form only by a successful ref. */
export function FileUpload({ name, children }) {
  const form = useContext(FormUploadContext);
  const hints = useContext(UploadHintsContext);
  const location = useContext(LocationContext) ?? globalThis.window?.location.href;
  if (!form) throw new Error("[Goribu] <FileUpload> must be inside <Form>. Use upload() for custom UIs outside forms.");
  if (typeof name !== "string" || !name || (children !== undefined && typeof children !== "function")) {
    throw new TypeError("[Goribu] <FileUpload> requires a non-empty name and an optional render function as children.");
  }
  const input = useRef(null);
  const field = useRef({ pending: null, ref: null, controller: null, previewUrl: null, input: null });
  const [state, setState] = useState({ file: null, status: "idle", errorMessage: null, previewUrl: null });
  const action = new URL(form.action ?? location, location).href;
  let policy;
  if (hints?.action && location) {
    const target = new URL(action ?? location, location);
    const source = new URL(hints.action);
    if (target.origin === source.origin && target.pathname === source.pathname && Object.hasOwn(hints.uploads ?? {}, name)) policy = hints.uploads[name];
  }

  function clear() {
    const current = field.current;
    current.controller?.abort();
    if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
    current.controller = null;
    current.previewUrl = null;
    current.pending = null;
    current.ref = null;
  }

  useLayoutEffect(() => {
    const current = field.current;
    current.input = input.current;
    const unregister = form.register(name, current);
    function reset() {
      clear();
      setState({ file: null, status: "idle", errorMessage: null, previewUrl: null });
      form.changed();
    }
    const element = input.current.form;
    element?.addEventListener("reset", reset);
    reset();
    return () => {
      element?.removeEventListener("reset", reset);
      clear();
      unregister();
    };
  }, [form.register, action, name]);

  function pick(file) {
    if (!file) return;
    clear();
    const current = field.current;
    const controller = new AbortController();
    current.controller = controller;
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    current.previewUrl = previewUrl;
    const selected = { file, previewUrl, status: "uploading", errorMessage: null };
    setState(selected);
    const destination = action;
    current.action = destination;
    current.pending = (async () => {
      try {
        const type = file.type || "application/octet-stream";
        if (policy && !policy.accept.some((item) => item === type || (item.endsWith("/*") && type.startsWith(item.slice(0, -1))))) throw new UploadError("type");
        if (file.size <= 0 || (policy && file.size > policy.maxBytes)) throw new UploadError("size", { maxBytes: policy?.maxBytes });
        const ref = await upload(file, { action: destination, name, signal: controller.signal });
        if (controller.signal.aborted) return;
        current.ref = ref;
        setState({ ...selected, status: "done" });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ ...selected, status: "error", errorMessage: error.message });
      }
    })().finally(() => {
      if (current.controller !== controller) return;
      current.pending = null;
      form.changed();
    });
    form.changed();
  }

  const values = { ...state,
    showPicker() {
      if (typeof input.current.showPicker === "function") input.current.showPicker();
      else input.current.click();
    },
    dropProps: {
      onDragOver(event) { event.preventDefault(); },
      onDrop(event) { event.preventDefault(); pick(event.dataTransfer.files[0]); },
    },
  };
  return h(Fragment, null,
    h("input", { type: "file", hidden: !!children, accept: policy?.accept.join(","), ref: input,
      onChange(event) { pick(event.currentTarget.files[0]); event.currentTarget.value = ""; } }),
    h("input", { type: "hidden", name, value: field.current.ref ?? "", disabled: !field.current.ref }),
    children ? children(values) : h("span", { role: "status" }, state.errorMessage ?? (state.status === "uploading" ? "Uploading…" : state.status === "done" ? "Uploaded." : "")),
  );
}

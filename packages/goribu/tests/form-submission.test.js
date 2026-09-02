/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  buildFormPayload,
  createGetSubmissionUrl,
  normalizeFormMethod,
  resolveEffectiveSubmission,
} from "../src/forms/form-submission.js";

describe("Form submission primitives", () => {
  it("resolves at submit time and honors raw submitter overrides", () => {
    const button = document.createElement("button");
    button.setAttribute("formaction", "../publish?draft=1#result");
    button.setAttribute("formmethod", "POST");
    button.setAttribute("formtarget", "_self");

    const effective = resolveEffectiveSubmission({
      action: "/stale",
      currentUrl: "https://example.com/posts/42/edit?tab=content",
      method: "get",
      submitter: button,
      target: "_blank",
    });

    expect(effective.actionUrl.href).toBe(
      "https://example.com/posts/publish?draft=1#result",
    );
    expect(effective.method).toBe("post");
    expect(effective.target).toBe("_self");
  });

  it("defaults action to the current URL and fails closed on every bad method", () => {
    expect(
      resolveEffectiveSubmission({
        currentUrl: "https://example.com/current?view=full#details",
        method: "POST",
        submitter: null,
      }),
    ).toMatchObject({
      method: "post",
      actionUrl: new URL("https://example.com/current?view=full#details"),
    });

    expect(() => normalizeFormMethod(undefined)).toThrow(
      '<Form> method must be "get" or "post"',
    );
    for (const method of ["put", "patch", "delete", "trace"]) {
      expect(() => normalizeFormMethod(method)).toThrow(
        'Use "get" for URL navigation or "post" for mutations',
      );
    }
  });

  it("rejects unsupported submitter formmethod overrides with a repair", () => {
    const button = document.createElement("button");
    button.setAttribute("formmethod", "delete");

    expect(() => {
      resolveEffectiveSubmission({
        currentUrl: "https://example.com/current",
        method: "post",
        submitter: button,
      });
    }).toThrow(
      '[Goribu] <Form> submitter formmethod must be "get" or "post"',
    );
  });

  it("uses native successful controls including the submitter and external controls", () => {
    document.body.innerHTML = `
      <form id="editor">
        <input name="tag" value="one">
        <input name="tag" value="two">
        <input name="ignored" value="no" disabled>
        <input name="unchecked" type="checkbox">
        <input name="checked" type="checkbox" checked>
        <button name="intent" value="save">Save</button>
      </form>
      <input form="editor" name="outside" value="included">
    `;
    const form = document.querySelector("form");
    const button = document.querySelector("button");

    const payload = buildFormPayload(form, button);

    expect(payload.multipart).toBe(false);
    expect(payload.formData.getAll("tag")).toEqual(["one", "two"]);
    expect(payload.formData.get("intent")).toBe("save");
    expect(payload.formData.get("outside")).toBe("included");
    expect(payload.formData.has("ignored")).toBe(false);
    expect(payload.formData.has("unchecked")).toBe(false);
    expect(payload.formData.get("checked")).toBe("on");
    expect(payload.body.getAll("tag")).toEqual(["one", "two"]);
  });

  it("uses multipart for an empty successful file input but ignores disabled file controls", () => {
    document.body.innerHTML = `
      <form>
        <input name="attachment" type="file">
        <fieldset disabled>
          <input name="disabledByFieldset" type="file">
        </fieldset>
        <input name="directlyDisabled" type="file" disabled>
        <input type="file">
      </form>
    `;
    const form = document.querySelector("form");

    expect(buildFormPayload(form, null).multipart).toBe(true);

    form.elements.namedItem("attachment").disabled = true;
    const payload = buildFormPayload(form, null);
    expect(payload.multipart).toBe(false);
    expect(payload.body).toBeInstanceOf(URLSearchParams);
  });

  it("chooses multipart from file-input presence and explicitly drops files from GET", () => {
    document.body.innerHTML = `
      <form>
        <input name="q" value="goribu">
        <input name="attachment" type="file">
      </form>
    `;
    const form = document.querySelector("form");
    const fileInput = form.elements.namedItem("attachment");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["hello"], "hello.txt", { type: "text/plain" })],
    });

    const payload = buildFormPayload(form, null);
    const destination = createGetSubmissionUrl(
      new URL("https://example.com/search?old=1#results"),
      payload.formData,
    );

    expect(payload.multipart).toBe(true);
    expect(payload.body).toBe(payload.formData);
    expect(destination.href).toBe(
      "https://example.com/search?q=goribu#results",
    );
  });
});

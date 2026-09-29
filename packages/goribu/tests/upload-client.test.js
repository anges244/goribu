/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { upload, UploadError } from "../src/index.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const file = () => new File(["data"], "a.png", { type: "image/png" });
const start = (url = "/_goribu/r2/upload?ref=signed") => Response.json({ ref: "signed", target: { url, method: "PUT", headers: { "content-type": "image/png", "if-none-match": "*", "x-amz-meta-goribu-upload": "id" } } });
it.each(["/_goribu/r2/upload?ref=signed", "https://example.r2.cloudflarestorage.com/bucket/key?signed=yes"])("starts with cookies and sends only the target's headers and bytes to %s", async (destination) => {
  const fetch = vi.fn().mockResolvedValueOnce(start(destination)).mockResolvedValueOnce(new Response());
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal, chosen = file();
  expect(await upload(chosen, { action: "/save?mode=one", name: "avatar", signal })).toBe("signed");
  const [action, init] = fetch.mock.calls[0];
  expect(action).toBe(new URL("/save?mode=one", window.location.href).href);
  expect(init).toMatchObject({ method: "POST", signal, credentials: "same-origin", redirect: "manual", headers: { "x-goribu-upload": "avatar", "content-type": "application/json" } });
  expect(JSON.parse(init.body)).toEqual({ name: "a.png", type: "image/png", size: 4 });
  expect(fetch.mock.calls[1][0]).toBe(new URL(destination, window.location.href).href);
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: chosen, signal, credentials: "omit", redirect: "error" });
  expect(fetch.mock.calls[1][1].headers).not.toHaveProperty("content-length");
});
it("maps refusals, network failures, malformed targets and expired PUTs without retry or raw diagnostics", async () => {
  for (const [response, code] of [[Response.json({ code: "type" }, { status: 400 }), "type"], [Response.json({ code: "size" }, { status: 400 }), "size"], [new Response("private diagnostic", { status: 403 }), "forbidden"], [new Response(null, { status: 302 }), "forbidden"], [Response.json({ broken: true }), "server"]]) {
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
    await expect(upload(file(), { action: "/save", name: "avatar" })).rejects.toMatchObject({ name: "UploadError", code });
    expect(fetch).toHaveBeenCalledOnce();
  }
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network diagnostic")));
  await expect(upload(file(), { action: "/save", name: "avatar" })).rejects.toMatchObject({ code: "network", message: "The upload failed. Try again." });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(start()).mockResolvedValueOnce(Response.json({ code: "expired" }, { status: 403 })));
  await expect(upload(file(), { action: "/save", name: "avatar" })).rejects.toMatchObject({ code: "expired" });
});
it("rejects an external action before sending metadata", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(upload(file(), { action: "https://external.example/upload", name: "avatar" })).rejects.toBeInstanceOf(UploadError);
  expect(fetch).not.toHaveBeenCalled();
});

it("uses a valid server size limit and ignores invalid error details", async () => {
  for (const [maxBytes, message] of [[5_000_000, "This file is too large. The limit is 5 MB."],
    [2_000_000_000, "This file is too large. The limit is 2 GB."],
    ["private diagnostic", "This file is too large."], [0, "This file is too large."], [-5, "This file is too large."]]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ code: "size", maxBytes }, { status: 400 })));
    await expect(upload(file(), { action: "/save", name: "avatar" })).rejects.toMatchObject({ code: "size", message });
  }
});
it("keeps all end-user messages exact and unprefixed", () => {
  for (const [code, message] of Object.entries({ type: "This file type isn't allowed.", size: "This file is too large.",
    forbidden: "You don't have permission to upload here.", network: "The upload failed. Try again.",
    expired: "The upload took too long. Try again.", server: "Something went wrong. Try again." })) {
    expect(new UploadError(code).message).toBe(message);
  }
});

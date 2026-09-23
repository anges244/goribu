import { afterEach, describe, expect, it, vi } from "vitest";
import { Link } from "../src/navigation/link.js";
import {
  installNavigationRuntime,
  navigate,
} from "../src/navigation/navigation-runtime.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Link", () => {
  it("enhances exact-current-URL clicks without prefetching them", async () => {
    const runtime = navigationRuntime();
    const uninstall = installNavigationRuntime(runtime);
    vi.stubGlobal("window", browserWindow("https://example.com/"));
    try {
      const element = Link({ href: "/" });
      element.props.onPointerEnter(pointerEvent());
      element.props.onPointerDown(pointerEvent());
      const event = pointerEvent();
      element.props.onClick(event);
      await Promise.resolve();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(runtime.navigate).toHaveBeenCalledWith("/", { replace: false });
      expect(runtime.prefetch).not.toHaveBeenCalled();
      expect(runtime.schedulePrefetch).not.toHaveBeenCalled();
    } finally { uninstall(); }
  });
  it("renders a real anchor and enhances one eligible click", async () => {
    const runtime = navigationRuntime();
    const uninstall = installNavigationRuntime(runtime);
    vi.stubGlobal("window", browserWindow("https://example.com/current"));

    try {
      const userClick = vi.fn();
      const element = Link({
        href: "/posts",
        replace: true,
        prefetch: false,
        className: "link",
        onClick: userClick,
      });
      const event = pointerEvent();

      expect(element.type).toBe("a");
      expect(element.props.href).toBe("/posts");
      expect(element.props.className).toBe("link");
      expect(element.props).not.toHaveProperty("replace");
      expect(element.props).not.toHaveProperty("prefetch");

      element.props.onClick(event);
      await Promise.resolve();

      expect(userClick).toHaveBeenCalledWith(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(runtime.navigate).toHaveBeenCalledWith("/posts", { replace: true });
    } finally {
      uninstall();
    }
  });

  it("leaves browser-owned and user-cancelled clicks untouched", () => {
    const runtime = navigationRuntime();
    const uninstall = installNavigationRuntime(runtime);
    vi.stubGlobal("window", browserWindow("https://example.com/posts#top"));

    try {
      const cases = [
        [{ href: "https://other.example/posts" }, pointerEvent()],
        [{ href: "/posts#comments" }, pointerEvent()],
        [{ href: "#" }, pointerEvent()],
        [{ href: "/next", target: "_blank" }, pointerEvent()],
        [{ href: "/download", download: true }, pointerEvent()],
        [{ href: "/next" }, pointerEvent({ button: 1 })],
        [{ href: "/next" }, pointerEvent({ metaKey: true })],
        [
          {
            href: "/next",
            onClick(event) {
              event.defaultPrevented = true;
            },
          },
          pointerEvent(),
        ],
      ];

      for (const [props, event] of cases) {
        Link(props).props.onClick(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(runtime.saveScroll).toHaveBeenCalledTimes(5);
    } finally {
      uninstall();
    }
  });

  it("schedules intent prefetch, cancels leave, and starts on pointer down", async () => {
    const runtime = navigationRuntime();
    const uninstall = installNavigationRuntime(runtime);
    vi.stubGlobal("window", browserWindow("https://example.com/"));

    try {
      const element = Link({ href: "/posts" });
      element.props.onPointerEnter(pointerEvent({ button: -1 }));
      expect(runtime.schedulePrefetch).toHaveBeenCalledWith("/posts");

      element.props.onPointerLeave(pointerEvent());
      expect(runtime.cancelPrefetch).toHaveBeenCalledWith("/posts");

      element.props.onPointerDown(pointerEvent());
      await Promise.resolve();
      expect(runtime.cancelPrefetch).toHaveBeenCalledTimes(2);
      expect(runtime.prefetch).toHaveBeenCalledWith("/posts");
    } finally {
      uninstall();
    }
  });

  it("does not prefetch links whose clicks remain browser-owned", async () => {
    const runtime = navigationRuntime();
    const uninstall = installNavigationRuntime(runtime);
    vi.stubGlobal("window", browserWindow("https://example.com/posts#top"));

    try {
      for (const props of [
        { href: "https://other.example/posts" },
        { href: "/posts#comments" },
        { href: "/next", target: "_blank" },
        { href: "/download", download: true },
      ]) {
        const element = Link(props);
        element.props.onPointerEnter(pointerEvent({ button: -1 }));
        element.props.onPointerDown(pointerEvent());
      }
      await Promise.resolve();

      expect(runtime.schedulePrefetch).not.toHaveBeenCalled();
      expect(runtime.prefetch).not.toHaveBeenCalled();
    } finally {
      uninstall();
    }
  });

  it("uses a safe full document load when navigate runs before bootstrap", async () => {
    const window = browserWindow("https://example.com/");
    vi.stubGlobal("window", window);

    await navigate("/login", { replace: true });
    expect(window.location.replace).toHaveBeenCalledWith("/login");

    await expect(navigate("javascript:alert(1)")).rejects.toThrow(
      'because "javascript:" URLs are not supported',
    );
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});

function navigationRuntime() {
  return {
    navigate: vi.fn(() => Promise.resolve()),
    renderInPlace: vi.fn(() => Promise.resolve(true)),
    captureVersion: vi.fn(() => 0),
    prefetch: vi.fn(() => Promise.resolve()),
    schedulePrefetch: vi.fn(),
    cancelPrefetch: vi.fn(),
    saveScroll: vi.fn(),
    dispose: vi.fn(),
  };
}

function browserWindow(href) {
  return {
    location: {
      href,
      assign: vi.fn(),
      replace: vi.fn(),
    },
  };
}

function pointerEvent(overrides = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

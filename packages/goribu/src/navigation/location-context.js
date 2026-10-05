import { Component, createContext, createElement as h, useLayoutEffect } from "react";

import { UploadHintsContext } from "../forms/upload-context.js";

/** Internal request/browser location shared by SSR, hydration, and route swaps. */
export const LocationContext = createContext(null);

/** Render one route page under the location value observed by NavLink. */
export function createLocatedPage(Page, props, location, onCommit, onError, onCommitStart, uploadHints) {
  return h(PageErrorBoundary, { onError, onCommitStart },
    h(LocatedPage, { Page, pageProps: props, location, onCommit, uploadHints }),
  );
}

// root.render() schedules work; its try/catch cannot see a later render error.
// Report those errors to the waiting controller without changing successful
// page identity. A subsequent root render may retry after an in-place failure.
class PageErrorBoundary extends Component {
  state = { children: this.props.children, failed: false };

  static getDerivedStateFromProps({ children }, state) {
    return children === state.children ? null : { children, failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  getSnapshotBeforeUpdate() {
    // Take ownership before mutations can remove the submitting Form. Even a
    // successful render can throw in a layout effect after that Form is gone.
    this.props.onCommitStart?.();
    return null;
  }

  componentDidUpdate() {
    // React requires this lifecycle alongside getSnapshotBeforeUpdate.
  }

  componentDidCatch(error) {
    if (this.props.onError?.(error) !== true) throw error;
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LocatedPage({ Page, pageProps, location, onCommit, uploadHints }) {
  // Keep the same component tree for SSR, hydration and subsequent renders.
  // Let descendants finish synchronous layout-effect updates, then use the
  // committed destination DOM before the browser gets a chance to paint.
  useLayoutEffect(() => {
    if (onCommit !== undefined) queueMicrotask(onCommit);
  }, [onCommit]);
  // A different path starts the page fresh, as a document load would, so state
  // seeded from one entry's props never carries into another. The same path,
  // including a query change, refresh or Form render, updates in place.
  const key = typeof location === "string" ? new URL(location).pathname : undefined;
  return h(
    LocationContext.Provider,
    { value: typeof location === "string" ? location : null },
    h(UploadHintsContext.Provider, { value: uploadHints ?? null }, h(Page, { ...pageProps, key })),
  );
}

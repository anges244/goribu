import { Component, createContext, createElement as h, useLayoutEffect } from "react";

/** Internal request/browser location shared by SSR, hydration, and route swaps. */
export const LocationContext = createContext(null);

/** Render one route page under the location value observed by NavLink. */
export function createLocatedPage(Page, props, location, onCommit, onError) {
  return h(PageErrorBoundary, { onError },
    h(LocatedPage, { Page, pageProps: props, location, onCommit }),
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

  componentDidCatch(error) {
    if (this.props.onError?.(error) !== true) throw error;
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LocatedPage({ Page, pageProps, location, onCommit }) {
  // Keep the same component tree for SSR, hydration and subsequent renders.
  // Let descendants finish synchronous layout-effect updates, then use the
  // committed destination DOM before the browser gets a chance to paint.
  useLayoutEffect(() => {
    if (onCommit !== undefined) queueMicrotask(onCommit);
  }, [onCommit]);
  return h(
    LocationContext.Provider,
    { value: typeof location === "string" ? location : null },
    h(Page, pageProps),
  );
}

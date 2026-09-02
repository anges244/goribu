import { createContext, createElement as h } from "react";

/** Internal request/browser location shared by SSR, hydration, and route swaps. */
export const LocationContext = createContext(null);

/** Render one route page under the location value observed by NavLink. */
export function createLocatedPage(Page, props, location) {
  return h(
    LocationContext.Provider,
    { value: typeof location === "string" ? location : null },
    h(Page, props),
  );
}

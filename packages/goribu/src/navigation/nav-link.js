import { createElement as h, useContext } from "react";
import { Link } from "./link.js";
import { LocationContext } from "./location-context.js";

/** A Link whose active state follows the current route pathname. */
export function NavLink(props) {
  const location = useContext(LocationContext) ?? globalThis.window?.location?.href ?? null;
  const {
    end = false,
    className,
    "aria-current": ignoredAriaCurrent,
    ...linkProps
  } = props ?? {};
  void ignoredAriaCurrent;

  const isActive = isNavLinkActive({
    currentLocation: location,
    href: linkProps.href,
    end,
  });
  const resolvedClassName =
    typeof className === "function" ? className({ isActive }) : className;

  return h(Link, {
    ...linkProps,
    className: resolvedClassName,
    "aria-current": isActive ? "page" : undefined,
  });
}

export function isNavLinkActive(options) {
  const currentLocation = options?.currentLocation;
  const href = options?.href;
  const end = options?.end === true;
  if (
    typeof currentLocation !== "string" ||
    currentLocation.length === 0 ||
    typeof href !== "string" ||
    href.length === 0
  ) {
    return false;
  }

  const fallbackOrigin = "https://goribu.invalid";
  let current;
  let destination;
  try {
    current = new URL(currentLocation, fallbackOrigin);
    destination = new URL(href, current);
  } catch {
    return false;
  }
  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.origin !== current.origin
  ) {
    return false;
  }

  const currentPath = normalizePathname(current.pathname);
  const destinationPath = normalizePathname(destination.pathname);
  if (currentPath === destinationPath) return true;
  if (end || destinationPath === "/") return false;
  return currentPath.startsWith(`${destinationPath}/`);
}

function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

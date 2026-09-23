import { createElement as h } from "react";
import {
  cancelNavigationPrefetch,
  navigate,
  prefetchNavigation,
  saveNavigationScroll,
  scheduleNavigationPrefetch,
} from "./navigation-runtime.js";

/** A real anchor that enhances eligible same-origin clicks after bootstrap. */
export function Link(props) {
  const {
    replace = false,
    prefetch = true,
    onClick,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    ...anchorProps
  } = props ?? {};
  const href = anchorProps.href;

  return h("a", {
    ...anchorProps,
    onClick(event) {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (!shouldEnhanceLinkClick(event, anchorProps)) {
        if (isPrimaryUnmodifiedPointer(event)) saveNavigationScroll();
        return;
      }

      event.preventDefault();
      void navigate(href, { replace }).catch((error) => {
        console.error("[Goribu] Client link navigation failed.", error);
      });
    },
    onPointerEnter(event) {
      onPointerEnter?.(event);
      if (
        !event.defaultPrevented &&
        prefetch !== false &&
        shouldPrefetchLink(event, anchorProps, false)
      ) {
        scheduleNavigationPrefetch(href);
      }
    },
    onPointerLeave(event) {
      onPointerLeave?.(event);
      if (!event.defaultPrevented && prefetch !== false) {
        cancelNavigationPrefetch(href);
      }
    },
    onPointerDown(event) {
      onPointerDown?.(event);
      if (
        !event.defaultPrevented &&
        prefetch !== false &&
        shouldPrefetchLink(event, anchorProps, true)
      ) {
        cancelNavigationPrefetch(href);
        void prefetchNavigation(href);
      }
    },
  });
}

export function shouldEnhanceLinkClick(event, anchorProps) {
  return (
    isPrimaryUnmodifiedPointer(event) &&
    resolveEnhanceableDestination(anchorProps) !== null
  );
}

function shouldPrefetchLink(event, anchorProps, requirePrimaryButton) {
  const destination = resolveEnhanceableDestination(anchorProps);
  return (
    hasNoModifiers(event) &&
    (!requirePrimaryButton || event.button === undefined || event.button === 0) &&
    destination !== null && destination.href !== globalThis.window?.location?.href
  );
}

function resolveEnhanceableDestination(anchorProps) {
  if (anchorProps.download !== undefined && anchorProps.download !== false) {
    return null;
  }

  const target = anchorProps.target;
  if (
    typeof target === "string" &&
    target.length > 0 &&
    target.toLowerCase() !== "_self"
  ) {
    return null;
  }

  const href = anchorProps.href;
  const currentHref = globalThis.window?.location?.href;
  if (
    typeof href !== "string" ||
    href.length === 0 ||
    typeof currentHref !== "string"
  ) {
    return null;
  }

  let current;
  let destination;
  try {
    current = new URL(currentHref);
    destination = new URL(href, current);
  } catch {
    return null;
  }

  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.origin !== current.origin
  ) {
    return null;
  }

  // Native same-document hash behavior already handles focus and scrolling.
  if (
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.href.includes("#")
  ) {
    return null;
  }

  return destination;
}

function isPrimaryUnmodifiedPointer(event) {
  return (event.button === undefined || event.button === 0) && hasNoModifiers(event);
}

function hasNoModifiers(event) {
  return (
    event.metaKey !== true &&
    event.ctrlKey !== true &&
    event.shiftKey !== true &&
    event.altKey !== true
  );
}

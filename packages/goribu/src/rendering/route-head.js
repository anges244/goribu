import { Fragment, createElement as h } from "react";

export const ROUTE_HEAD_MARKER = "data-goribu-head";

/** Turn normalized route metadata into the framework-owned Document head set. */
export function createRouteHead(metadata) {
  const tags = [
    h(
      "title",
      { key: "title", [ROUTE_HEAD_MARKER]: "" },
      metadata?.title ?? "",
    ),
  ];

  if (Object.hasOwn(metadata, "description")) {
    tags.push(
      h("meta", {
        key: "description",
        name: "description",
        content: metadata.description,
        [ROUTE_HEAD_MARKER]: "",
      }),
    );
  }
  if (Object.hasOwn(metadata, "canonical")) {
    tags.push(
      h("link", {
        key: "canonical",
        rel: "canonical",
        href: metadata.canonical,
        [ROUTE_HEAD_MARKER]: "",
      }),
    );
  }
  if (Object.hasOwn(metadata, "robots")) {
    tags.push(
      h("meta", {
        key: "robots",
        name: "robots",
        content: metadata.robots,
        [ROUTE_HEAD_MARKER]: "",
      }),
    );
  }

  for (const [index, descriptor] of (metadata?.meta ?? []).entries()) {
    tags.push(
      h("meta", {
        key: `meta:${index}`,
        ...descriptor,
        [ROUTE_HEAD_MARKER]: "",
      }),
    );
  }
  for (const [index, descriptor] of (metadata?.links ?? []).entries()) {
    tags.push(
      h("link", {
        key: `link:${index}`,
        ...descriptor,
        [ROUTE_HEAD_MARKER]: "",
      }),
    );
  }

  return h(Fragment, null, ...tags);
}

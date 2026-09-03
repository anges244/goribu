import { ROUTE_HEAD_MARKER } from "../rendering/route-head.js";

/** Atomically replace only the route-owned portion of the browser document head. */
export function applyDocumentMeta(metadata, browserDocument = globalThis.document) {
  if (
    browserDocument === null ||
    typeof browserDocument !== "object" ||
    browserDocument.head === null ||
    typeof browserDocument.head !== "object" ||
    typeof browserDocument.createDocumentFragment !== "function" ||
    typeof browserDocument.createElement !== "function"
  ) {
    throw new Error(
      "[Goribu] Cannot synchronize route metadata because the browser Document has no usable head. Render a complete <html><head>...</head><body>...</body></html> shell from the application Document.",
    );
  }

  const fragment = browserDocument.createDocumentFragment();
  appendElement(fragment, browserDocument, "title", {}, metadata?.title ?? "");

  if (Object.hasOwn(metadata, "description")) {
    appendElement(fragment, browserDocument, "meta", {
      name: "description",
      content: metadata.description,
    });
  }
  if (Object.hasOwn(metadata, "canonical")) {
    appendElement(fragment, browserDocument, "link", {
      rel: "canonical",
      href: metadata.canonical,
    });
  }
  if (Object.hasOwn(metadata, "robots")) {
    appendElement(fragment, browserDocument, "meta", {
      name: "robots",
      content: metadata.robots,
    });
  }
  for (const descriptor of metadata?.meta ?? []) {
    appendElement(fragment, browserDocument, "meta", descriptor);
  }
  for (const descriptor of metadata?.links ?? []) {
    appendElement(fragment, browserDocument, "link", descriptor);
  }

  for (const element of browserDocument.head.querySelectorAll(
    `[${ROUTE_HEAD_MARKER}]`,
  )) {
    element.remove();
  }
  browserDocument.head.appendChild(fragment);
}

function appendElement(fragment, browserDocument, tagName, attributes, text = null) {
  const element = browserDocument.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(toHtmlAttribute(name), value);
  }
  element.setAttribute(ROUTE_HEAD_MARKER, "");
  if (text !== null) element.textContent = text;
  fragment.appendChild(element);
}

function toHtmlAttribute(name) {
  switch (name) {
    case "crossOrigin":
      return "crossorigin";
    case "fetchPriority":
      return "fetchpriority";
    case "hrefLang":
      return "hreflang";
    case "imageSizes":
      return "imagesizes";
    case "imageSrcSet":
      return "imagesrcset";
    case "referrerPolicy":
      return "referrerpolicy";
    default:
      return name;
  }
}

import { imageLabel } from "./images.server.js";

export function readServerMessage() {
  return `Server chain: ${imageLabel()}`;
}

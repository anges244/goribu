export const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Validate the hostname shared by app and R2 custom-domain declarations. */
export function assertHostname(value, field, example) {
  if (
    typeof value !== "string" || value.length > 253 || !value.includes(".") ||
    !value.split(".").every((label) => HOST_LABEL.test(label)) ||
    /^[\d.]+$/.test(value)
  ) {
    throw new TypeError(
      `[Goribu] Application configuration field ${field} must be a bare hostname with at least two labels, such as "${example}", without a scheme, path, port, or IP address. Set ${field} to your custom hostname.`,
    );
  }
  return value.toLowerCase();
}

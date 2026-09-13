export const FORM_MEDIA_TYPE = "application/vnd.goribu.form+json";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** HTTP methods whose responses can negotiate the Form protocol. */
export function isFormMutationMethod(method) {
  return MUTATION_METHODS.has(method);
}

export const FORM_FAILURE_MESSAGE =
  "We couldn’t confirm the form submission. Check the page before submitting again.";

/** Match Goribu's form media type in a Content-Type value, ignoring parameters. */
export function hasFormMediaType(value) {
  if (typeof value !== "string") return false;

  const [mediaType] = value.split(";", 1);
  return mediaType.trim().toLowerCase() === FORM_MEDIA_TYPE;
}

/** Return whether Accept explicitly permits Goribu's form representation. */
export function acceptsFormMediaType(value) {
  if (typeof value !== "string") return false;

  return value.split(",").some((part) => {
    const [mediaType, ...parameters] = part.split(";");
    if (mediaType.trim().toLowerCase() !== FORM_MEDIA_TYPE) return false;

    let quality = 1;
    let foundQuality = false;
    for (const parameter of parameters) {
      const separator = parameter.indexOf("=");
      const name = (
        separator === -1 ? parameter : parameter.slice(0, separator)
      ).trim();
      if (name.toLowerCase() !== "q") continue;
      if (foundQuality || separator === -1) return false;

      foundQuality = true;
      const value = parameter.slice(separator + 1).trim();
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) {
        return false;
      }
      quality = Number(value);
    }

    return quality > 0;
  });
}

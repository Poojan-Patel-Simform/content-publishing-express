const MAX_SLUG_LENGTH = 200;

export const slugify = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

/** Appends a short suffix so a title collision never blocks item creation.
 * `attempt` starts at 1 for the second try (`attempt` 0 is the bare slug,
 * tried by the caller before this is ever invoked). */
export const withUniquenessSuffix = (slug: string, attempt: number): string => {
  const suffix = `-${attempt + 1}`;
  return `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
};

//* STORED IMAGE PATHS ARE RELATIVE (E.G. `/uploads/blogs/abc.webp`)
//* — PREFIX WITH THE CONFIGURED BASE URL SO CLIENTS GET A DIRECTLY-USABLE
//* ABSOLUTE URL. LEFT UNCHANGED IF ALREADY ABSOLUTE OR IF NO BASE URL WAS
//* SUPPLIED (E.G. A CALLER THAT DOESN'T HAVE ACCESS TO CONFIGSERVICE).
//* THE SLASH BETWEEN THE TWO HALVES IS NORMALIZED SO A BASE URL ENDING IN "/"
//* OR A PATH MISSING ITS LEADING "/" NEVER PRODUCES "...com//uploads/...".
export function toAbsoluteUrl(
  path: string | null | undefined,
  baseUrl?: string,
): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http') || !baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

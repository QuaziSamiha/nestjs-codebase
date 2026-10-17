/** Swagger UI `requestInterceptor` receives an untyped request; keep returns as `unknown` for type-aware ESLint. */
export function swaggerMultipartLogoRequestInterceptor(req: unknown): unknown {
  if (typeof req !== 'object' || req === null) {
    return req;
  }
  const r = req as {
    body?: unknown;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  if (r.body === null || typeof r.body !== 'object' || !('logo' in r.body)) {
    return req;
  }
  const body = r.body as Record<string, unknown>;
  const logo = body['logo'];
  if (logo === undefined || logo === null) {
    return req;
  }
  const formData = new FormData();
  for (const key of Object.keys(body)) {
    if (key === 'logo') continue;
    const val = body[key];
    if (typeof val === 'string' || val instanceof Blob) {
      formData.append(key, val);
    } else if (
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      typeof val === 'bigint'
    ) {
      formData.append(key, String(val));
    } else if (val !== undefined && val !== null) {
      formData.append(key, JSON.stringify(val));
    }
  }
  if (typeof logo === 'string' || logo instanceof Blob) {
    formData.append('logo', logo);
  } else if (
    typeof logo === 'number' ||
    typeof logo === 'boolean' ||
    typeof logo === 'bigint'
  ) {
    formData.append('logo', String(logo));
  } else {
    formData.append('logo', JSON.stringify(logo));
  }
  return {
    ...r,
    body: formData,
    headers: {
      ...(r.headers ?? {}),
      'Content-Type': 'multipart/form-data',
    },
  };
}

const normalizePath = (value) =>
  String(value || "")
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase() || "/";

export const isHeRedirectPath = (value) =>
  /(?:^|\/)(?:api\/)?(?:cgw\/)?he-redirect$/.test(normalizePath(value));

export const isHeRedirectRequest = (req) =>
  [req.path, req.originalUrl, req.url].some(isHeRedirectPath);

const normalizePath = (value) =>
  String(value || "")
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase() || "/";

export const isHeRedirectPath = (value) =>
  normalizePath(value).includes("he-redirect");

export const isHeRedirectRequest = (req) =>
  [req.path, req.originalUrl, req.url].some(isHeRedirectPath);

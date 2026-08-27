import test from "node:test";
import assert from "node:assert/strict";
import { isHeRedirectPath, isHeRedirectRequest } from "../utils/heRedirectPath.js";

test("matches HE redirect paths used by nginx and phones", () => {
  const paths = [
    "/api/cgw/he-redirect",
    "/api/cgw/he-redirect/",
    "/api/cgw/he-redirect?offerCode=9923310010",
    "/cgw/he-redirect",
    "/he-redirect",
    "/api/he-redirect",
  ];

  for (const path of paths) {
    assert.equal(isHeRedirectPath(path), true, path);
    assert.equal(isHeRedirectRequest({ path, originalUrl: path, url: path }), true, path);
  }
});

test("does not match unrelated cgw paths", () => {
  assert.equal(isHeRedirectPath("/api/cgw/callback"), false);
  assert.equal(isHeRedirectPath("/api/cgw/redirect"), false);
  assert.equal(isHeRedirectPath("/api/health"), false);
});

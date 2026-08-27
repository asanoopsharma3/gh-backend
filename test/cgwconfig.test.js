import test from "node:test";
import assert from "node:assert/strict";
import {
  extractHeaderMsisdn,
  generateFixedHEUrl,
  isDummyHeMsisdn,
  normalizeMsisdn,
} from "../config/cgwconfig.js";

test("does not send dummy 999 MSISDN on HE URLs", () => {
  const url = generateFixedHEUrl({
    offerCode: "9923310010",
    redirectUrl: "http://ghsuperwinnings.com/api/callback",
    mobileNumber: "99999999999",
  });
  assert.equal(url.includes("mobileNumber"), false);
  assert.equal(url.startsWith("http://cg.mtn.com.gh/Portal"), true);
});

test("HE URL is still built when MSISDN is missing", () => {
  const url = generateFixedHEUrl({
    offerCode: "9923310010",
    redirectUrl: "https://ghsuperwinnings.com/api/callback",
  });
  assert.equal(url.includes("OfferCode=9923310010"), true);
  assert.equal(url.includes("redirectUrl=http%3A%2F%2Fghsuperwinnings.com"), true);
  assert.equal(url.includes("mobileNumber"), false);
});

test("normalizes Ghana numbers and rejects dummy HE placeholders", () => {
  assert.equal(normalizeMsisdn("0244123456"), "233244123456");
  assert.equal(normalizeMsisdn("233244123456"), "233244123456");
  assert.equal(normalizeMsisdn("99999999999"), null);
  assert.equal(isDummyHeMsisdn("99999999999"), true);
});

test("reads MSISDN from operator headers", () => {
  assert.equal(
    extractHeaderMsisdn({
      headers: { "x-up-calling-line-id": "233244123456" },
    }),
    "233244123456"
  );
});

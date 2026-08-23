import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMtnUnsubscribeUrl,
  extractProviderIdFromSubscriptions,
  isMtnUnsubscribeSuccess,
  toMtnCustomerId,
} from "../utils/mtnUnsubscribe.js";

test("builds Ghana customerId from local and international numbers", () => {
  assert.equal(toMtnCustomerId("+233244123456"), "233244123456");
  assert.equal(toMtnCustomerId("0244123456"), "233244123456");
  assert.equal(toMtnCustomerId("233244123456"), "233244123456");
});

test("builds the MTN unsubscribe path with customerId and subscriptionId", () => {
  const url = buildMtnUnsubscribeUrl("233244123456", "9923310010");
  assert.equal(
    url,
    "https://api.mtn.com/v2/customers/233244123456/subscriptions/9923310010"
  );
});

test("extracts subscriptionProviderId from MTN subscription list payload", () => {
  assert.equal(
    extractProviderIdFromSubscriptions(
      {
        vas_hlr: {
          statusCode: "2000",
          data: {
            subscriptionId: "9923310010",
            subscriptionProviderId: "RBT",
          },
        },
      },
      "9923310010"
    ),
    "RBT"
  );
});

test("treats MTN statusCode 0 as unsubscribe success", () => {
  assert.equal(
    isMtnUnsubscribeSuccess(
      {
        subscriptionId: 0,
        subscriptionProviderId: 0,
        statusCode: 0,
        status: "Unsubscribe successful",
        description: "string",
      },
      200
    ),
    true
  );
});

test("treats non-zero MTN statusCode as failure", () => {
  assert.equal(
    isMtnUnsubscribeSuccess({ statusCode: 1, status: "Failed" }, 200),
    false
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailySubscriptionReport,
  classifySubscriptionEvent,
  resolveReportRange,
  toReportEvent,
} from "../services/dailySubscriptionReport.js";
import { parseChargeAmountGhs } from "../config/cgwconfig.js";

test("CGW 200 counts as a new daily subscription at GHC 1.00", () => {
  assert.equal(classifySubscriptionEvent({ status: "200", callbackType: "CGW" }), "new");
  const event = toReportEvent({
    msisdn: "233241111111",
    status: "200",
    offerCode: "9923310010",
    callbackType: "CGW",
    createdAt: "2026-09-20T08:00:00.000Z",
  });
  assert.equal(event.priceGhs, 1);
  assert.equal(event.planName, "Daily Subscription");
  assert.equal(event.priceSource, "catalog");
});

test("already subscribed callbacks are not new subscriptions", () => {
  assert.equal(classifySubscriptionEvent({ status: "9", callbackType: "CGW" }), "already_subscribed");
  assert.equal(
    classifySubscriptionEvent({ status: "AlreadySubscribedCase", callbackType: "CGW" }),
    "already_subscribed"
  );
});

test("SDP renewals and unsubs are not new subscriptions", () => {
  assert.equal(
    classifySubscriptionEvent({
      status: "A",
      lifecycle: "REN",
      source: "SDP",
    }),
    "renewal"
  );
  assert.equal(
    classifySubscriptionEvent({
      status: "D",
      lifecycle: "UNSUB",
      source: "SDP",
    }),
    "unsub"
  );
});

test("inactive lifecycle is not treated as a new activation", () => {
  assert.equal(
    classifySubscriptionEvent({
      status: "A",
      lifecycle: "inactive",
      source: "SDP",
    }),
    "other"
  );
});

test("topup offer is not counted as a new daily subscription", () => {
  assert.equal(
    classifySubscriptionEvent({
      status: "200",
      offerCode: "9923310009",
      callbackType: "CGW",
    }),
    "topup"
  );
});

test("parses pesewas and catalog fallback into GHC", () => {
  assert.equal(parseChargeAmountGhs(100), 1);
  assert.equal(parseChargeAmountGhs("1.00"), 1);
  assert.equal(parseChargeAmountGhs(0, null, ""), 0);
});

test("groups unique new subscriptions by Ghana date and ignores duplicates", () => {
  const report = buildDailySubscriptionReport(
    [
      {
        msisdn: "233241111111",
        status: "200",
        offerCode: "9923310010",
        callbackType: "CGW",
        createdAt: "2026-09-20T08:00:00.000Z",
        rawBody: { flow: "NHE?CGID=TID123" },
      },
      {
        msisdn: "233241111111",
        status: "A",
        lifecycle: "SUB",
        offerCode: "9923310010",
        source: "SDP",
        chargeAmount: 100,
        createdAt: "2026-09-20T08:05:00.000Z",
      },
      {
        msisdn: "233242222222",
        status: "success",
        callbackType: "CGW",
        createdAt: "2026-09-19T10:00:00.000Z",
      },
      {
        msisdn: "233243333333",
        status: "A",
        lifecycle: "REN",
        source: "SDP",
        createdAt: "2026-09-20T11:00:00.000Z",
      },
      {
        msisdn: "233243333333",
        status: "A",
        lifecycle: "REN",
        source: "SDP",
        createdAt: "2026-09-20T11:01:00.000Z",
      },
    ],
    { from: "2026-09-19", to: "2026-09-20" }
  );

  assert.equal(report.view, "range");
  assert.equal(report.summary.newSubscriptions, 2);
  assert.equal(report.summary.renewals, 1);
  assert.equal(report.summary.newRevenueGhs, 2);
  assert.equal(report.summary.renewalRevenueGhs, 1);
  assert.equal(report.daily[0].date, "2026-09-19");
  assert.equal(report.daily[0].newSubscriptions, 1);
  assert.equal(report.daily[0].revenueGhs, 1);
  assert.equal(report.daily[1].date, "2026-09-20");
  assert.equal(report.daily[1].newSubscriptions, 1);
  assert.equal(report.daily[1].subscriptions[0].msisdn, "233241111111");
  assert.equal(report.daily[1].subscriptions[0].source, "CGW");
  assert.equal(report.daily[1].subscriptions[0].priceGhs, 1);
  assert.equal(report.daily[1].subscriptions[0].chargingAmount, 1);
  assert.equal(report.daily[1].subscriptions[0].flow, "NHE");
  assert.equal(report.daily[1].subscriptions[0].planName, "Daily Subscription");
});

test("user first activation is counted when no callback exists", () => {
  const report = buildDailySubscriptionReport(
    [
      {
        msisdn: "+233255555555",
        status: "200",
        offerCode: "9923310010",
        source: "USER",
        flow: "LOCAL",
        chargingAmount: 1,
        createdAt: "2026-09-18T09:00:00.000Z",
      },
    ],
    { from: "2026-09-18", to: "2026-09-18" }
  );

  assert.equal(report.summary.newSubscriptions, 1);
  assert.equal(report.summary.newRevenueGhs, 1);
  assert.equal(report.daily[0].subscriptions[0].source, "USER");
});

test("defaults to a single Ghana day when no range is sent", () => {
  const range = resolveReportRange({}, new Date("2026-09-20T15:00:00.000Z"));
  assert.equal(range.from, "2026-09-20");
  assert.equal(range.to, "2026-09-20");
  assert.equal(range.view, "daily");
});

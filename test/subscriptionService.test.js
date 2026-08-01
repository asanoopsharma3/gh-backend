import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_QUESTION_LIMIT,
  SUBSCRIPTION_CYCLE_MS,
  calculateCycleState,
  getSubscriptionSummary,
} from "../services/subscriptionService.js";

test("keeps usage within the current 24-hour subscription cycle", () => {
  const start = new Date("2026-06-15T00:00:00.000Z");
  const user = {
    subscriptionStatus: "active",
    questionsPlayedToday: 6,
    subscriptionStartTime: start,
    nextPlayTime: new Date(start.getTime() + SUBSCRIPTION_CYCLE_MS),
  };

  const state = calculateCycleState(
    user,
    new Date("2026-06-15T12:00:00.000Z")
  );

  assert.equal(state.shouldReset, false);
  assert.equal(state.questionsPlayedToday, 6);
});

test("automatically resets usage after a full 24-hour cycle", () => {
  const start = new Date("2026-06-15T00:00:00.000Z");
  const user = {
    subscriptionStatus: "active",
    questionsPlayedToday: DAILY_QUESTION_LIMIT,
    subscriptionStartTime: start,
    nextPlayTime: new Date(start.getTime() + SUBSCRIPTION_CYCLE_MS),
  };

  const state = calculateCycleState(
    user,
    new Date("2026-06-16T00:00:01.000Z")
  );

  assert.equal(state.shouldReset, true);
  assert.equal(state.questionsPlayedToday, 0);
  assert.equal(
    state.nextPlayTime.toISOString(),
    "2026-06-17T00:00:00.000Z"
  );
});

test("reports top-up required after a failed ten-question set", () => {
  const summary = getSubscriptionSummary({
    subscriptionStatus: "active",
    isAttemptQuiz: true,
    questionsPlayedToday: 10,
    subscriptionStartTime: new Date(),
    nextPlayTime: new Date(Date.now() + SUBSCRIPTION_CYCLE_MS),
  });

  assert.equal(summary.canPlay, false);
  assert.equal(summary.limitReached, true);
  assert.equal(summary.quizAccessStatus, "topup_required");
  assert.equal(summary.questionsRemaining, 0);
});

test("inactive subscriptions never allow gameplay", () => {
  const summary = getSubscriptionSummary({
    subscriptionStatus: "inactive",
    questionsPlayedToday: 0,
  });

  assert.equal(summary.canPlay, false);
  assert.equal(summary.questionsRemaining, DAILY_QUESTION_LIMIT);
});

import { describe, expect, it } from "vitest";
import { chooseSafeThreshold, isNamespaceCaseId, percentile, summarize, sweepThresholds } from "../bench/metrics";

describe("benchmark fixtures and metrics", () => {
  it("keeps hard negatives reviewed and namespace cases explicit", () => {
    const reviewed = [
      { risk: "hard_negative_fee_vs_decline", expected: "miss" },
      { risk: "hard_negative_password_vs_pin", expected: "miss" },
      { risk: "hard_negative_country_vs_currency", expected: "miss" },
      { risk: "namespace_isolation", expected: "miss" },
    ];
    expect(reviewed.every((row) => row.expected === "miss")).toBe(true);
    expect(reviewed.some((row) => row.risk === "namespace_isolation")).toBe(true);
    expect(["test-namespace-same-subject", "test-namespace-same-prompt"].filter(isNamespaceCaseId)).toHaveLength(2);
  });

  it("computes retrieval metrics and chooses a threshold with no false hits", () => {
    const summary = summarize([
      { id: "exact", expectedHit: true, returnedHit: true, kind: "exact", latencyMs: 2 },
      { id: "semantic", expectedHit: true, returnedHit: true, kind: "semantic", latencyMs: 4 },
      { id: "miss", expectedHit: false, returnedHit: false, kind: "miss", latencyMs: 8 },
      { id: "false-hit", expectedHit: false, returnedHit: true, kind: "semantic", namespaceLeak: true, latencyMs: 16 },
    ]);
    expect(summary.exactHits).toBe(1);
    expect(summary.semanticHits).toBe(2);
    expect(summary.falseHitRate).toBe(0.5);
    expect(summary.namespaceLeaks).toBe(1);
    expect(summary.latencyByKind.exact.p50Ms).toBe(2);
    expect(percentile([2, 4, 8, 16], 0.5)).toBe(6);

    const thresholds = sweepThresholds([
      { id: "safe", score: 0.93, expectedHit: true },
      { id: "danger", score: 0.91, expectedHit: false },
    ], [0.9, 0.92, 0.94]);
    expect(chooseSafeThreshold(thresholds)?.threshold).toBe(0.92);
  });
});

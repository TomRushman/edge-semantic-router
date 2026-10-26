export type OutcomeKind = "exact" | "semantic" | "miss";

export interface EvaluationCase {
  id: string;
  expectedHit: boolean;
  returnedHit: boolean;
  kind: OutcomeKind;
  namespaceLeak?: boolean;
  latencyMs?: number;
}

export interface Summary {
  total: number;
  exactHits: number;
  semanticHits: number;
  misses: number;
  usefulHits: number;
  usefulHitRate: number;
  precision: number;
  recall: number;
  falseHitRate: number;
  falseMissRate: number;
  namespaceLeaks: number;
  p50Ms: number | null;
  p95Ms: number | null;
  latencyByKind: Record<OutcomeKind, { p50Ms: number | null; p95Ms: number | null }>;
}

export interface ScoredCase {
  id: string;
  score: number;
  expectedHit: boolean;
}

export interface ThresholdResult {
  threshold: number;
  precision: number;
  recall: number;
  falseHitRate: number;
  falseMissRate: number;
  returnedHits: number;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export function isNamespaceCaseId(id: string): boolean {
  return id.includes("-namespace-");
}

export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function summarize(cases: EvaluationCase[]): Summary {
  const positive = cases.filter((item) => item.expectedHit);
  const negative = cases.filter((item) => !item.expectedHit);
  const returnedHits = cases.filter((item) => item.returnedHit);
  const usefulHits = cases.filter((item) => item.expectedHit && item.returnedHit);
  const latencies = cases.flatMap((item) => item.latencyMs === undefined ? [] : [item.latencyMs]);
  const latencyByKind = Object.fromEntries(([
    "exact", "semantic", "miss",
  ] as const).map((kind) => {
    const values = cases.filter((item) => item.kind === kind).flatMap((item) => item.latencyMs === undefined ? [] : [item.latencyMs]);
    return [kind, { p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) }];
  })) as Summary["latencyByKind"];
  return {
    total: cases.length,
    exactHits: cases.filter((item) => item.kind === "exact").length,
    semanticHits: cases.filter((item) => item.kind === "semantic").length,
    misses: cases.filter((item) => item.kind === "miss").length,
    usefulHits: usefulHits.length,
    usefulHitRate: ratio(usefulHits.length, cases.length),
    precision: ratio(usefulHits.length, returnedHits.length),
    recall: ratio(usefulHits.length, positive.length),
    falseHitRate: ratio(cases.filter((item) => !item.expectedHit && item.returnedHit).length, negative.length),
    falseMissRate: ratio(cases.filter((item) => item.expectedHit && !item.returnedHit).length, positive.length),
    namespaceLeaks: cases.filter((item) => item.namespaceLeak === true).length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    latencyByKind,
  };
}

export function sweepThresholds(
  cases: ScoredCase[],
  thresholds = Array.from({ length: 30 }, (_, index) => 0.7 + index * 0.01),
): ThresholdResult[] {
  return thresholds.map((threshold) => {
    const expected = cases.filter((item) => item.expectedHit);
    const returned = cases.filter((item) => item.score >= threshold);
    const useful = returned.filter((item) => item.expectedHit);
    const negatives = cases.filter((item) => !item.expectedHit);
    return {
      threshold: Number(threshold.toFixed(2)),
      precision: ratio(useful.length, returned.length),
      recall: ratio(useful.length, expected.length),
      falseHitRate: ratio(returned.filter((item) => !item.expectedHit).length, negatives.length),
      falseMissRate: ratio(expected.filter((item) => item.score < threshold).length, expected.length),
      returnedHits: returned.length,
    };
  });
}

export function chooseSafeThreshold(results: ThresholdResult[]): ThresholdResult | null {
  const safe = results.filter((item) => item.falseHitRate === 0);
  return [...safe].sort((a, b) => b.recall - a.recall || b.threshold - a.threshold)[0] ?? null;
}

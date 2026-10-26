import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseSafeThreshold, isNamespaceCaseId, summarize, sweepThresholds } from "./metrics.ts";
import { subjectFromRules } from "../src/subjects.ts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const resultsDir = resolve(root, "bench/results");
const ollamaUrl = value("OLLAMA_URL", "http://127.0.0.1:11434");
const model = value("EMBEDDING_MODEL", "all-minilm");
const golden = await readJsonl(resolve(root, "bench/golden.jsonl"));
const source = await readJsonl(resolve(root, "bench/banking77-subset.jsonl"));
const sourceBytes = await readFile(resolve(root, "bench/banking77-subset.jsonl"));
const sourceManifest = JSON.parse(await readFile(resolve(root, "bench/source.json"), "utf8"));
const output = { generatedAt: new Date().toISOString(), model, status: "not-measured" };

try {
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== sourceManifest.subsetSha256) throw new Error(`BANKING77 subset checksum mismatch: ${sourceSha256}`);
  const embeddings = new Map();
  const allTexts = [...new Set([...golden.flatMap((item) => [item.anchor, item.candidate]), ...source.map((item) => item.text)])];
  for (const text of allTexts) embeddings.set(text, await embed(text));
  const thresholdCases = golden.filter((item) => thresholdEligible(item)).map((item) => ({
    id: item.id,
    score: bestScore(item, embeddings),
    expectedHit: item.expected === "hit",
  }));
  const thresholds = sweepThresholds(thresholdCases);
  const selected = chooseSafeThreshold(thresholds);
  const threshold = selected?.threshold ?? 0.9;
  const cases = golden.map((item) => evaluateCase(item, embeddings, threshold));
  const banking77Cases = buildBanking77Cases(source, embeddings, threshold);
  output.status = "measured";
  output.dataset = { rows: source.length, sha256: sourceSha256, revision: sourceManifest.revision };
  output.summary = summarize(cases);
  output.summaryBySplit = {
    dev: summarize(cases.filter((item) => item.id.startsWith("dev-"))),
    test: summarize(cases.filter((item) => item.id.startsWith("test-"))),
  };
  output.namespaceIsolation = cases.filter((item) => isNamespaceCaseId(item.id)).map((item) => ({
    id: item.id,
    returnedHit: item.returnedHit,
    expectedMiss: !item.returnedHit,
  }));
  output.banking77 = {
    summary: summarize(banking77Cases),
    note: "Same-intent pairs count as expected hits and adjacent cross-intent pairs count as expected misses. BANKING77 intent labels approximate answer interchangeability and require product review.",
  };
  output.thresholds = thresholds;
  output.selectedThreshold = selected;
  output.cases = cases;
  output.note = "BANKING77 intent labels are used as a proxy for answer equivalence. Review product-specific answers before enabling reuse.";
} catch (error) {
  output.reason = error instanceof Error ? error.message : String(error);
  output.note = "No measured output was produced. Start Ollama, pull all-minilm, then rerun npm run benchmark.";
}

await writeFile(resolve(resultsDir, "latest.json"), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(resolve(resultsDir, "latest.md"), renderReport(output));
console.log(renderReport(output));

async function embed(text) {
  const started = performance.now();
  const response = await fetch(new URL("/api/embed", ollamaUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.embeddings?.[0])) throw new Error("Ollama returned no embedding");
  return { vector: body.embeddings[0], latencyMs: performance.now() - started };
}

function evaluateCase(item, embeddings, threshold) {
  const anchorNamespace = item.anchorNamespace ?? item.namespace;
  const exact = normalize(item.anchor) === normalize(item.candidate) && item.namespace === anchorNamespace;
  const subject = subjectFor(item.candidate);
  const sameSubject = subject === item.subject;
  const sameNamespace = item.namespace === anchorNamespace;
  const returnedHit = exact || (sameNamespace && sameSubject && bestScore(item, embeddings) >= threshold);
  return {
    id: `${item.split}-${item.id}`,
    expectedHit: item.expected === "hit",
    returnedHit,
    kind: exact ? "exact" : returnedHit ? "semantic" : "miss",
    namespaceLeak: item.expected !== "hit" && item.namespace !== anchorNamespace && returnedHit,
    // This runner measures the lookup embedding request, not Worker/D1/KV latency.
    latencyMs: exact ? undefined : embeddings.get(item.candidate)?.latencyMs,
  };
}

function thresholdEligible(item) {
  const anchorNamespace = item.anchorNamespace ?? item.namespace;
  const exact = normalize(item.anchor) === normalize(item.candidate) && item.namespace === anchorNamespace;
  return !exact && item.namespace === anchorNamespace && subjectFor(item.candidate) === item.subject;
}

function buildBanking77Cases(rows, embeddings, threshold) {
  const cases = [];
  const byIntent = new Map();
  for (const row of rows) byIntent.set(row.intent, [...(byIntent.get(row.intent) ?? []), row]);
  const ordered = [...byIntent.values()];
  for (const group of ordered) {
    for (let index = 0; index < group.length - 1; index += 1) {
      cases.push(sourceCase(group[index], group[index + 1], true, embeddings, threshold));
    }
  }
  for (let index = 0; index < ordered.length - 1; index += 1) {
    cases.push(sourceCase(ordered[index][0], ordered[index + 1][0], false, embeddings, threshold));
  }
  return cases;
}

function sourceCase(anchor, candidate, expectedHit, embeddings, threshold) {
  const sameSubject = subjectFor(anchor.text) === subjectFor(candidate.text);
  const score = cosine(embeddings.get(anchor.text).vector, embeddings.get(candidate.text).vector);
  const returnedHit = sameSubject && score >= threshold;
  return {
    id: `${anchor.sourceId}->${candidate.sourceId}`,
    expectedHit,
    returnedHit,
    kind: returnedHit ? "semantic" : "miss",
    latencyMs: embeddings.get(candidate.text)?.latencyMs,
  };
}

function bestScore(item, embeddings) {
  return cosine(embeddings.get(item.anchor).vector, embeddings.get(item.candidate).vector);
}

function subjectFor(text) {
  return subjectFromRules(normalize(text)) ?? "general";
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]; normA += a[index] ** 2; normB += b[index] ** 2;
  }
  return normA === 0 || normB === 0 ? -1 : dot / Math.sqrt(normA * normB);
}

function normalize(text) { return text.normalize("NFC").trim().replace(/\s+/gu, " "); }
function value(name, fallback) { return process.env[name] || fallback; }
async function readJsonl(path) { return (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line)); }
function renderReport(report) {
  if (report.status !== "measured") return `# Semantic cache benchmark\n\nStatus: not measured.\n\n${report.note}\n\nReason: ${report.reason || "not run"}\n`;
  const summary = report.summary;
  const byKind = Object.entries(summary.latencyByKind).map(([kind, latency]) => `${kind} p50/p95: ${latency.p50Ms?.toFixed(1) ?? "n/a"}/${latency.p95Ms?.toFixed(1) ?? "n/a"} ms`).join("; ");
  const banking = report.banking77?.summary;
  const test = report.summaryBySplit?.test;
  return `# Semantic cache benchmark\n\nStatus: measured with ${report.model} on ${report.dataset.rows} pinned BANKING77 rows.\n\n- Exact hits: ${summary.exactHits}\n- Semantic hits: ${summary.semanticHits}\n- Misses: ${summary.misses}\n- Useful hit rate: ${(summary.usefulHitRate * 100).toFixed(1)}%\n- Precision: ${(summary.precision * 100).toFixed(1)}%\n- Recall: ${(summary.recall * 100).toFixed(1)}%\n- False-hit rate: ${(summary.falseHitRate * 100).toFixed(1)}%\n- False-miss rate: ${(summary.falseMissRate * 100).toFixed(1)}%\n- Namespace leaks: ${summary.namespaceLeaks}\n- Held-out test precision/recall: ${test ? `${(test.precision * 100).toFixed(1)}%/${(test.recall * 100).toFixed(1)}%` : "n/a"}\n- Lookup embedding latency by outcome: ${byKind}\n- Selected development threshold: ${report.selectedThreshold?.threshold ?? "none"}\n\nBANKING77 pair check: ${banking?.total ?? "n/a"} pairs, useful hit rate ${(banking?.usefulHitRate * 100 || 0).toFixed(1)}%, false-hit rate ${(banking?.falseHitRate * 100 || 0).toFixed(1)}%.\n\n${report.note}\n`;
}

export const SUBJECTS = [
  "billing", "auth", "api", "account", "technical",
  "integrations", "security", "shipping", "usage", "general",
] as const;
export type Subject = (typeof SUBJECTS)[number];
type SubjectClassifier = (text: string) => Promise<string>;

const RULES: readonly [Subject, RegExp][] = [
  ["billing", /\b(invoice|invoices|bill|billing|charged|charge|payment|refund|receipt|subscription|plan|price|pricing)\b/iu],
  ["auth", /\b(password|reset|login|log in|sign in|signin|logout|two[- ]factor|2fa|otp|verification|verify)\b/iu],
  ["api", /\b(api|endpoint|sdk|webhook|openapi|swagger|curl|documentation|docs)\b/iu],
  ["account", /\b(account|profile|email address|organization|workspace|team|member|invite)\b/iu],
  ["technical", /\b(error|bug|broken|failure|timeout|crash|not working|install|configure|configuration)\b/iu],
  ["integrations", /\b(integration|integrate|slack|salesforce|hubspot|zapier|plugin|connect)\b/iu],
  ["security", /\b(security|breach|vulnerability|permission|permissions|role|access|encryption|privacy)\b/iu],
  ["shipping", /\b(ship|shipping|delivery|delivered|tracking|order|warehouse|address)\b/iu],
  ["usage", /\b(usage|quota|limit|limits|rate limit|capacity|tokens|consumption|analytics|metrics)\b/iu],
];

export function subjectFromRules(text: string): Subject | null {
  return RULES.find(([, rule]) => rule.test(text))?.[0] ?? null;
}

let onnxClassifier: SubjectClassifier | null = null;

async function loadOnnxClassifier(model: string): Promise<SubjectClassifier> {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
  const labelVectors = new Map<string, number[]>();
  for (const label of SUBJECTS) {
    const output = await extractor(`This is a ${label} support request.`, { pooling: "mean", normalize: true });
    labelVectors.set(label, Array.from(output.data as Float32Array));
  }
  return async (text) => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data as Float32Array);
    let best: Subject = "general";
    let bestScore = -Infinity;
    for (const [label, labelVector] of labelVectors) {
      const score = vector.reduce((sum, value, index) => sum + value * labelVector[index], 0);
      if (score > bestScore) { best = label as Subject; bestScore = score; }
    }
    return best;
  };
}

export async function classifySubject(
  text: string,
  env: Pick<Env, "SUBJECT_ONNX_ENABLED" | "SUBJECT_MODEL">,
): Promise<Subject> {
  const ruleMatch = subjectFromRules(text);
  if (ruleMatch) return ruleMatch;
  if (String(env.SUBJECT_ONNX_ENABLED) !== "true" || !env.SUBJECT_MODEL) return "general";
  try {
    onnxClassifier ??= await loadOnnxClassifier(env.SUBJECT_MODEL);
    const result = await onnxClassifier(text);
    return SUBJECTS.includes(result as Subject) ? result as Subject : "general";
  } catch (error) {
    console.warn("Subject ONNX model unavailable; using general bucket", error);
    return "general";
  }
}

export function resetSubjectClassifierForTests(): void { onnxClassifier = null; }

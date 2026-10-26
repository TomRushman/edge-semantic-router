export const SUBJECTS = [
  "accounting", "accounts", "billing", "contact", "general",
] as const;
export type Subject = (typeof SUBJECTS)[number];
type SubjectClassifier = (text: string) => Promise<string>;

const RULES: readonly [Subject, RegExp][] = [
  ["accounting", /\b(invoice|invoices|receipt|receipts|tax|ledger|reconcil|statement|export|exchange rate|currency exchange)\b/iu],
  ["accounts", /\b(account|profile|email address|organization|workspace|team|member|invite|password|reset|login|log in|sign in|signin|logout|two[- ]factor|2fa|otp|verification|verify|personal details)\b/iu],
  ["billing", /\b(bill|billing|charged|charge|payment|refund|subscription|plan|price|pricing|fee|cost|top[- ]?up|cash withdrawal)\b/iu],
  ["contact", /\b(contact|support|support email|help desk|help centre|help center|email us|call us|phone number|opening hours|business hours|country|countries)\b/iu],
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

import { classifySubject, type Subject } from "./subjects";

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;

interface CacheRow {
  id: string;
  namespace: string;
  subject: Subject;
  prompt: string;
  normalized_prompt: string;
  response_key: string;
  context_json: string;
  embedding_model: string;
  created_at: number;
  expires_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

interface VectorRow extends CacheRow {
  dimensions: number;
  embedding_json: string;
}

interface VectorMatch extends VectorRow {
  score: number;
}

class EmbeddingUnavailableError extends Error {}

export function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }

  return normA === 0 || normB === 0 ? -1 : dot / Math.sqrt(normA * normB);
}

export async function cacheId(
  embeddingModel: string,
  namespace: string,
  normalizedPrompt: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${embeddingModel}\0${namespace}\0${normalizedPrompt}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function embed(
  text: string,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<number[]> {
  try {
    const response = await fetcher(new URL("/api/embed", env.OLLAMA_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: text }),
    });
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const body: unknown = await response.json();
    const vector =
      isObject(body) &&
      Array.isArray(body.embeddings) &&
      Array.isArray(body.embeddings[0])
        ? body.embeddings[0]
        : null;
    if (!vector || vector.length === 0 || !vector.every(isFiniteNumber)) {
      throw new Error("Ollama returned an invalid embedding");
    }
    return vector;
  } catch (error) {
    throw new EmbeddingUnavailableError(
      error instanceof Error ? error.message : "Embedding request failed",
    );
  }
}

export async function queryVectors(
  env: Env,
  namespace: string,
  subject: Subject,
  query: number[],
  now: number,
  excludedIds: Set<string> = new Set(),
): Promise<VectorMatch[]> {
  const { results } = await env.CACHE_DB.prepare(
    `SELECT e.*, v.dimensions, v.embedding_json
       FROM cache_entries e
       JOIN local_vectors v ON v.entry_id = e.id
      WHERE e.namespace = ? AND e.subject = ? AND e.embedding_model = ? AND e.expires_at > ?`,
  )
    .bind(namespace, subject, env.EMBEDDING_MODEL, now)
    .all<VectorRow>();

  // ponytail: exhaustive scan is intentional for small local datasets; use
  // Vectorize (cloud) or Qdrant (local) once measured latency justifies it.
  return results
    .flatMap((row) => {
      if (excludedIds.has(row.id) || row.dimensions !== query.length) return [];
      const vector = parseVector(row.embedding_json);
      return vector ? [{ ...row, score: cosineSimilarity(query, vector) }] : [];
    })
    .sort((left, right) => right.score - left.score);
}

export async function upsertVector(
  env: Env,
  entry: {
    id: string;
    namespace: string;
    subject: Subject;
    prompt: string;
    normalizedPrompt: string;
    responseKey: string;
    contextJson: string;
    createdAt: number;
    expiresAt: number;
  },
  vector: number[],
): Promise<void> {
  await env.CACHE_DB.batch([
    env.CACHE_DB.prepare(
      `INSERT INTO cache_entries (
         id, namespace, subject, prompt, normalized_prompt, response_key, context_json,
         embedding_model, created_at, expires_at, hit_count, last_hit_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
       ON CONFLICT(id) DO UPDATE SET
         subject = excluded.subject,
         prompt = excluded.prompt,
         response_key = excluded.response_key,
         context_json = excluded.context_json,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         hit_count = 0,
         last_hit_at = NULL`,
    ).bind(
      entry.id,
      entry.namespace,
      entry.subject,
      entry.prompt,
      entry.normalizedPrompt,
      entry.responseKey,
      entry.contextJson,
      env.EMBEDDING_MODEL,
      entry.createdAt,
      entry.expiresAt,
    ),
    env.CACHE_DB.prepare(
      `INSERT INTO local_vectors (entry_id, dimensions, embedding_json)
       VALUES (?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         dimensions = excluded.dimensions,
         embedding_json = excluded.embedding_json`,
    ).bind(entry.id, vector.length, JSON.stringify(vector)),
  ]);
}

export async function deleteVector(env: Env, id: string): Promise<void> {
  await env.CACHE_DB.batch([
    env.CACHE_DB.prepare("DELETE FROM local_vectors WHERE entry_id = ?").bind(id),
    env.CACHE_DB.prepare("DELETE FROM cache_entries WHERE id = ?").bind(id),
  ]);
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return json({
        ok: true,
        storage: "local-d1-kv",
        embeddingModel: env.EMBEDDING_MODEL,
      });
    }

    if (url.pathname === "/v1/cache/entries") {
      if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
      return await storeEntry(request, env, fetcher);
    }

    if (url.pathname === "/v1/cache/lookup") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      return await lookupEntry(request, env, ctx, fetcher);
    }

    const deleteMatch = url.pathname.match(
      /^\/v1\/cache\/entries\/([a-f0-9]{64})$/u,
    );
    if (deleteMatch) {
      if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
      return await deleteEntryResponse(deleteMatch[1], env);
    }

    return jsonError(404, "not_found", "Route not found");
  } catch (error) {
    if (error instanceof EmbeddingUnavailableError) {
      return jsonError(503, "embedding_unavailable", error.message);
    }
    console.error(error);
    return jsonError(500, "internal_error", "Unexpected storage failure");
  }
}

async function storeEntry(
  request: Request,
  env: Env,
  fetcher: Fetcher,
): Promise<Response> {
  const body = await readObject(request);
  if (body instanceof Response) return body;

  const namespace = validNamespace(body.namespace);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const normalizedPrompt = normalizePrompt(prompt);
  if (!namespace || !normalizedPrompt || !("response" in body)) {
    return jsonError(
      400,
      "invalid_request",
      "namespace, prompt, and response are required",
    );
  }
  if (
    body.context !== undefined &&
    (!isObject(body.context) || Array.isArray(body.context))
  ) {
    return jsonError(400, "invalid_request", "context must be a JSON object");
  }

  const ttlSeconds = parseTtl(body.ttlSeconds, env.DEFAULT_TTL_SECONDS);
  if (ttlSeconds === null) {
    return jsonError(
      400,
      "invalid_request",
      "ttlSeconds must be an integer of at least 60",
    );
  }

  const id = await cacheId(env.EMBEDDING_MODEL, namespace, normalizedPrompt);
  const subject = await classifySubject(normalizedPrompt, env);
  const vector = await embed(normalizedPrompt, env, fetcher);
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAt)) {
    return jsonError(400, "invalid_request", "ttlSeconds is too large");
  }

  const previous = await env.CACHE_DB.prepare(
    "SELECT response_key FROM cache_entries WHERE id = ?",
  )
    .bind(id)
    .first<{ response_key: string }>();
  const responseKey = `cache:${id}:${crypto.randomUUID()}`;
  await env.RESPONSE_CACHE.put(
    responseKey,
    JSON.stringify({ response: body.response }),
    { expirationTtl: ttlSeconds },
  );

  try {
    await upsertVector(
      env,
      {
        id,
        namespace,
        subject,
        prompt,
        normalizedPrompt,
        responseKey,
        contextJson: JSON.stringify(body.context ?? {}),
        createdAt: now,
        expiresAt,
      },
      vector,
    );
  } catch (error) {
    await env.RESPONSE_CACHE.delete(responseKey).catch(() => undefined);
    throw error;
  }

  if (previous && previous.response_key !== responseKey) {
    await env.RESPONSE_CACHE.delete(previous.response_key).catch(() => undefined);
  }
  return json({ id, expiresAt }, previous ? 200 : 201);
}

async function lookupEntry(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  fetcher: Fetcher,
): Promise<Response> {
  const body = await readObject(request);
  if (body instanceof Response) return body;

  const namespace = validNamespace(body.namespace);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const normalizedPrompt = normalizePrompt(prompt);
  if (!namespace || !normalizedPrompt) {
    return jsonError(400, "invalid_request", "namespace and prompt are required");
  }

  const id = await cacheId(env.EMBEDDING_MODEL, namespace, normalizedPrompt);
  const now = Date.now();
  const excludedIds = new Set<string>();
  const exact = await env.CACHE_DB.prepare(
    "SELECT * FROM cache_entries WHERE id = ?",
  )
    .bind(id)
    .first<CacheRow>();

  if (exact) {
    if (exact.expires_at <= now) {
      excludedIds.add(exact.id);
      runInBackground(ctx, removeEntry(env, exact.id, exact.response_key));
    } else {
      const response = await readCachedResponse(env, exact.response_key);
      if (response.found) {
        runInBackground(ctx, recordHit(env, exact.id, now));
        return json({
          hit: true,
          id: exact.id,
          match: "exact",
          score: 1,
          response: response.value,
          context: parseContext(exact.context_json),
        });
      }
      excludedIds.add(exact.id);
      runInBackground(ctx, removeEntry(env, exact.id, exact.response_key));
    }
  }

  const subject = await classifySubject(normalizedPrompt, env);
  const query = await embed(normalizedPrompt, env, fetcher);
  const threshold = parseThreshold(env.SIMILARITY_THRESHOLD);
  const matches = await queryVectors(env, namespace, subject, query, now, excludedIds);

  for (const match of matches) {
    if (match.score < threshold) break;
    const response = await readCachedResponse(env, match.response_key);
    if (!response.found) {
      runInBackground(ctx, removeEntry(env, match.id, match.response_key));
      continue;
    }
    runInBackground(ctx, recordHit(env, match.id, now));
    return json({
      hit: true,
      id: match.id,
      match: "semantic",
      score: match.score,
      response: response.value,
      context: parseContext(match.context_json),
    });
  }

  return json({ hit: false });
}

async function deleteEntryResponse(id: string, env: Env): Promise<Response> {
  const existing = await env.CACHE_DB.prepare(
    "SELECT response_key FROM cache_entries WHERE id = ?",
  )
    .bind(id)
    .first<{ response_key: string }>();
  await deleteVector(env, id);
  if (existing) {
    await env.RESPONSE_CACHE.delete(existing.response_key);
  }
  return new Response(null, { status: 204 });
}

async function removeEntry(
  env: Env,
  id: string,
  responseKey: string,
): Promise<void> {
  await deleteVector(env, id);
  await env.RESPONSE_CACHE.delete(responseKey);
}

async function recordHit(env: Env, id: string, now: number): Promise<void> {
  await env.CACHE_DB.prepare(
    "UPDATE cache_entries SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?",
  )
    .bind(now, id)
    .run();
}

function runInBackground(ctx: ExecutionContext, promise: Promise<unknown>): void {
  ctx.waitUntil(
    promise.catch((error) => console.error("Background cleanup failed", error)),
  );
}

async function readCachedResponse(
  env: Env,
  key: string,
): Promise<{ found: true; value: unknown } | { found: false }> {
  const raw = await env.RESPONSE_CACHE.get(key);
  if (raw === null) return { found: false };
  try {
    const envelope: unknown = JSON.parse(raw);
    return isObject(envelope) && "response" in envelope
      ? { found: true, value: envelope.response }
      : { found: false };
  } catch {
    return { found: false };
  }
}

async function readObject(request: Request): Promise<JsonObject | Response> {
  try {
    const value: unknown = await request.json();
    return isObject(value) && !Array.isArray(value)
      ? value
      : jsonError(400, "invalid_json", "Request body must be a JSON object");
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function validNamespace(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return new TextEncoder().encode(value).length <= 64 ? value : null;
}

function parseTtl(value: unknown, defaultValue: string): number | null {
  const ttl = value === undefined ? Number(defaultValue) : value;
  return typeof ttl === "number" && Number.isInteger(ttl) && ttl >= 60
    ? ttl
    : null;
}

function parseThreshold(value: string): number {
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
    ? threshold
    : 0.9;
}

function parseVector(jsonValue: string): number[] | null {
  try {
    const value: unknown = JSON.parse(jsonValue);
    return Array.isArray(value) && value.every(isFiniteNumber) ? value : null;
  } catch {
    return null;
  }
}

function parseContext(jsonValue: string): JsonObject {
  try {
    const value: unknown = JSON.parse(jsonValue);
    return isObject(value) && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(
    JSON.stringify({
      error: { code: "method_not_allowed", message: "Method not allowed" },
    }),
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: allowed.join(", "),
      },
    },
  );
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

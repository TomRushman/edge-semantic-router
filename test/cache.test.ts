import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheId,
  cosineSimilarity,
  handleRequest,
  normalizePrompt,
} from "../src/index";
import { subjectFromRules } from "../src/subjects";

const vectorByPrompt: Record<string, number[]> = {
  "Why is the sky blue?": [1, 0, 0],
  "What makes the sky appear blue?": [0.99, 0.01, 0],
  "How do I bake bread?": [0, 1, 0],
};

const embeddingFetch = vi.fn<typeof fetch>(async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { input: string };
  return Response.json({ embeddings: [vectorByPrompt[body.input] ?? [0, 0, 1]] });
});

beforeEach(async () => {
  embeddingFetch.mockClear();
  await env.CACHE_DB.batch([
    env.CACHE_DB.prepare("DELETE FROM local_vectors"),
    env.CACHE_DB.prepare("DELETE FROM cache_entries"),
  ]);
  const keys = await env.RESPONSE_CACHE.list();
  await Promise.all(keys.keys.map(({ name }) => env.RESPONSE_CACHE.delete(name)));
});

describe("cache primitives", () => {
  it("routes common requests into subject buckets", () => {
    expect(subjectFromRules("Where can I see my invoice?")).toBe("billing");
    expect(subjectFromRules("How do I reset my password?")).toBe("auth");
    expect(subjectFromRules("Where are the API docs for command X?")).toBe("api");
    expect(subjectFromRules("Tell me something else")).toBeNull();
  });

  it("normalizes prompts and computes deterministic IDs and cosine scores", async () => {
    expect(normalizePrompt("  café\n\tquestion  ")).toBe("café question");
    const id = await cacheId("all-minilm", "demo", "hello");
    expect(id).toMatch(/^[a-f0-9]{64}$/u);
    expect(await cacheId("all-minilm", "demo", "hello")).toBe(id);
    expect(cosineSimilarity([1, 0], [0.9, 0.1])).toBeGreaterThan(0.99);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

describe("semantic cache API", () => {
  it("returns a cold-cache miss", async () => {
    const { response } = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "Why is the sky blue?" },
      embeddingFetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hit: false });
  });

  it("stores and returns an exact hit without calling Ollama again", async () => {
    const stored = await store("demo", "Why is the sky blue?", "Rayleigh scattering");
    expect(stored.response.status).toBe(201);
    const unavailable = vi.fn<typeof fetch>(async () => {
      throw new Error("Ollama is offline");
    });

    const { response } = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "Why is the sky blue?" },
      unavailable,
    );
    expect(unavailable).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      hit: true,
      match: "exact",
      score: 1,
      response: "Rayleigh scattering",
      context: { source: "test" },
    });
  });

  it("finds a paraphrase but rejects an unrelated prompt", async () => {
    await store("demo", "Why is the sky blue?", { answer: "scattering" });

    const similar = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "What makes the sky appear blue?" },
      embeddingFetch,
    );
    expect(await similar.response.json()).toMatchObject({
      hit: true,
      match: "semantic",
      response: { answer: "scattering" },
    });

    const unrelated = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "How do I bake bread?" },
      embeddingFetch,
    );
    expect(await unrelated.response.json()).toEqual({ hit: false });
  });

  it("isolates matches by namespace", async () => {
    await store("tenant-a", "Why is the sky blue?", "cached");
    const { response } = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "tenant-b", prompt: "What makes the sky appear blue?" },
      embeddingFetch,
    );
    expect(await response.json()).toEqual({ hit: false });
  });

  it("treats expired rows and missing KV values as misses and cleans them up", async () => {
    const first = await store("expired", "Why is the sky blue?", "old");
    const { id: expiredId } = (await first.response.json()) as { id: string };
    await env.CACHE_DB.prepare("UPDATE cache_entries SET expires_at = 0 WHERE id = ?")
      .bind(expiredId)
      .run();
    const expired = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "expired", prompt: "Why is the sky blue?" },
      embeddingFetch,
    );
    expect(await expired.response.json()).toEqual({ hit: false });
    await expired.done;
    expect(
      await env.CACHE_DB.prepare("SELECT id FROM cache_entries WHERE id = ?")
        .bind(expiredId)
        .first(),
    ).toBeNull();

    const second = await store("orphan", "Why is the sky blue?", "missing");
    const { id: orphanId } = (await second.response.json()) as { id: string };
    const row = await env.CACHE_DB.prepare(
      "SELECT response_key FROM cache_entries WHERE id = ?",
    )
      .bind(orphanId)
      .first<{ response_key: string }>();
    await env.RESPONSE_CACHE.delete(row!.response_key);
    const orphan = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "orphan", prompt: "Why is the sky blue?" },
      embeddingFetch,
    );
    expect(await orphan.response.json()).toEqual({ hit: false });
    await orphan.done;
    expect(
      await env.CACHE_DB.prepare("SELECT id FROM cache_entries WHERE id = ?")
        .bind(orphanId)
        .first(),
    ).toBeNull();
  });

  it("replaces exact entries and deletes them idempotently", async () => {
    const first = await store("demo", "Why is the sky blue?", "first");
    const { id } = (await first.response.json()) as { id: string };
    const replacement = await store("demo", "Why is the sky blue?", "second");
    expect(replacement.response.status).toBe(200);

    const hit = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "Why is the sky blue?" },
      embeddingFetch,
    );
    expect(await hit.response.json()).toMatchObject({ response: "second" });

    expect((await call(`/v1/cache/entries/${id}`, "DELETE")).response.status).toBe(
      204,
    );
    expect((await call(`/v1/cache/entries/${id}`, "DELETE")).response.status).toBe(
      204,
    );
  });

  it("validates input and reports Ollama failures", async () => {
    const invalid = await call("/v1/cache/lookup", "POST", { prompt: "hello" });
    expect(invalid.response.status).toBe(400);

    const failedFetch = vi.fn<typeof fetch>(async () => new Response("no", { status: 500 }));
    const unavailable = await call(
      "/v1/cache/lookup",
      "POST",
      { namespace: "demo", prompt: "new prompt" },
      failedFetch,
    );
    expect(unavailable.response.status).toBe(503);
    expect(await unavailable.response.json()).toMatchObject({
      error: { code: "embedding_unavailable" },
    });
  });
});

async function store(namespace: string, prompt: string, response: unknown) {
  return call(
    "/v1/cache/entries",
    "PUT",
    { namespace, prompt, response, context: { source: "test" } },
    embeddingFetch,
  );
}

async function call(
  path: string,
  method: string,
  body?: unknown,
  fetcher: typeof fetch = embeddingFetch,
) {
  const ctx = createExecutionContext();
  const response = await handleRequest(
    new Request(`http://example.test${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
    fetcher,
  );
  return { response, done: waitOnExecutionContext(ctx) };
}

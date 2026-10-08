# Local semantic cache

A local-first semantic prompt/response cache using the Cloudflare Workers runtime, locally simulated D1 and KV bindings, and Ollama embeddings. Requests are first bucketed into ten subjects (billing, auth, API, account, technical, integrations, security, shipping, usage, or general). High-confidence keywords use regex; an optional local ONNX model from `@huggingface/transformers` classifies the remainder. It does not require a Cloudflare account and does not contact Cloudflare.

Vectorize and Workers AI do not have local simulations. During development, D1 stores vectors and the Worker performs an exhaustive cosine-similarity scan. The exported `embed`, `queryVectors`, `upsertVector`, and `deleteVector` functions are the narrow seams to replace with Workers AI and Vectorize for a future cloud deployment.

## Prerequisites

- Current Node.js LTS and npm
- [Ollama](https://ollama.com/download)

## Run locally

```sh
npm install
ollama pull all-minilm
npm run db:migrate:local
npm run dev
```

Regex routing is enabled by default. To enable the ONNX fallback classifier, set
`SUBJECT_ONNX_ENABLED=true` in `wrangler.jsonc` (the default model is
`Xenova/all-MiniLM-L6-v2`). The model is loaded lazily and failures fall back to
the `general` bucket, so subject routing never makes the cache unavailable.

The Worker listens on `http://127.0.0.1:8787`. Local D1 and KV state persists under `.wrangler/state`. Press `e` in Wrangler to open Cloudflare's Local Explorer.

Store a response:

```sh
curl -X PUT http://127.0.0.1:8787/v1/cache/entries \
  -H 'content-type: application/json' \
  -d '{"namespace":"demo","prompt":"Why is the sky blue?","response":{"answer":"Rayleigh scattering"},"context":{"model":"example"}}'
```

Look up an exact or semantically similar prompt:

```sh
curl -X POST http://127.0.0.1:8787/v1/cache/lookup \
  -H 'content-type: application/json' \
  -d '{"namespace":"demo","prompt":"What makes the sky look blue?"}'
```

A miss is returned as `{"hit":false}`. The caller generates the answer and stores it with `PUT /v1/cache/entries`.

## API

- `PUT /v1/cache/entries` — store `{ namespace, prompt, response, context?, ttlSeconds? }`; TTL defaults to one day and must be at least 60 seconds.
- `POST /v1/cache/lookup` — find `{ namespace, prompt }`; the default cosine threshold is `0.90`.
- `DELETE /v1/cache/entries/:id` — remove an entry idempotently.
- `GET /health` — report local configuration without invoking Ollama.

The namespace and derived subject bucket constrain semantic scans. Context is returned with a hit but does not constrain reuse. Exact IDs remain based on embedding model, namespace, and normalized prompt, so subject routing can be changed without changing cache identity.

## Verify

```sh
npm test
npm run check
```

Tests run inside Cloudflare's local Worker runtime with isolated D1/KV storage and mocked deterministic embeddings. For a real-model smoke test, run Ollama and repeat the store/lookup commands above.

## Future Cloudflare migration

Keep KV and D1 for response bodies and relational context. Replace the local embedding call with Workers AI and the exhaustive D1 vector functions with a 384-dimension cosine Vectorize index. Re-embed existing prompts during migration: `all-minilm` and Workers AI models do not share an embedding space even when their dimensions match. Recalibrate `SIMILARITY_THRESHOLD` before enabling production reuse.

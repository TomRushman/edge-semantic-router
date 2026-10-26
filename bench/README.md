# Local benchmark

This benchmark stays small enough to run on a laptop. It uses 33 rows selected from the BANKING77 test split at commit `57ec275d8078af65b7731c2a98be812d844a6d6b`. The selection script records the source row and prints a SHA-256 checksum for the generated JSONL file. BANKING77 is licensed CC BY 4.0.

Install the project dependencies, then start Ollama and pull the same embedding model used by the worker:

```sh
ollama pull all-minilm
npm run benchmark
```

The runner embeds the reviewed fixture and the pinned subset, then reports exact hits, semantic hits, misses, useful hit rate, precision, recall, false-hit rate, false-miss rate, namespace leakage, a threshold sweep from 0.70 to 0.99, and p50/p95 lookup-embedding latency by outcome. It does not time the Worker, D1, or KV path, and it does not change `SIMILARITY_THRESHOLD` or write runtime cache data.

`golden.jsonl` contains 30 hand-reviewed cases with safe paraphrases and hard negatives. A hit is useful only when the fixture says the answer can be reused. BANKING77 rows are also paired by same intent and by adjacent different intents. Those pairs are reported separately. BANKING77 labels describe intent, not answer identity, so its rows are evidence for retrieval behavior rather than permission to reuse a response.

If Ollama is unavailable, the command writes a not-measured report. Run it again after starting Ollama. Each run replaces only `bench/results/latest.json` and `bench/results/latest.md`; the checked-in baseline files remain as an example of the unmeasured state.

Source links: [PolyAI BANKING77 repository](https://github.com/PolyAI-LDN/task-specific-datasets/tree/57ec275d8078af65b7731c2a98be812d844a6d6b/banking_data), [Hugging Face dataset card](https://huggingface.co/datasets/PolyAI/banking77), and the [dataset paper](https://aclanthology.org/2020.nlp4convai-1.5/).

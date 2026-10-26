# A small safety check for semantic cache hits

Semantic caching is easy to demo and hard to trust. A near-match can look convincing while answering a different question. For a support cache, that is enough to send the wrong policy, fee, or account instruction to a customer.

This project keeps the first evaluation deliberately small. The benchmark uses a reviewed fixture for the decisions that matter most, plus a deterministic subset of PolyAI's BANKING77 test data. The source is pinned to commit `57ec275d8078af65b7731c2a98be812d844a6d6b`, and the subset builder prints a checksum when it downloads the rows. The data is licensed CC BY 4.0. BANKING77 labels describe customer intent. They are useful for retrieval checks, but they do not prove that two answers are interchangeable.

There are two boundaries in the cache. A tenant namespace is the first boundary. It prevents one customer's answer from being returned to another customer. The subject partition is a narrower search bucket inside that namespace. In the current version the buckets are `accounting`, `accounts`, `billing`, `contact`, and `general`. They help reduce accidental matches, but they are not a substitute for namespace isolation.

The reviewed fixture contains safe paraphrases and hard negatives. The safe cases should hit. The hard negatives should miss even when the wording is close. The fixture includes differences such as a refund versus a transfer cancellation, a password reset versus a card PIN change, a statement lookup versus a statement dispute, and support hours versus delivery timing. Those are ordinary customer questions with different answers, which makes them better tests than random unrelated text.

The runner measures exact hits, semantic hits, misses, useful hit rate, precision, recall, false-hit rate, false-miss rate, namespace leakage, threshold behavior, and lookup embedding-call latency. It does not time the Worker, D1, or KV path. It chooses a threshold only from the development cases, then reports the held-out test result. A threshold with any false hit is rejected. Among the remaining thresholds, the runner chooses the highest recall and breaks ties by choosing the higher threshold. The worker's configured threshold is not changed automatically.

## What the first run found

The first local run used `all-minilm`, the pinned 33-row BANKING77 subset, and the 30 reviewed cases. The selected development threshold was `0.81`. It was the first threshold in the sweep with no false hits in the development cases.

| Measure | Result |
| --- | ---: |
| Exact hits | 1 |
| Semantic hits | 2 |
| Useful hit rate | 10.0% |
| Precision | 100.0% |
| Recall | 30.0% |
| False-hit rate | 0.0% |
| False-miss rate | 70.0% |
| Namespace leaks | 0 |

The result is conservative, perhaps too conservative. The cache avoided unsafe reuse in these examples, but it only found two of the reviewed semantic matches. BANKING77 was even stricter: one useful semantic hit across 32 constructed pairs. That is not evidence that the cache is ready to serve support answers. It is evidence that the current subject rules and threshold leave a lot of valid reuse on the table.

The semantic lookup embedding call had a 7.0 ms median and 7.1 ms p95 in this run. Misses had a 6.9 ms median and 10.3 ms p95. Those are embedding-call timings, not end-to-end Worker, D1, KV, or network timings. Exact lookups were not timed by this runner.

The run recorded no namespace leakage. That came from two explicit namespace cases, so it confirms the contract in a very narrow way. It does not substitute for a broader multi-tenant test.

The result file includes the model, dataset revision, and subset checksum: [latest benchmark report](../bench/results/latest.md). Re-run the benchmark after changing the model, fixture, category rules, or threshold policy.

The small sample is a safety smoke test. It cannot establish a production false-hit rate. A real launch still needs product-specific review, fresh examples, and monitoring for answers that change over time.

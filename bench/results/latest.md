# Semantic cache benchmark

Status: measured with all-minilm on 33 pinned BANKING77 rows.

- Exact hits: 1
- Semantic hits: 2
- Misses: 27
- Useful hit rate: 10.0%
- Precision: 100.0%
- Recall: 30.0%
- False-hit rate: 0.0%
- False-miss rate: 70.0%
- Namespace leaks: 0
- Held-out test precision/recall: 100.0%/100.0%
- Lookup embedding latency by outcome: exact p50/p95: n/a/n/a ms; semantic p50/p95: 7.2/7.6 ms; miss p50/p95: 7.3/10.9 ms
- Selected development threshold: 0.81

BANKING77 pair check: 32 pairs, useful hit rate 3.1%, false-hit rate 0.0%.

BANKING77 intent labels are used as a proxy for answer equivalence. Review product-specific answers before enabling reuse.

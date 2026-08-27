# Performance mental model

**Position:** Cross-cutting

Phân biệt latency, throughput, concurrency và resource saturation. Tối ưu sau khi đo; bottleneck có thể nằm ở browser/network/app/DB/cache/external API.

Experiment: load nhỏ tăng dần, đo p50/p95/p99 và resource usage; thay một yếu tố mỗi lần.

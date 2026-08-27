# Cache invalidation

**Position:** Backend → Redis ↔ Database

Câu hỏi: cache cái gì, key thế nào, TTL bao lâu, mutation invalidates gì, stale data chấp nhận được bao lâu?

Experiment: cache-aside read; sửa DB trực tiếp; quan sát stale; mutation nhưng quên delete/update cache.

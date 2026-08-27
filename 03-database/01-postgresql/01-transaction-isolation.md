# Transactions & isolation

**Position:** Backend ↔ PostgreSQL

Transaction bảo vệ một tập thay đổi như một đơn vị, nhưng concurrency vẫn có anomaly tùy access pattern/isolation.

Experiment: hai request cùng cập nhật balance/inventory; chạy concurrent; quan sát lost update/conflict; thử locking hoặc optimistic version.

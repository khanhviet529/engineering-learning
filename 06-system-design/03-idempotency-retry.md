# Idempotency & retry

**Position:** Client/Service → Distributed system

Retry có thể biến transient failure thành success nhưng mutation lặp có thể gây duplicate side effects. Thiết kế idempotency key/unique constraint/state transition phù hợp với operation.

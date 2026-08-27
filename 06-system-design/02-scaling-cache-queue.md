# Scaling: cache, queue, replicas

Scale không chỉ là thêm server. Cache giảm repeated work nhưng thêm consistency complexity. Queue tách producer/consumer và absorb bursts nhưng thêm retry/ordering/idempotency concerns. Replicas tăng capacity/availability nhưng thêm distributed coordination.

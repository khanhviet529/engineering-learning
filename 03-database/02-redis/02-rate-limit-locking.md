# Redis cho coordination

**Position:** Multiple app instances ↔ Redis

Redis có thể hỗ trợ rate limiting, counters, short-lived coordination. Đừng mặc định mọi distributed lock đều an toàn; luôn xác định failure model, TTL và tính chất critical của thao tác.

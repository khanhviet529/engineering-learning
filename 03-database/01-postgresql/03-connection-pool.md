# Connection pool

**Position:** NestJS → PostgreSQL

DB connection là tài nguyên hữu hạn. Pool tái sử dụng connection và áp backpressure gián tiếp nhưng có thể bị exhaustion/leak.

Break: giới hạn pool thấp, gửi nhiều concurrent requests, restart DB, giữ transaction mở lâu.

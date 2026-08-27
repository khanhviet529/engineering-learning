# Node.js

Node như một **runtime có một thread JavaScript và một mô hình đồng thời cụ thể**. Gần như mọi vấn đề production của một Node service quy về một trong ba câu: có gì đang chặn event loop, memory đi đâu, và process có thoát sạch không.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Node runtime & concurrency](01-node-runtime-concurrency.md) | Vì sao 10.000 kết nối ổn nhưng một vòng lặp 3 giây làm đứng tất cả? |
| 2 | [Streams & buffers](02-streams-buffers.md) | Vì sao export CSV làm pod bị OOMKilled? |
| 3 | [Process & memory](03-process-memory.md) | Exit 137 không log — debug bằng cách nào? |
| 4 | [Worker threads & CPU](04-worker-threads-cpu.md) | Việc CPU-bound nên đi đâu? |
| 5 | [Graceful shutdown](05-graceful-shutdown.md) | Vì sao mỗi lần deploy mất một ít request? |
| 6 | [Module system trong Node](06-module-system-node.md) | Vì sao circular import biến thành lỗi DI? |

Note 6 là note nên đọc **trước khi sang NestJS** — circular import và `reflect-metadata` là hai nguồn lỗi DI phổ biến nhất, và cả hai đều là vấn đề module, không phải vấn đề framework.

## Ba metric mà mọi Node service nên có

1. **Event loop lag (p99)** — phát hiện code đồng bộ chặn. CPU usage không phát hiện được điều này. → [1](01-node-runtime-concurrency.md)
2. **`heapUsed`** — phát hiện leak. RSS là tín hiệu nhiễu. → [3](03-process-memory.md)
3. **Số lỗi trong cửa sổ deploy** — xác nhận graceful shutdown thật sự hoạt động. → [5](05-graceful-shutdown.md)

Không có ba chỉ số này, bạn chỉ biết có vấn đề khi pod bị restart.

## Năm hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| Node là multi-threaded | JS chạy một thread; libuv có pool 4 cho *một số* việc I/O | [1](01-node-runtime-concurrency.md) |
| Network I/O dùng thread pool | Không — dùng epoll/kqueue. Chỉ fs/dns/crypto/zlib dùng pool | [1](01-node-runtime-concurrency.md) |
| `.pipe()` xử lý lỗi và backpressure | Không lan lỗi, không cleanup. Dùng `pipeline()` | [2](02-streams-buffers.md) |
| `--max-old-space-size` giới hạn toàn bộ memory | Chỉ heap; `external` (Buffer) không tính | [3](03-process-memory.md) |
| `server.close()` là graceful shutdown | Cần readiness=false + delay **trước** đó | [5](05-graceful-shutdown.md) |
| `forwardRef` sửa circular dependency | Nó chỉ hoãn phân giải; vòng lặp vẫn còn | [6](06-module-system-node.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Một endpoint chậm làm mọi endpoint chậm | event loop bị chặn → [1](01-node-runtime-concurrency.md) |
| CPU thấp nhưng latency cao | thread pool cạn, hoặc connection pool cạn → [1](01-node-runtime-concurrency.md) |
| Health check timeout dưới tải | CPU-bound trong handler → [4](04-worker-threads-cpu.md) |
| RSS tăng theo kích thước dữ liệu | đang buffer thay vì stream → [2](02-streams-buffers.md) |
| `heapUsed` tăng đều, restart thì hết | leak (Map global, listener, timer) → [3](03-process-memory.md) |
| Exit code 137, không log | OOMKilled — heap limit > container limit → [3](03-process-memory.md) |
| Exit code 143 | SIGTERM, shutdown bình thường → [5](05-graceful-shutdown.md) |
| 502 chỉ trong lúc deploy | thiếu delay trước `server.close()` → [5](05-graceful-shutdown.md) |
| Container mất ~30s mới tắt | PID 1 là `npm`, không forward SIGTERM → [5](05-graceful-shutdown.md) |
| Process không chịu thoát | worker thread / timer chưa dọn → [4](04-worker-threads-cpu.md) |
| `Nest can't resolve dependencies of X (?)` | circular import, không phải lỗi DI → [6](06-module-system-node.md) |
| `Reflect.getMetadata is not a function` | `reflect-metadata` nạp sai thứ tự → [6](06-module-system-node.md) |
| `ERR_MODULE_NOT_FOUND` dù file có thật | ESM thiếu đuôi `.js` → [6](06-module-system-node.md) |
| `instanceof` thất bại bí ẩn | hai bản cùng package → [6](06-module-system-node.md) |

## Quyết định cấu hình quan trọng

```dockerfile
# heap limit = 75–80% container memory limit → lỗi JS có stack trace thay vì SIGKILL
ENV NODE_OPTIONS="--max-old-space-size=384"     # với limit 512Mi

# node là PID 1 để nhận SIGTERM
CMD ["node", "dist/main.js"]                    # KHÔNG dùng `npm start`
```

Hai dòng này giải quyết hai lớp vấn đề khó debug nhất trong danh sách trên.

## Position

```text
HTTP request → Node.js runtime (event loop, libuv) → NestJS → Domain → DB
                       ↑ folder này
```

## Related

- [Event loop & async](../../01-web-frontend/01-javascript-typescript/01-event-loop-async.md) — cơ chế nền, đọc trước
- [Memory & GC](../../01-web-frontend/01-javascript-typescript/05-memory-gc.md) — quy trình tìm leak
- [00-http-api/](../00-http-api/README.md) — hợp đồng mà runtime này phục vụ
- [02-nestjs/](../02-nestjs/README.md) — framework trên runtime này
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md) — so với thread và distributed
- [Memory, CPU & limits](../../04-infrastructure/00-linux/02-memory-cpu-limits.md) — cgroup, OOMKilled
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md) — nơi việc nặng nên đi

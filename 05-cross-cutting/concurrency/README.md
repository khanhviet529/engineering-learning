---
level: advanced
area: cross-cutting
---

# Concurrency

Ba câu định hình toàn bộ folder này:

> **Concurrency là nhiều việc đang diễn ra; parallelism là nhiều việc chạy cùng lúc.** Chọn mô hình theo loại việc — I/O-bound cần cái đầu, CPU-bound cần cái sau.
>
> **JavaScript đơn luồng không có data race, nhưng có logic race.** Mọi `await` là điểm mà request khác chen vào được.
>
> **Race condition là bug chỉ xuất hiện khi hệ thống thành công** — nó cần lưu lượng cao mới lộ ra, và nó im lặng.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Concurrency models](01-concurrency-models.md) | Vì sao worker threads làm service này nhanh gấp 3 và service kia chậm đi 15%? |
| 2 | [Shared state & races](02-shared-state-races.md) | Giới hạn 100 suất, vì sao bán được 137? |
| 3 | [Distributed locks](03-distributed-locks.md) | Khoá hoạt động đúng như thiết kế — vì sao vẫn có hai job cùng chạy? |

Note 2 là note quan trọng nhất: nó là lớp bug tốn kém nhất và khó phát hiện nhất trong folder này.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Thêm worker threads mà không nhanh hơn | việc là I/O-bound, không phải CPU-bound | [1](01-concurrency-models.md) |
| Endpoint không chạm I/O cũng chậm | việc CPU chặn event loop | [1](01-concurrency-models.md) |
| `fs`/DNS chậm bất thường | cạn thread pool libuv (bcrypt, zlib) | [1](01-concurrency-models.md) |
| `Promise.all` trên mảng lớn làm cạn pool DB | thiếu giới hạn đồng thời | [1](01-concurrency-models.md) |
| Throughput giảm khi tăng số đồng thời | tranh chấp vượt lợi ích | [1](01-concurrency-models.md) |
| Vượt giới hạn số lượng (coupon, tồn kho) | check-then-act | [2](02-shared-state-races.md) |
| Cập nhật bị mất | read-modify-write | [2](02-shared-state-races.md) |
| Bản ghi trùng lặp dù có kiểm tra | thiếu ràng buộc unique | [2](02-shared-state-races.md) |
| Bất biến trên nhiều dòng bị vi phạm | write skew — cần SERIALIZABLE | [2](02-shared-state-races.md) |
| Lỗi 500 ngẫu nhiên sau khi nâng isolation | SERIALIZABLE không có vòng retry | [2](02-shared-state-races.md) |
| Thao tác chạy hai lần sau timeout | idempotency chỉ bằng câu `if` | [2](02-shared-state-races.md) |
| Job theo lịch chạy N lần | `@Cron` trên mọi replica | [3](03-distributed-locks.md) |
| Hai job cùng chạy dù có khoá | TTL ngắn hơn thời gian chạy | [3](03-distributed-locks.md) |
| Khoá bị xoá bởi tiến trình khác | `DEL` không kiểm tra ownership | [3](03-distributed-locks.md) |
| Process treo rồi tỉnh dậy và ghi tiếp | thiếu fencing token | [3](03-distributed-locks.md) |
| Khoá kẹt sau khi process chết | TTL quá dài, không gia hạn | [3](03-distributed-locks.md) |
| Code đúng với 1 pod, sai với nhiều pod | trạng thái phối hợp in-memory | [1](01-concurrency-models.md), [3](03-distributed-locks.md) |

## Mười quyết định mặc định

```text
Chọn mô hình
 1. Phân loại việc I/O-bound hay CPU-bound TRƯỚC khi chọn công cụ.
 2. Việc CPU nặng ra khỏi request path — queue + worker riêng là mặc định.
 3. Giới hạn số đồng thời cho mọi thao tác hàng loạt; đo điểm tối ưu, không đoán.

Chống race
 4. Nguyên tử hoá ở database trước mọi cơ chế khoá:
    UPDATE ... SET x = x + 1 WHERE điều_kiện
 5. Ràng buộc (unique, check) cho MỌI bất biến — lớp không thể quên.
 6. Optimistic lock khi xung đột hiếm; pessimistic khi nhiều.
 7. SERIALIZABLE cho logic phức tạp — LUÔN kèm vòng retry có jitter.
 8. Idempotency bằng ràng buộc UNIQUE, không bằng câu `if`.

Nhiều instance
 9. Trạng thái phối hợp ở Redis/DB, không trong process.
10. Job theo lịch: Kubernetes CronJob hoặc leader election, không `@Cron` trên mọi pod.
```

## Thang lựa chọn cho "chỉ một bên được làm"

```text
Từ đơn giản và an toàn nhất, xuống phức tạp và rủi ro nhất:

① THIẾT KẾ IDEMPOTENT            chạy hai lần cũng vô hại → không cần loại trừ
② UPDATE ... WHERE điều kiện      nguyên tử, một lệnh
③ FOR UPDATE SKIP LOCKED          hàng đợi trong database
④ Phân vùng theo khoá             cùng khoá → cùng consumer → tuần tự tự nhiên
⑤ Advisory lock (PostgreSQL)      tự giải phóng khi kết nối đứt
⑥ Leader election / K8s CronJob   cho công việc theo lịch
⑦ Khoá Redis + FENCING            khi không còn cách nào khác

Mỗi bậc đi xuống là thêm một thứ có thể hỏng.
```

## Ba sự thật khó chịu

```text
① KHOÁ PHÂN TÁN KHÔNG ĐẢM BẢO LOẠI TRỪ TUYỆT ĐỐI
   Process treo 40 giây (GC, phân vùng mạng) → khoá hết hạn → bên khác vào
   → nó tỉnh dậy và ghi tiếp.
   ⇒ khoá là TỐI ƯU; tính đúng đắn phải ở TẦNG DỮ LIỆU (fencing token).

② ISOLATION CAO KHÔNG LOẠI BỎ XỬ LÝ XUNG ĐỘT
   Nó chuyển "dữ liệu sai im lặng" thành "lỗi rõ ràng cần retry".
   Cải thiện lớn — nhưng chỉ khi bạn CÓ vòng retry.

③ CODE VẪN "CHẠY" KHI NÓ NGỪNG ĐÚNG
   Biến in-memory, Set khử trùng lặp, khoá trong process:
   tất cả vẫn chạy khi scale lên 2 pod — chúng chỉ ngừng ĐÚNG.
```

## Bốn câu hỏi cho mọi thao tác ghi

```text
① Nếu hai request làm việc này CÙNG LÚC trên cùng dữ liệu, kết quả có đúng không?
② Bất biến ở đây được bảo vệ bởi CODE hay bởi DATABASE?
③ Nếu request bị retry, thao tác có chạy hai lần không?
④ Nếu chạy với 5 instance thay vì 1, còn đúng không?
```

Câu ② là câu phân biệt hệ thống chịu được tải với hệ thống chỉ chưa gặp tải. Nếu bất biến chỉ được kiểm tra bằng `if` trong code, nó chưa được bảo vệ.

## Test đồng thời: mẫu dùng lại được

```ts
it('không vượt giới hạn khi N request đồng thời', async () => {
  await seed({ limit: 100 });

  const results = await Promise.allSettled(
    Array.from({ length: 500 }, () => callEndpoint()),
  );

  const ok = results.filter(r => r.status === 'fulfilled' && r.value.status === 201);
  expect(ok).toHaveLength(100);
  expect((await readState()).used).toBe(100);
});
```

Test tuần tự **không bao giờ** bắt được race. Mẫu này biến một bug không tái lập được thành một test xác định — và nó là thứ ngăn bug quay lại sau refactor.

## Position

```text
                    ┌─ event loop        │ CPU nặng → queue/worker    [1]
Request đồng thời ──┼─ thread pool libuv │ bcrypt, zlib, fs           [1]
                    └─ nhiều pod         │ trạng thái phải ở ngoài    [1][3]
        ↓
Trạng thái dùng chung ── nguyên tử · ràng buộc · isolation · lock     [2]
        ↓
Nhiều instance ── advisory lock · leader · khoá Redis + fencing       [3]
```

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Performance](../performance/README.md) — giới hạn đồng thời và tranh chấp
- [Reliability](../reliability/README.md) — retry tạo ra đồng thời
- [Testing](../testing/README.md) — khi flaky hoá ra là race thật
- [Event loop](../../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) — cơ chế nền
- [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) — mức isolation
- [Locking & deadlock](../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) — khoá ở PostgreSQL
- [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md) — khoá ở Redis
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — lựa chọn tốt hơn khoá

## Version / Context

Ví dụ dùng Node.js 20+, NestJS 10/11, PostgreSQL 16, Redis 7, Kubernetes 1.29+. PostgreSQL mặc định READ COMMITTED; REPEATABLE READ ở đây là snapshot isolation có phát hiện lost update; SERIALIZABLE dùng SSI. Phân tích giới hạn của khoá phân tán theo Martin Kleppmann; write skew theo *Designing Data-Intensive Applications*.

---
level: advanced
area: cross-cutting
prerequisites:
  - 02-shared-state-races.md
related:
  - ../../03-database/02-redis/02-rate-limit-locking.md
  - ../reliability/01-failure-modes.md
---

# Distributed locks

> Một job đồng bộ dữ liệu chạy mỗi 5 phút, được bảo vệ bằng khoá Redis với TTL 60 giây. Nó chạy đúng hàng nghìn lần. Rồi một hôm, database chậm bất thường và job mất 90 giây. Ở giây thứ 60, khoá **tự hết hạn**; pod thứ hai lấy được khoá và bắt đầu chạy. Trong 30 giây, hai job cùng ghi vào cùng bảng. Khi job đầu kết thúc, nó **xoá khoá của job thứ hai** — và một pod thứ ba nhảy vào. **Khoá vẫn hoạt động đúng như thiết kế; thiết kế mới là thứ sai.**

## Position

```text
Một process        → biến, mutex trong bộ nhớ
Nhiều process/máy  → cần một BÊN THỨ BA làm trọng tài
                     ↑ và bên đó cũng có thể hỏng, chậm, hoặc bị phân vùng mạng
```

## Problem

```text
Khoá phân tán trông đơn giản nhưng phải trả lời bốn câu hỏi khó:

  ① Nếu process giữ khoá CHẾT — ai gỡ khoá?           → TTL
  ② Nếu nó chỉ CHẬM hơn TTL — chuyện gì xảy ra?        → hai bên cùng chạy
  ③ Làm sao không xoá nhầm khoá của người khác?        → fencing/ownership
  ④ Nếu chính hệ thống khoá hỏng — hệ thống bạn thế nào? → fail open hay closed
```

Sự cố ở đầu note là câu ② và ③ cùng lúc.

## Mental Model

### TTL là một lời hứa bạn không giữ được

```text
TTL quá NGẮN  → khoá hết hạn khi công việc còn chạy → HAI bên cùng chạy
TTL quá DÀI   → process chết → khoá kẹt cho tới khi hết hạn → dịch vụ dừng

Và không có giá trị "đúng":
  bạn không biết trước công việc mất bao lâu trong điều kiện xấu nhất.
```

```text
Giảm nhẹ: GIA HẠN ĐỊNH KỲ (watchdog)
  TTL ngắn (30s) + gia hạn mỗi 10s trong lúc chạy
  → process chết → không gia hạn nữa → khoá tự giải phóng sau 30s
  → process chạy lâu → khoá được giữ hợp lệ
  ⚠ nhưng nếu process bị TREO (GC dài, mạng đứt) mà chưa chết:
    nó ngừng gia hạn → khoá hết hạn → và nó VẪN CÓ THỂ tỉnh lại và ghi tiếp
```

### Khoá phân tán không đảm bảo loại trừ tuyệt đối

Đây là điều quan trọng nhất trong note này:

```text
Không có khoá phân tán nào ngăn được kịch bản:
  ① A lấy khoá
  ② A bị treo (GC 40 giây / mạng phân vùng / VM bị đình chỉ)
  ③ khoá hết hạn, B lấy được
  ④ A tỉnh dậy, KHÔNG BIẾT mình đã mất khoá, và tiếp tục ghi

⇒ Khoá phân tán là công cụ TỐI ƯU (tránh làm việc thừa),
  KHÔNG phải cơ chế đảm bảo ĐÚNG ĐẮN.

⇒ Tính đúng đắn phải được bảo vệ ở TẦNG DỮ LIỆU.
```

### Fencing token: cách duy nhất làm nó an toàn

```text
Mỗi lần cấp khoá, trọng tài trả về một SỐ TĂNG DẦN:
  A nhận token 33 → treo
  B nhận token 34 → ghi với token 34 → store lưu 34
  A tỉnh dậy, ghi với token 33 → store TỪ CHỐI (33 < 34)
```

```sql
-- store thực thi fencing: chỉ chấp nhận token lớn hơn token đã thấy
UPDATE sync_state
   SET last_synced_at = $1, fence_token = $2
 WHERE resource = $3 AND fence_token < $2;
-- 0 dòng = token cũ = bạn đã mất khoá → dừng ngay
```

```text
Yêu cầu: STORE phải kiểm tra token. Nếu store không kiểm tra,
fencing token chỉ là một con số vô nghĩa.
```

Đây là lý do fencing hiếm khi được triển khai đầy đủ — nó đòi hỏi thay đổi ở phía **người nhận ghi**, không chỉ ở phía khoá.

### Redis lock: làm đúng phần làm được

```ts
// LẤY: SET NX EX — nguyên tử, có giá trị NGẪU NHIÊN làm ownership
const token = randomUUID();
const acquired = await redis.set(`lock:${key}`, token, 'NX', 'EX', 30);
if (!acquired) throw new LockUnavailableError();
```

```ts
// GIẢI PHÓNG: chỉ xoá NẾU vẫn là khoá CỦA MÌNH — phải nguyên tử
const RELEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end`;
await redis.eval(RELEASE, 1, `lock:${key}`, token);
```

```text
Vì sao phải dùng Lua:
  GET rồi DEL là hai lệnh → khoá có thể hết hạn GIỮA hai lệnh
  → bạn xoá khoá của người khác   ← đúng lỗi thứ hai trong sự cố ở đầu note
```

```ts
// GIA HẠN: cũng phải kiểm tra ownership
const EXTEND = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("expire", KEYS[1], ARGV[2])
  else
    return 0
  end`;
```

### Redlock: phức tạp hơn và vẫn không đủ

```text
Redlock lấy khoá trên N instance Redis độc lập, cần đa số đồng ý.

Nó cải thiện: chịu được mất một instance Redis.
Nó KHÔNG giải quyết: treo process, lệch đồng hồ, phân vùng mạng.

⇒ Với hầu hết trường hợp: khoá Redis đơn giản + fencing ở store
  vừa đơn giản hơn vừa an toàn hơn Redlock không có fencing.
```

### Lựa chọn thay thế thường tốt hơn

```text
① KHOÁ Ở DATABASE — nơi dữ liệu đã ở đó
   PostgreSQL advisory lock:
     SELECT pg_try_advisory_xact_lock(hashtext('sync:orders'));
   + tự giải phóng khi transaction kết thúc HOẶC kết nối đứt  ← không cần TTL
   + cùng hệ thống với dữ liệu → không có vấn đề nhất quán chéo
   − giữ một kết nối, không dùng được xuyên nhiều database

② ĐIỀU KIỆN TRONG CÂU UPDATE — không cần khoá
   UPDATE jobs SET status='running', worker=$1
    WHERE id=$2 AND status='pending';
   → 0 dòng = ai đó đã lấy → không cần khoá nào cả

③ HÀNG ĐỢI PHÂN VÙNG THEO KHOÁ
   mọi việc của cùng một khoá vào cùng partition → xử lý tuần tự tự nhiên
   → Kafka partition key, BullMQ với group

④ BẦU CHỌN LEADER
   một instance làm việc theo lịch; các instance khác chờ
   → Kubernetes Lease, hoặc CronJob của K8s (chỉ chạy một pod)

⑤ THIẾT KẾ IDEMPOTENT — không cần loại trừ
   chạy hai lần cũng cho cùng kết quả → khoá thành tối ưu, không phải yêu cầu
```

```text
Thứ tự ưu tiên thực tế: ⑤ > ② > ③ > ④ > ① > khoá Redis
Mỗi bậc đi xuống là thêm một thứ có thể hỏng.
```

Lựa chọn ⑤ đáng cân nhắc nghiêm túc trước mọi lựa chọn khác: nếu thao tác idempotent, toàn bộ vấn đề trong note này trở thành vấn đề hiệu năng thay vì vấn đề đúng đắn.

### Job theo lịch trên nhiều replica

```text
@Cron('0 * * * *') trên 5 pod → chạy 5 lần

Bốn cách xử lý, theo độ tin cậy:
  ① Kubernetes CronJob                  → K8s đảm bảo một pod (concurrencyPolicy: Forbid)
  ② Bầu chọn leader (K8s Lease)         → một pod làm mọi job theo lịch
  ③ Khoá phân tán quanh mỗi lần chạy    → cần TTL, cần fencing
  ④ Job idempotent + ghi nhận lần chạy  → chạy nhiều lần cũng vô hại
```

### Khoá hỏng thì sao

```text
Redis chết:
  FAIL CLOSED  không lấy được khoá → không chạy job
               ✓ đúng khi chạy hai lần gây hại thật (chuyển tiền)
  FAIL OPEN    không lấy được khoá → chạy luôn
               ✓ đúng khi chạy hai lần chỉ tốn tài nguyên

Quyết định theo HẬU QUẢ, và ghi nó vào code kèm lý do.
```

## Example

Job đồng bộ an toàn — kết hợp khoá (tối ưu) với fencing (đúng đắn):

```ts
@Injectable()
export class SyncJob {
  @Cron('*/5 * * * *')
  async run() {
    const lock = await this.locks.acquire('sync:orders', { ttlMs: 30_000 });
    if (!lock) {
      syncSkipped.inc({ reason: 'lock_held' });     // bình thường, không phải lỗi
      return;
    }

    const renew = setInterval(() => {
      lock.extend(30_000).catch(err =>
        this.logger.warn({ err }, 'không gia hạn được khoá'));
    }, 10_000);                                      // ① gia hạn khi còn 2/3 TTL

    try {
      await this.syncOrders(lock.fenceToken);        // ② truyền token XUỐNG store
    } finally {
      clearInterval(renew);
      await lock.release();                          // ③ chỉ xoá nếu vẫn là của mình
    }
  }

  private async syncOrders(fenceToken: number) {
    for (const batch of await this.fetchBatches()) {
      // ④ MỌI lần ghi đều kiểm tra token — đây là thứ đảm bảo ĐÚNG ĐẮN
      const rows = await this.db.$executeRaw`
        UPDATE sync_state
           SET cursor = ${batch.cursor}, fence_token = ${fenceToken}
         WHERE resource = 'orders' AND fence_token <= ${fenceToken}`;

      if (rows === 0) {
        fenceRejected.inc();
        throw new LostLockError('khoá đã bị chiếm bởi tiến trình khác — dừng');
      }
      await this.writeBatch(batch);
    }
  }
}
```

```ts
// fence token tăng dần — Redis INCR là nguyên tử
async acquire(key: string, opts: { ttlMs: number }) {
  const token = randomUUID();
  const ok = await this.redis.set(`lock:${key}`, token, 'PX', opts.ttlMs, 'NX');
  if (!ok) return null;

  const fenceToken = await this.redis.incr(`fence:${key}`);
  return new Lock(this.redis, key, token, fenceToken);
}
```

Điểm quyết định là bước ④: **khoá có thể sai, store thì không**. Nếu job cũ tỉnh dậy sau khi bị treo và cố ghi, `fence_token <= ...` từ chối nó và job tự dừng.

Và lựa chọn đơn giản hơn khi diễn đạt được — không cần khoá nào:

```ts
// lấy job theo cách nguyên tử: không khoá, không TTL, không fencing
async claimNextJob(workerId: string) {
  const rows = await this.db.$queryRaw<Job[]>`
    UPDATE jobs
       SET status = 'running', worker_id = ${workerId}, started_at = now()
     WHERE id = (
       SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED        -- ← bỏ qua dòng đang bị worker khác khoá
        LIMIT 1
     )
    RETURNING *`;
  return rows[0] ?? null;
}
```

`FOR UPDATE SKIP LOCKED` là mẫu hàng đợi trong database: nhiều worker lấy việc đồng thời, không worker nào lấy trùng, và không cần bất kỳ hệ thống khoá nào bên ngoài.

## Prediction

1. Khoá TTL 60 giây, job mất 90 giây — chuyện gì xảy ra ở giây thứ 60?
2. Job đầu kết thúc và gọi `DEL lock:key` — nó xoá khoá của ai?
3. Dùng Lua kiểm tra ownership trước khi xoá — kết quả?
4. Process bị GC treo 40 giây, TTL 30 giây, rồi tỉnh dậy và ghi — khoá có ngăn được không?
5. Có fencing token và store kiểm tra — có ngăn được không?
6. Có fencing token nhưng store KHÔNG kiểm tra — có ngăn được không?
7. `GET` rồi `DEL` (hai lệnh), khoá hết hạn giữa hai lệnh — chuyện gì xảy ra?
8. `@Cron` trên 5 pod, không có khoá — job chạy mấy lần?
9. Kubernetes CronJob với `concurrencyPolicy: Forbid` — mấy lần?
10. PostgreSQL advisory lock, kết nối đứt đột ngột — khoá thế nào?
11. Redis lock, process chết đột ngột, TTL 300 giây — khoá thế nào?
12. `FOR UPDATE SKIP LOCKED` với 10 worker lấy việc đồng thời — có trùng không?
13. Redis chết, code fail closed cho job đồng bộ dữ liệu — chuyện gì xảy ra?
14. Job idempotent chạy hai lần — hậu quả?

<details>
<summary>Đáp án</summary>

1. Khoá **hết hạn**; pod khác lấy được → hai job cùng chạy.
2. **Khoá của pod thứ hai** — nó không kiểm tra ownership.
3. Không xoá — `GET` trả về token khác → `DEL` không chạy.
4. **Không** — đây là giới hạn cơ bản của khoá phân tán.
5. **Có** — store từ chối token cũ.
6. **Không** — token chỉ có nghĩa khi store kiểm tra nó.
7. Bạn **xoá khoá của người khác**.
8. **5 lần.**
9. **Một lần.**
10. **Tự giải phóng ngay** — nó gắn với kết nối/transaction.
11. **Kẹt 300 giây** — không ai chạy được.
12. **Không** — mỗi worker lấy một dòng khác nhau.
13. Job **không chạy** — dữ liệu không được đồng bộ cho tới khi Redis trở lại.
14. **Không có hậu quả** — và đó là lý do thiết kế idempotent tốt hơn mọi khoá.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt TTL ngắn hơn thời gian job | Hai job có cùng chạy không? |
| Dừng process giữa chừng (SIGKILL) | Khoá kẹt bao lâu? |
| Dùng `DEL` thay vì Lua kiểm tra ownership | Có xoá nhầm không? |
| Tạm dừng process (SIGSTOP) quá TTL rồi tiếp tục | Nó có ghi tiếp không? |
| Thêm fencing và lặp lại | Ghi có bị từ chối không? |
| Bỏ kiểm tra token ở store | Fencing còn tác dụng gì? |
| Chạy `@Cron` với 3 pod | Mấy lần? |
| Ngắt Redis khi đang giữ khoá | Gia hạn thất bại — code xử lý thế nào? |
| Đóng kết nối đang giữ advisory lock | Khoá tự giải phóng chưa? |
| 10 worker cùng `FOR UPDATE SKIP LOCKED` | Có job nào bị lấy hai lần không? |
| Chạy job hai lần thủ công | Kết quả có khác không? (kiểm tra idempotency) |

## What Usually Goes Wrong

- **TTL ngắn hơn thời gian chạy thực tế** trong điều kiện xấu.
- **Không gia hạn khoá** cho công việc dài.
- **`DEL` không kiểm tra ownership** → xoá nhầm khoá người khác.
- **`GET` rồi `DEL`** thay vì Lua nguyên tử.
- **Tin rằng khoá đảm bảo loại trừ tuyệt đối.**
- **Không có fencing token**, hoặc có nhưng store không kiểm tra.
- **Dùng khoá phân tán khi advisory lock hoặc `UPDATE ... WHERE` là đủ.**
- **Không quyết định fail open/closed** khi hệ thống khoá hỏng.
- **Job theo lịch không xử lý nhiều replica.**
- **TTL rất dài** → khoá kẹt lâu khi process chết.
- **Không đo** số lần bỏ qua vì khoá, số lần fence bị từ chối.
- **Coi việc không lấy được khoá là lỗi** → alert nhiễu.
- **Redlock cho vấn đề mà khoá đơn giản + fencing giải quyết tốt hơn.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Khoá phân tán đảm bảo chỉ một bên chạy | Treo process phá vỡ mọi khoá dựa trên TTL |
| TTL dài hơn thì an toàn hơn | Nó làm khoá kẹt lâu hơn khi process chết |
| Redlock giải quyết vấn đề của khoá đơn | Nó không giải quyết treo và lệch đồng hồ |
| Fencing token là tuỳ chọn | Không có nó, khoá chỉ là tối ưu |
| Có fencing token là đủ | Store phải kiểm tra nó |
| `SET NX EX` rồi `DEL` là đủ | `DEL` phải kiểm tra ownership, nguyên tử |
| Khoá là cách đúng để tránh chạy trùng | Idempotency thường tốt hơn |
| Advisory lock kém hơn Redis lock | Nó tự giải phóng khi kết nối đứt — an toàn hơn |
| Không lấy được khoá là lỗi | Đó là hành vi bình thường |
| Khoá làm hệ thống đơn giản hơn | Nó thêm một phụ thuộc và bốn câu hỏi khó |

## Debugging

1. **Nghi hai bên cùng chạy** → log `workerId` và `fenceToken` ở mỗi lần ghi; hai worker khác nhau trong cùng khoảng thời gian là bằng chứng.
2. **Khoá kẹt** → `TTL lock:key` trong Redis; nếu là `-1`, khoá không có TTL (lỗi cấu hình).
3. **Job không chạy** → nó bị bỏ qua vì khoá, hay không được lên lịch? Metric phân biệt hai trường hợp.
4. **Xoá nhầm khoá** → kiểm tra code giải phóng có dùng Lua kiểm tra ownership không.
5. **Gia hạn thất bại** → Redis chậm hay mạng đứt? Code có dừng công việc khi không gia hạn được không?
6. **Đếm `fenceRejected`** — khác 0 nghĩa là kịch bản treo đang thực sự xảy ra.
7. **Advisory lock**: `SELECT * FROM pg_locks WHERE locktype = 'advisory';` cho biết ai đang giữ.
8. **Sau sự cố chạy trùng**: dữ liệu có bị hỏng không? Có job đối soát nào phát hiện được không?

## Production Considerations

- **Ưu tiên không cần khoá**: idempotency, `UPDATE ... WHERE`, `FOR UPDATE SKIP LOCKED`, phân vùng theo khoá.
- **Advisory lock của PostgreSQL** khi công việc đã ở trong database — nó tự giải phóng khi kết nối đứt.
- **Kubernetes CronJob hoặc Lease** cho job theo lịch, thay vì `@Cron` trên mọi pod.
- **Nếu dùng khoá Redis**: `SET NX PX` + giá trị ngẫu nhiên + Lua cho release và extend.
- **Gia hạn khi còn 1/3 TTL**, và **dừng công việc** nếu gia hạn thất bại.
- **Fencing token, và store PHẢI kiểm tra nó** — không có bước thứ hai thì bước thứ nhất vô nghĩa.
- **Quyết định fail open/closed** và ghi lý do vào code.
- **TTL đủ dài cho trường hợp bình thường**, dựa vào gia hạn cho trường hợp chậm.
- **Metric**: số lần bỏ qua vì khoá, thời gian giữ khoá, số lần gia hạn thất bại, số lần fence bị từ chối.
- **Không alert khi không lấy được khoá** — alert khi job **không chạy được** trong N chu kỳ.
- **Job đối soát** cho dữ liệu quan trọng — phát hiện hậu quả của chạy trùng.
- **Test kịch bản treo**: `SIGSTOP` process quá TTL rồi `SIGCONT`, xem fencing có chặn không.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không khoá (idempotent) | đơn giản nhất, không có gì hỏng | phải thiết kế idempotency |
| `UPDATE ... WHERE` | nguyên tử, không phụ thuộc thêm | chỉ diễn đạt được logic đơn giản |
| `FOR UPDATE SKIP LOCKED` | hàng đợi trong DB, không hệ thống ngoài | tải lên database |
| Advisory lock | tự giải phóng, cùng hệ thống với dữ liệu | giữ một kết nối |
| Khoá Redis | nhanh, dùng chung nhiều dịch vụ | TTL, fencing, thêm phụ thuộc |
| Redlock | chịu được mất một Redis | phức tạp, vẫn không giải quyết treo |
| Bầu chọn leader | một nơi làm việc theo lịch | leader là điểm tập trung tải |
| TTL ngắn + gia hạn | khôi phục nhanh khi chết | phức tạp, phải xử lý gia hạn thất bại |
| TTL dài | đơn giản | kẹt lâu khi process chết |
| Fail closed | không chạy trùng | dừng dịch vụ khi Redis hỏng |
| Fail open | dịch vụ tiếp tục | có thể chạy trùng |

## Explain Without Notes

1. Bốn câu hỏi khó mà mọi khoá phân tán phải trả lời?
2. Vì sao TTL không có giá trị "đúng"?
3. Vì sao khoá phân tán không đảm bảo loại trừ tuyệt đối? Vẽ kịch bản.
4. Fencing token hoạt động thế nào, và điều kiện để nó có tác dụng?
5. Vì sao giải phóng khoá phải dùng Lua thay vì `GET` rồi `DEL`?
6. Năm lựa chọn thay thế cho khoá phân tán, xếp theo ưu tiên?
7. Vì sao advisory lock của PostgreSQL an toàn hơn khoá Redis ở một khía cạnh?
8. Fail open và fail closed cho hệ thống khoá — chọn theo tiêu chí nào?

## Related

- [Shared state & races](02-shared-state-races.md) — vì sao cần loại trừ
- [Concurrency models](01-concurrency-models.md) — nguồn của đồng thời
- [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md) — cài đặt Redis chi tiết
- [Locking & deadlock](../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) — khoá trong PostgreSQL
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — lựa chọn tốt hơn khoá
- [Ordering & partitioning](../../03-database/04-message-queues/04-ordering-partitioning.md) — tuần tự hoá bằng phân vùng
- [Caching, queues & jobs](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — `@Cron` trên nhiều replica
- [Failure modes](../reliability/01-failure-modes.md) — fail open/closed
- [Persistence & failure](../../03-database/02-redis/05-persistence-failure.md) — Redis có thể mất dữ liệu

## Version / Context

Ví dụ dùng Redis 7 (`SET key value NX PX ttl`, Lua qua `EVAL`), PostgreSQL 16 (`pg_try_advisory_xact_lock`, `FOR UPDATE SKIP LOCKED`), Kubernetes 1.29+ (CronJob với `concurrencyPolicy`, coordination.k8s.io Lease), NestJS 10/11. Phân tích giới hạn của Redlock theo bài viết của Martin Kleppmann ("How to do distributed locking") và phản hồi của Salvatore Sanfilippo — điểm đồng thuận: khoá dựa trên TTL không đủ cho tính đúng đắn nếu không có fencing ở phía store.

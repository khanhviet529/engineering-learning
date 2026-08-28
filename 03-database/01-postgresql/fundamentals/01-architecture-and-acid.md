---
level: foundation
area: database
related:
  - 02-connection-pool.md
  - ../transactions-concurrency/01-transaction-isolation.md
---

# Kiến trúc PostgreSQL và ACID

> Một service mở kết nối mới cho mỗi request. Ở 200 rps, `max_connections = 100` bị chạm và mọi request bắt đầu lỗi. Team tăng `max_connections` lên 1000. Database chậm hơn trước: mỗi kết nối là **một process riêng** với bộ nhớ riêng, và 1000 process tranh nhau CPU tệ hơn 100 process. **Con số đó không phải một hạn ngạch tuỳ tiện — nó phản ánh cách PostgreSQL thật sự chạy.**

## Position

```text
Note này giải thích PostgreSQL là CÁI GÌ ở mức process và cách nó đảm bảo ACID.
Đọc trước connection pool, transaction isolation, MVCC.
```

## Kiến trúc: một process cho mỗi kết nối

```text
                    ┌─ postmaster (process cha) ─┐
                    │  lắng nghe cổng 5432        │
                    └──────────┬──────────────────┘
                               │ mỗi kết nối → FORK một process
        ┌──────────────┬───────┴───────┬──────────────┐
   backend #1     backend #2      backend #3     backend #N
        │              │               │              │
        └──────────────┴───────┬───────┴──────────────┘
                    SHARED BUFFERS (bộ nhớ chung)
                               │
                    ┌──────────┴──────────┐
                    │  WAL  ·  data files │  (đĩa)
                    └─────────────────────┘

  + process nền: WAL writer · checkpointer · autovacuum · background writer
```

```text
Hệ quả trực tiếp của "mỗi kết nối = một process":

  · kết nối ĐẮT — fork process, cấp bộ nhớ riêng (vài MB mỗi cái)
  · `max_connections` cao KHÔNG miễn phí: nhiều process = nhiều context switch
  · kết nối idle vẫn chiếm bộ nhớ
  ⇒ giải pháp không phải tăng max_connections, mà là CONNECTION POOL
  ⇒ và ở quy mô lớn: pooler bên ngoài (PgBouncer) tách số kết nối app
    khỏi số process của database
```

Xem [Connection pool](02-connection-pool.md).

## Database → Schema → Table

```text
CLUSTER            một instance PostgreSQL, một thư mục dữ liệu, một cổng
  └─ DATABASE      cô lập hoàn toàn; KHÔNG join xuyên database được
       └─ SCHEMA   namespace bên trong database; mặc định là `public`
            └─ TABLE

Kết nối gắn với ĐÚNG MỘT database. Muốn đọc database khác
phải mở kết nối khác (hoặc dùng foreign data wrapper).
```

```text
Schema dùng để làm gì trong thực tế:
  · tách theo module: `orders.invoices`, `billing.invoices`
  · tách theo tenant (khi số tenant nhỏ và cố định)
  · tách dữ liệu ứng dụng khỏi extension

`search_path` quyết định schema nào được tìm khi bạn viết tên bảng trần.
Nhầm `search_path` là nguyên nhân của lỗi "relation does not exist" khó hiểu.
```

## Kiểu dữ liệu: chọn đúng từ đầu

```text
SỐ
  integer / bigint       khoá, đếm
  numeric(p,s)           TIỀN và mọi thứ cần chính xác tuyệt đối
  double precision       đo lường khoa học — KHÔNG dùng cho tiền

CHUỖI
  text                   mặc định đúng; không chậm hơn varchar
  varchar(n)             chỉ khi n là ràng buộc NGHIỆP VỤ thật
  char(n)                gần như không bao giờ nên dùng (đệm khoảng trắng)

THỜI GIAN
  timestamptz            LUÔN dùng cái này
  timestamp              KHÔNG có múi giờ → nguồn bug âm thầm
  date · interval

KHÁC
  boolean · uuid · jsonb (không phải json) · text[] · enum
  inet · tsvector · daterange
```

```text
Hai quyết định gây hối tiếc nhiều nhất:

`double precision` cho tiền
  → 0.1 + 0.2 ≠ 0.3; sai số tích luỹ; kế toán không khớp
  → dùng `numeric`, hoặc `bigint` lưu theo đơn vị nhỏ nhất (xu)

`timestamp` thay vì `timestamptz`
  → giá trị không có múi giờ; server đổi TZ là dữ liệu đổi nghĩa
  → `timestamptz` lưu UTC bên trong và quy đổi khi đọc
```

## ACID: bốn đảm bảo, và cái nào bạn thật sự phải nghĩ tới

```text
A  ATOMICITY    transaction chạy TRỌN VẸN hoặc KHÔNG GÌ CẢ
                → PostgreSQL lo; bạn chỉ cần đặt đúng ranh giới BEGIN/COMMIT

C  CONSISTENCY  transaction đưa DB từ trạng thái hợp lệ sang trạng thái hợp lệ
                → "hợp lệ" do BẠN định nghĩa bằng RÀNG BUỘC
                → đây là chữ cái bạn phải làm việc nhiều nhất

I  ISOLATION    transaction đồng thời không thấy trạng thái dở dang của nhau
                → có NHIỀU MỨC; mặc định KHÔNG phải mức cao nhất
                → đây là chữ cái gây bug nhiều nhất

D  DURABILITY   đã COMMIT thì không mất, kể cả khi mất điện
                → WAL lo; nhưng `synchronous_commit` đổi được đảm bảo này
```

```text
Hiểu nhầm phổ biến: "database có ACID nên dữ liệu tôi luôn đúng".

Sai ở hai chỗ:
  · C chỉ đúng với ràng buộc BẠN khai báo. Không có `CHECK`, không có
    `UNIQUE`, không có `FOREIGN KEY` → không có gì để "consistent" với.
  · I mặc định là READ COMMITTED, KHÔNG chặn lost update và write skew.
```

### Isolation: mặc định không phải mức cao nhất

```text
READ COMMITTED   ← MẶC ĐỊNH của PostgreSQL
  ✓ không đọc dữ liệu chưa commit
  ✗ KHÔNG chặn lost update
  ✗ KHÔNG chặn write skew

REPEATABLE READ
  ✓ snapshot nhất quán suốt transaction
  ✓ PostgreSQL PHÁT HIỆN lost update → ném lỗi 40001, bạn phải retry

SERIALIZABLE
  ✓ như thể chạy tuần tự
  ✗ nhiều lỗi serialization hơn → BẮT BUỘC có vòng retry
```

Chi tiết và ví dụ: [Transaction isolation](../transactions-concurrency/01-transaction-isolation.md).

### Durability có mức độ

```sql
SHOW synchronous_commit;      -- mặc định: on
```

```text
on         COMMIT chờ WAL được ghi xuống đĩa (fsync)
           → không mất dữ liệu khi mất điện · ghi chậm hơn
off        COMMIT trả về ngay, WAL flush sau
           → nhanh hơn nhiều · có thể mất vài giao dịch cuối khi crash
           → KHÔNG làm hỏng dữ liệu, chỉ mất giao dịch gần nhất
remote_apply  chờ replica áp dụng xong
           → đọc từ replica thấy ngay · ghi chậm nhất

⇒ "D" trong ACID là một CẤU HÌNH, không phải hằng số.
```

## WAL: cơ chế đứng sau A và D

```text
Trước khi sửa file dữ liệu, PostgreSQL GHI Ý ĐỊNH vào WAL và fsync WAL.

  COMMIT → ghi WAL + fsync → báo thành công cho client
                            → sửa file dữ liệu SAU (lúc checkpoint)

Vì sao thiết kế thế:
  · WAL ghi TUẦN TỰ → nhanh hơn nhiều so với ghi ngẫu nhiên vào data file
  · crash → phát lại WAL từ checkpoint gần nhất → khôi phục trạng thái
  · WAL cũng là nguồn cho REPLICATION và PITR
```

Chi tiết: [WAL, durability & backup](../operations/01-wal-durability-backup.md).

## MVCC: vì sao đọc không chặn ghi

```text
PostgreSQL KHÔNG sửa dòng tại chỗ. UPDATE tạo PHIÊN BẢN MỚI của dòng.

  UPDATE users SET name='B' WHERE id=1;
  → dòng cũ (name='A') vẫn còn, đánh dấu hết hiệu lực
  → dòng mới (name='B') được thêm

Mỗi transaction thấy phiên bản phù hợp với snapshot của nó.

Hệ quả:
  ✓ đọc KHÔNG chặn ghi, ghi KHÔNG chặn đọc
  ✗ dòng chết tích luỹ → cần VACUUM dọn
  ✗ UPDATE đắt hơn bạn nghĩ — nó là INSERT + đánh dấu
  ✗ transaction mở lâu ngăn vacuum dọn → bảng phình (bloat)
```

Chi tiết: [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md).

## Prediction

1. Mỗi kết nối là một process — mở 1000 kết nối tốn gì?
2. Tăng `max_connections` từ 100 lên 1000 để chịu tải — database nhanh hơn hay chậm hơn?
3. Giải pháp đúng cho "hết kết nối" là gì?
4. Kết nối tới database `app` rồi `SELECT` bảng ở database `analytics` — được không?
5. Lưu tiền bằng `double precision`, cộng 1000 giao dịch — sai số thế nào?
6. Cột `timestamp` (không tz), server đổi múi giờ — dữ liệu cũ nghĩa là gì?
7. Isolation mặc định của PostgreSQL là gì? Nó chặn lost update không?
8. Bảng không có `CHECK` và `UNIQUE` nào — chữ "C" trong ACID đảm bảo gì?
9. `synchronous_commit = off`, mất điện ngay sau COMMIT — mất gì?
10. Dữ liệu có bị **hỏng** không trong trường hợp đó?
11. `UPDATE` một dòng 1 triệu lần, không vacuum — kích thước bảng thế nào?
12. Transaction mở 2 giờ không commit — nó ảnh hưởng vacuum ở đâu?

<details>
<summary>Đáp án</summary>

1. **1000 process** với bộ nhớ riêng mỗi cái — vài GB chỉ cho kết nối.
2. **Chậm hơn** — context switch và bộ nhớ.
3. **Connection pool** ở app, và pooler ngoài (PgBouncer) khi nhiều instance.
4. **Không** — kết nối gắn với một database.
5. Sai số tích luỹ; tổng **không khớp** với sổ kế toán.
6. Nó **đổi nghĩa** — giá trị không mang thông tin múi giờ.
7. **READ COMMITTED**; nó **không** chặn lost update.
8. **Gần như không gì** — "hợp lệ" là do bạn định nghĩa.
9. **Vài giao dịch cuối cùng.**
10. **Không** — chỉ mất, không hỏng.
11. Phình rất lớn — mỗi UPDATE tạo một phiên bản dòng mới.
12. Trên **mọi bảng** — snapshot cũ ngăn dọn dead tuple toàn hệ thống.
</details>

## What Usually Goes Wrong

- **Tăng `max_connections`** thay vì dùng pool.
- **Mở kết nối mỗi request.**
- **`double precision` cho tiền.**
- **`timestamp` thay vì `timestamptz`.**
- **`varchar(n)` với n tuỳ tiện** thay vì `text` + `CHECK` khi cần.
- **Tin rằng ACID tự lo tính đúng đắn** mà không khai báo ràng buộc.
- **Không biết isolation mặc định** là READ COMMITTED.
- **Nâng isolation mà không có vòng retry.**
- **Transaction dài** → chặn vacuum toàn hệ thống.
- **Không biết `UPDATE` tạo dòng mới** → ngạc nhiên vì bloat.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Kết nối rẻ | Mỗi kết nối là một process với bộ nhớ riêng |
| `max_connections` cao = chịu tải tốt hơn | Nó làm database chậm hơn |
| ACID nghĩa là dữ liệu luôn đúng | "C" chỉ đúng với ràng buộc bạn khai báo |
| Isolation mặc định là mức cao nhất | Nó là READ COMMITTED |
| Durability là bất biến | `synchronous_commit` đổi được nó |
| `synchronous_commit = off` làm hỏng dữ liệu | Nó chỉ có thể **mất** giao dịch cuối |
| `UPDATE` sửa dòng tại chỗ | Nó tạo phiên bản mới (MVCC) |
| `varchar` nhanh hơn `text` | Chúng như nhau trong PostgreSQL |
| Schema là database | Schema là namespace **trong** một database |

## Explain Without Notes

1. Mô hình process của PostgreSQL, và hai hệ quả trực tiếp của nó.
2. Cluster / database / schema / table — cái nào cô lập cái nào?
3. Hai quyết định kiểu dữ liệu gây hối tiếc nhiều nhất, và vì sao?
4. Bốn chữ ACID — chữ nào bạn phải làm việc nhiều nhất, chữ nào gây bug nhiều nhất?
5. Vì sao "có ACID" không đảm bảo dữ liệu đúng?
6. WAL hoạt động thế nào và nó phục vụ những mục đích nào?
7. MVCC cho gì và tốn gì?
8. Vì sao transaction mở lâu ảnh hưởng tới toàn bộ database?

## Related

- [Connection pool](02-connection-pool.md) — vì sao pool là bắt buộc
- [Transaction isolation](../transactions-concurrency/01-transaction-isolation.md) — bốn mức và anomaly
- [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md) — dead tuple, bloat
- [Locking & deadlock](../transactions-concurrency/03-locking-deadlock.md)
- [Index & query plan](../indexes-query-planning/01-index-query-plan.md)
- [WAL, durability & backup](../operations/01-wal-durability-backup.md)
- [Constraints & invariants](../../03-data-modeling/01-constraints-invariants.md) — chữ "C" trong thực tế
- [SQL basics](../../00-sql/00-sql-basics.md) — DML và từ vựng quan hệ
- [Shared state & races](../../../05-cross-cutting/concurrency/02-shared-state-races.md) — hệ quả của isolation

## Version / Context

PostgreSQL **16**. `max_connections` mặc định 100. Isolation mặc định `READ COMMITTED`. `synchronous_commit` mặc định `on`. `REPEATABLE READ` của PostgreSQL thực chất là snapshot isolation và **phát hiện** lost update (khác chuẩn SQL, vốn chỉ yêu cầu ngăn non-repeatable read). `SERIALIZABLE` dùng Serializable Snapshot Isolation. Mô hình một-process-mỗi-kết-nối là đặc trưng của PostgreSQL — MySQL dùng thread, nên lời khuyên về `max_connections` không chuyển nguyên sang được.

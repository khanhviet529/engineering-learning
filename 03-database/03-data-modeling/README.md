---
level: intermediate
area: database
---

# Data modeling

Schema là **quyết định khó đảo ngược nhất** trong hệ thống. Đổi framework mất một tháng; đổi mô hình dữ liệu của một sản phẩm đang chạy mất một năm — và thường bị hoãn vô hạn.

Bốn câu hỏi mà folder này luyện:

```text
1. Sự thật này thay đổi thì phải sửa mấy dòng?   → chuẩn hoá
2. Hai thứ này liên hệ với nhau thế nào?          → cardinality
3. Trạng thái sai nào KHÔNG THỂ tồn tại?          → constraint
4. Đổi schema mà không dừng hệ thống thế nào?     → migration
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Constraints & invariants](01-constraints-invariants.md) | Vì sao có 340 dòng `total` âm dù code đã kiểm tra? |
| 2 | [Normalization](02-normalization.md) | Khi nào trùng lặp là bug, khi nào là yêu cầu? |
| 3 | [Relationships & cardinality](03-relationships-cardinality.md) | Bảng nối là gì, và khi nào nó thành một thực thể? |
| 4 | [Migrations](04-migrations.md) | Vì sao `ADD COLUMN` 2ms gây downtime 4 phút? |

Đọc 1 trước 2 là có chủ đích: constraint là thứ làm cho một thiết kế trở nên *đúng*, và biết constraint nào khả thi ảnh hưởng tới cách bạn chia bảng.

## Ba nguyên tắc

```text
① Bất biến quan trọng phải được ép ở nơi KHÔNG AI đi vòng được.
   Validation ở app: 7 đường ghi, 1 chỗ kiểm tra, và sai dưới concurrency.
   Constraint ở DB: thuộc tính của dữ liệu, không phải của code.

② Trùng lặp là bug — TRỪ KHI đó là ảnh chụp lịch sử.
   products.price      = giá hiện tại
   order_items.price   = giá lúc mua        ← HAI sự thật khác nhau
   Đặt tên cho ý định: _at_purchase, _snapshot, _cached.

③ Mọi migration phải hoạt động với code TRƯỚC và SAU nó.
   Trong rolling update có hai phiên bản code, một schema.
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Dữ liệu mồ côi (`user_id` trỏ vào hư không) | thiếu FK → [1](01-constraints-invariants.md) |
| Dòng trùng dù code đã kiểm tra | thiếu unique constraint; race condition → [1](01-constraints-invariants.md) |
| Không đăng ký lại được email đã xoá mềm | cần partial unique index → [1](01-constraints-invariants.md) |
| Hai booking chồng lấn cùng phòng | cần `EXCLUDE` constraint → [1](01-constraints-invariants.md) |
| Cùng một thông tin ở nhiều nơi, lệch nhau | chưa chuẩn hoá → [2](02-normalization.md) |
| Hoá đơn cũ đổi giá trị khi sửa dữ liệu gốc | thiếu ảnh chụp lịch sử → [2](02-normalization.md) |
| Cột đếm sẵn không khớp số thật | thiếu job đối soát → [2](02-normalization.md) |
| Không viết được query "top sản phẩm" | dữ liệu nhồi trong chuỗi/jsonb → [2](02-normalization.md) |
| Một chiều query nhanh, chiều kia chậm | thiếu index chiều ngược của bảng nối → [3](03-relationships-cardinality.md) |
| Hai dòng settings cho một user | 1:1 thiếu `UNIQUE` → [3](03-relationships-cardinality.md) |
| Bảng nối đã có 5 cột | nó là thực thể, cần `id` riêng → [3](03-relationships-cardinality.md) |
| `SUM` sai gấp N lần | fan-out từ JOIN nhiều nhánh 1:N → [3](03-relationships-cardinality.md) |
| Migration làm sập app | thiếu `lock_timeout` → [4](04-migrations.md) |
| Pod cũ lỗi ngay sau migration | migration không tương thích ngược → [4](04-migrations.md) |
| Backfill chạy 2 giờ rồi phải huỷ, mất hết | một transaction thay vì theo lô → [4](04-migrations.md) |

## Checklist cho một bảng mới

```sql
CREATE TABLE things (
  id          bigserial   PRIMARY KEY,              -- ① khoá chính
  owner_id    bigint      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- ② FK + ON DELETE
  status      text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','archived')),   -- ③ CHECK
  amount_cents bigint     NOT NULL CHECK (amount_cents >= 0),                -- ④ tiền = số nguyên
  created_at  timestamptz NOT NULL DEFAULT now(),   -- ⑤ timestamptz, KHÔNG timestamp
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON things (owner_id);                  -- ⑥ index MỌI cột FK
```

```text
⑦ Cột nào thật sự cần cho phép NULL?  (mặc định: không)
⑧ Bất biến nào chưa ép được bằng constraint?  → job đối soát
⑨ Query nào sẽ chạy trên bảng này?  → index tương ứng
⑩ Giá trị nào cần đóng băng theo thời gian?  → snapshot
```

## Câu hỏi kiểm tra thiết kế

Trước khi viết dòng code đầu tiên, thử trả lời 10 câu hỏi nghiệp vụ bằng SQL trên schema bạn định làm. Nếu có câu nào phải parse chuỗi, phải quét toàn bảng, hoặc phải JOIN 6 bảng — thiết kế cần xem lại.

Và ba câu này chạy được trên production ngay hôm nay:

```sql
-- dữ liệu mồ côi
SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;

-- giá trị vi phạm bất biến chưa ép
SELECT count(*) FROM orders WHERE total_cents < 0;

-- trùng lặp nơi lẽ ra phải duy nhất
SELECT email, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1 HAVING count(*) > 1;
```

Kết quả thường gây bất ngờ, và mỗi dòng khác 0 là một đường ghi bạn chưa biết.

## Position

```text
Yêu cầu nghiệp vụ → SCHEMA → Constraint → Query → Index → Hiệu năng
                     ↑ folder này
```

## Related

- [00-sql/](../00-sql/README.md) — ngôn ngữ để truy vấn mô hình này
- [01-postgresql/](../01-postgresql/README.md) — engine: index, MVCC, khoá, plan
- [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — mô hình dữ liệu vs mô hình domain
- [Validation & errors](../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — ba tầng kiểm tra
- [CI/CD pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — migration trong pipeline
- [Modular monolith](../../02-backend-api/04-architecture/02-modular-monolith.md) — ranh giới dữ liệu giữa module

## Version / Context

Ví dụ viết cho **PostgreSQL 16**. Lý thuyết chuẩn hoá và cardinality đúng với mọi RDBMS; cú pháp constraint, `EXCLUDE`, partial index và chi tiết migration là đặc thù PostgreSQL.

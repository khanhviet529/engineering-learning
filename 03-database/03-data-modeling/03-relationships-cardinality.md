---
level: intermediate
area: database
prerequisites:
  - 02-normalization.md
related:
  - 01-constraints-invariants.md
  - ../00-sql/02-joins-aggregation.md
---

# Relationships & cardinality

> Bạn thiết kế `users` và `projects` với quan hệ N:M qua bảng nối `project_members`. Sáu tháng sau, product yêu cầu: "thành viên phải có vai trò", rồi "phải biết ai mời", rồi "phải hỗ trợ lời mời chưa được chấp nhận". Mỗi yêu cầu là một cột mới trên bảng nối. Đến lúc này bảng nối đã là một **thực thể** — nó có tên riêng trong ngôn ngữ nghiệp vụ ("membership"), có vòng đời riêng, có quy tắc riêng. Nhận ra điều đó sớm sẽ tiết kiệm ba lần migration.

## Position

```text
Yêu cầu nghiệp vụ  →  QUAN HỆ giữa các thực thể  ←  note này
                          ↓
                   FK, bảng nối, cardinality
                          ↓
                   Số dòng khi JOIN, fan-out, index
```

Cardinality không chỉ là chuyện thiết kế. Nó quyết định số dòng mỗi query trả về, và đó là nguồn của lỗi aggregate sai. Xem [Joins & aggregation](../00-sql/02-joins-aggregation.md).

## Problem

Câu hỏi "hai thứ này liên hệ với nhau thế nào" nghe đơn giản, nhưng trả lời sai gây ra ba loại vấn đề khác nhau:

```text
Thiết kế 1:N khi thực tế là N:M
  → user chỉ thuộc một project được → phải làm lại toàn bộ
  → và migration này đụng mọi query, mọi API

Thiết kế N:M khi thực tế là 1:N
  → thêm một bảng, thêm một JOIN, không được lợi ích gì

Không nhận ra bảng nối là một thực thể
  → thêm cột dần vào một bảng "kỹ thuật"
  → không có id riêng nên không tham chiếu được từ nơi khác
  → không có vòng đời rõ ràng
```

Và một vấn đề thứ tư, xuất hiện muộn hơn nhưng đắt hơn: **cardinality thay đổi theo thời gian.** "Một đơn hàng có một lần thanh toán" đúng trong hai năm, rồi sản phẩm hỗ trợ trả góp. Mọi query `SUM` viết theo giả định 1:1 giờ đều sai.

## Mental Model

### Ba loại quan hệ, và khoá nằm ở đâu

```text
1:1     users ── user_settings
        FK ở bảng phụ, có UNIQUE
        user_settings(user_id UNIQUE REFERENCES users(id))

1:N     users ──< orders                       ← phổ biến nhất
        FK ở phía "NHIỀU"
        orders(user_id REFERENCES users(id))

N:M     users >──< projects
        BẢNG NỐI riêng
        project_members(user_id, project_id, PRIMARY KEY(user_id, project_id))
```

Quy tắc một câu: **FK luôn nằm ở phía "nhiều".** Một đơn hàng thuộc một khách → `user_id` nằm trên `orders`.

### Xác định cardinality bằng hai câu hỏi

Hỏi **cả hai chiều**, và hỏi bằng ngôn ngữ nghiệp vụ:

```text
"Một USER có bao nhiêu ORDER?"      → nhiều
"Một ORDER thuộc bao nhiêu USER?"   → một
⇒ 1:N

"Một USER thuộc bao nhiêu PROJECT?"  → nhiều
"Một PROJECT có bao nhiêu USER?"     → nhiều
⇒ N:M

"Một USER có bao nhiêu SETTINGS?"    → một
"Một SETTINGS thuộc bao nhiêu USER?" → một
⇒ 1:1
```

Và một câu hỏi thứ ba, quan trọng không kém và thường bị bỏ:

```text
"Điều này có thể thay đổi trong 3 năm tới không?"
```

Nếu có khả năng "một" thành "nhiều", thiết kế 1:N ngay từ đầu thường rẻ hơn migrate sau — miễn là nó không làm phức tạp quá mức.

### 1:1 — hầu như luôn nên gộp

```text
Tách 1:1 CHỈ khi có lý do cụ thể:
  · cột rất lớn, ít khi đọc (nội dung bài viết, ảnh base64)
  · dữ liệu nhạy cảm cần phân quyền riêng ở tầng DB
  · vòng đời khác nhau (profile tạo sau, có thể không có)
  · một bên là dữ liệu tuỳ chọn mà đa số dòng không có
```

Ngược lại, `users` + `user_profiles` mà mọi màn hình đều đọc cả hai chỉ thêm một JOIN cho mọi query mà không được gì.

Nếu tách, đừng quên `UNIQUE`:

```sql
CREATE TABLE user_settings (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme   text NOT NULL DEFAULT 'light'
);
-- PRIMARY KEY trên user_id vừa là khoá vừa ép 1:1
```

Không có `UNIQUE`/`PRIMARY KEY` trên `user_id`, quan hệ trở thành 1:N mà không ai nhận ra — cho tới ngày có hai dòng settings cho một user và ứng dụng chọn bừa một cái.

### N:M — và khi bảng nối trở thành thực thể

```sql
-- ① bảng nối THUẦN: không có gì ngoài hai khoá
CREATE TABLE post_tags (
  post_id bigint REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  bigint REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX ON post_tags (tag_id);      -- cho chiều ngược lại
```

```sql
-- ② bảng nối là THỰC THỂ: có thuộc tính, có vòng đời, có tên nghiệp vụ
CREATE TABLE project_members (
  id           bigserial PRIMARY KEY,          -- id riêng: tham chiếu được từ nơi khác
  project_id   bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role         text   NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  invited_by   bigint REFERENCES users(id),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  UNIQUE (project_id, user_id)                 -- vẫn ép N:M
);
```

Ba dấu hiệu cho biết bảng nối đã thành thực thể, và bạn nên cho nó `id` riêng:

```text
· nó có thuộc tính ngoài hai FK
· nó có vòng đời riêng (mời → chấp nhận → rời đi)
· nó có TÊN trong ngôn ngữ nghiệp vụ ("membership", "enrollment", "assignment")
```

Dấu hiệu thứ ba là đáng tin nhất. Nếu người làm sản phẩm gọi nó bằng một danh từ, nó là một thực thể.

Về khoá chính: khoá tổ hợp `(project_id, user_id)` đủ cho ①. Với ②, `id` riêng + `UNIQUE (project_id, user_id)` tốt hơn — vì bạn sẽ cần tham chiếu tới một membership cụ thể (ví dụ từ bảng audit log), và tham chiếu bằng khoá tổ hợp là bất tiện.

Và nhớ **index chiều ngược lại**: `PRIMARY KEY (post_id, tag_id)` chỉ phục vụ query "tag của một post". Query "post của một tag" cần index riêng trên `tag_id`.

### Quan hệ tự tham chiếu

```sql
CREATE TABLE tasks (
  id        bigserial PRIMARY KEY,
  parent_id bigint REFERENCES tasks(id) ON DELETE CASCADE,
  title     text NOT NULL
);
CREATE INDEX ON tasks (parent_id);
```

```sql
-- N:M tự tham chiếu: bạn bè, follow
CREATE TABLE follows (
  follower_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)          -- không tự follow chính mình
);
CREATE INDEX ON follows (followee_id);         -- "ai follow tôi"
```

Với quan hệ **đối xứng** (bạn bè hai chiều), có hai lựa chọn: lưu hai dòng (`A→B` và `B→A`, dễ query, phải giữ đồng bộ), hoặc lưu một dòng với quy ước `least(a,b) < greatest(a,b)` (không lệch được, query phức tạp hơn). Cả hai đều được dùng; chọn rồi ghi lại quyết định.

Cây tự tham chiếu cần đọc bằng `WITH RECURSIVE`. Với cây đọc nhiều và ghi ít, cân nhắc lưu thêm `path` (materialized path) hoặc dùng closure table. Xem [Subqueries & CTE](../00-sql/03-subqueries-cte.md).

### Quan hệ đa hình: ba cách, không cách nào hoàn hảo

Bài toán: `comments` có thể thuộc `posts`, `photos`, hoặc `videos`.

```sql
-- ① Polymorphic (kiểu Rails) — KHÔNG có FK
comments(id, commentable_type text, commentable_id bigint, body text)
--   + linh hoạt, thêm loại mới không cần migration
--   - KHÔNG ép được toàn vẹn: commentable_id có thể trỏ tới hư không
--   - JOIN phải rẽ nhánh theo type

-- ② Nhiều cột FK nullable — ép được toàn vẹn
comments(id, post_id, photo_id, video_id, body,
         CHECK (num_nonnulls(post_id, photo_id, video_id) = 1))
--   + FK thật, ép được "đúng một cha"
--   - thêm loại = thêm cột + sửa CHECK

-- ③ Bảng cha chung
commentables(id bigserial PRIMARY KEY, kind text NOT NULL)
posts(id bigint PRIMARY KEY REFERENCES commentables(id), ...)
comments(id, commentable_id REFERENCES commentables(id), body)
--   + FK thật, thêm loại dễ
--   - thêm một tầng gián tiếp, mọi INSERT phải qua hai bảng
```

Khuyến nghị thực dụng: **② khi số loại ít và ổn định** (2–4 loại) — nó cho toàn vẹn thật với chi phí thấp nhất. **③ khi số loại sẽ tăng.** **① chỉ khi bạn chấp nhận có tham chiếu treo** và có job dọn dẹp.

Cái mà ① mất không nhỏ: không có FK nghĩa là xoá một post không xoá comment của nó, và bạn sẽ tích luỹ comment mồ côi mà không có gì phát hiện.

### Cardinality và số dòng khi JOIN

Đây là chỗ thiết kế gặp query:

```text
orders 1.000
  ├─ 1:N order_items (6/đơn)   → JOIN cho 6.000 dòng
  └─ 1:N payments    (2/đơn)   → JOIN cả hai cho 12.000 dòng
                                  ⇒ SUM bị nhân — xem Joins & aggregation
```

Vì thế, khi thiết kế xong một quan hệ, hãy tự hỏi ngay: **"query nào sẽ JOIN hai nhánh 1:N cùng lúc, và số liệu ở đó có bị nhân không?"**

## Example

Từ yêu cầu tới schema, có ghi rõ cardinality:

```text
"Một workspace có nhiều project."                            workspace 1:N project
"Một user thuộc nhiều workspace, mỗi nơi một vai trò."       N:M + thuộc tính ⇒ THỰC THỂ
"Một project có nhiều task."                                 project 1:N task
"Một task có thể là con của task khác."                      tự tham chiếu 1:N
"Một task được gán cho nhiều người."                          N:M
"Một task có nhiều tag."                                      N:M thuần
```

```sql
workspaces        (id, name, created_at)

workspace_members (id, workspace_id, user_id, role, invited_by, joined_at,
                   UNIQUE (workspace_id, user_id))            -- thực thể

projects          (id, workspace_id NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                   name, created_at)

tasks             (id, project_id NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                   parent_id REFERENCES tasks(id) ON DELETE CASCADE,
                   title, status, created_at)

task_assignees    (task_id, user_id, assigned_at,
                   PRIMARY KEY (task_id, user_id))            -- gần thuần
task_tags         (task_id, tag_id, PRIMARY KEY (task_id, tag_id))   -- thuần

-- index cho chiều ngược của mọi bảng nối
CREATE INDEX ON workspace_members (user_id);
CREATE INDEX ON task_assignees (user_id);
CREATE INDEX ON task_tags (tag_id);
CREATE INDEX ON tasks (project_id);
CREATE INDEX ON tasks (parent_id);
```

Ba điều đáng chú ý:

- **`workspace_members` có `id` riêng** vì nó là thực thể (có role, có người mời).
- **Mọi bảng nối có index chiều ngược** — nếu không, query "project nào tôi tham gia" sẽ quét toàn bảng.
- **Mọi cột FK có index** — PostgreSQL không tự tạo.

## Prediction

1. FK đặt sai phía: `users.order_id` thay vì `orders.user_id` — một user chứa được bao nhiêu đơn?
2. Bảng `user_settings` không có `UNIQUE` trên `user_id` — quan hệ thực tế là gì? Chuyện gì xảy ra khi có 2 dòng?
3. `post_tags` có `PRIMARY KEY (post_id, tag_id)`, query "mọi post có tag X" — dùng index không?
4. Thêm `CREATE INDEX ON post_tags (tag_id)` — khác gì?
5. Bảng nối không có `UNIQUE (a, b)`, thêm cùng user vào cùng project hai lần — thành công?
6. Polymorphic `commentable_type/id` không FK, xoá một post — comment của nó thế nào?
7. `follows` không có `CHECK (follower_id <> followee_id)` — user tự follow mình được không?
8. Quan hệ bạn bè lưu hai chiều, một chiều bị xoá mà chiều kia không — hậu quả?
9. Cây `tasks` tự tham chiếu, tạo chu trình (A là cha của B, B là cha của A) — `WITH RECURSIVE` không giới hạn depth thì sao?
10. `orders` JOIN cả `order_items` (6/đơn) và `payments` (2/đơn), `SUM(items.qty)` — sai bao nhiêu lần?
11. Thiết kế 1:N cho "một đơn có một thanh toán", hai năm sau hỗ trợ trả góp — phải đổi gì?
12. Bảng nối `project_members` dùng khoá tổ hợp, cần audit log tham chiếu tới một membership — làm thế nào?

<details>
<summary>Đáp án</summary>

1. **Một** — FK ở sai phía biến 1:N thành 1:1. Đây là lỗi thiết kế cơ bản và phải migrate để sửa.
2. Thực tế là **1:N**. Khi có 2 dòng, ứng dụng chọn bừa một cái (thường là dòng đầu tiên planner trả về) → hành vi không tất định.
3. **Không** — `tag_id` không phải cột đầu của khoá tổ hợp (tiền tố trái).
4. Query đó dùng được index → nhanh hơn nhiều trên bảng lớn.
5. **Thành công** — dòng trùng. Rồi query đếm thành viên sẽ ra số sai.
6. Comment thành **mồ côi** — không có FK để cascade hay restrict. Chúng tích luỹ mãi mãi.
7. **Được**, và nó sẽ xuất hiện trong danh sách "người bạn theo dõi".
8. Dữ liệu lệch: A thấy B là bạn, B không thấy A. Đây là lý do phải chọn một quy ước và giữ nó bằng transaction hoặc trigger.
9. Query chạy **vô hạn** cho tới khi hết bộ nhớ.
10. **2 lần** (nhân theo số payment). Xem [Joins & aggregation](../00-sql/02-joins-aggregation.md).
11. Nếu đã là 1:N (bảng `payments` với `order_id`) thì **không đổi gì** ở schema. Nếu là cột `payment_id` trên `orders` thì phải migrate: tạo bảng, chuyển dữ liệu, sửa mọi query.
12. Audit log phải lưu cả hai cột `(project_id, user_id)` — bất tiện, và không tạo FK gọn được. Đây là lý do cho `id` riêng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt FK sai phía rồi thử thêm đơn thứ hai cho một user | Không thêm được |
| Bỏ `UNIQUE` khỏi bảng 1:1, insert 2 dòng, chạy query đọc | Kết quả không tất định |
| Bỏ `UNIQUE (a,b)` khỏi bảng nối, thêm trùng, đếm thành viên | Số sai |
| Query chiều ngược của bảng nối không có index, bảng 1 triệu dòng | Seq Scan; đo thời gian |
| Thêm index chiều ngược, đo lại | Chênh lệch |
| Polymorphic không FK, xoá cha, đếm dòng mồ côi | Tích luỹ |
| Đổi sang nhiều cột FK + `CHECK num_nonnulls = 1` | Không thể mồ côi |
| Tự follow chính mình khi không có `CHECK` | Xuất hiện trong danh sách |
| Tạo chu trình trong cây rồi chạy `WITH RECURSIVE` không giới hạn | Treo |
| JOIN hai nhánh 1:N rồi `SUM` | So với tổng thật |
| Thêm cột thứ 4 vào bảng nối "thuần" | Nhận ra nó đã thành thực thể |
| Xoá dòng cha với `ON DELETE CASCADE` sâu 3 tầng, trong transaction rồi `ROLLBACK` | Đếm số dòng bị ảnh hưởng |

## What Usually Goes Wrong

- **FK sai phía** → cardinality sai, phải migrate.
- **1:1 không có `UNIQUE`** → âm thầm thành 1:N, hành vi không tất định.
- **Bảng nối không có `UNIQUE (a, b)`** → dòng trùng, số liệu sai.
- **Không index chiều ngược của bảng nối** → một chiều nhanh, chiều kia quét toàn bảng.
- **Không index cột FK** → `DELETE` ở bảng cha chậm.
- **Bảng nối thành thực thể mà không nhận ra** → thêm cột dần, không có id riêng, không tham chiếu được.
- **Polymorphic không FK** → dữ liệu mồ côi tích luỹ.
- **Quan hệ đối xứng không có quy ước rõ** → dữ liệu lệch một chiều.
- **Tự tham chiếu không chống chu trình** → query đệ quy treo.
- **JOIN nhiều nhánh 1:N rồi aggregate** → số nhân lên.
- **Thiết kế theo cardinality hiện tại mà không hỏi về tương lai** → migration lớn khi "một" thành "nhiều".
- **Tách 1:1 không lý do** → JOIN vô ích ở mọi query.
- **`ON DELETE CASCADE` không kiểm tra độ sâu** → xoá dây chuyền ngoài dự kiến.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| FK đặt ở đâu cũng được | Nó quyết định cardinality; sai phía là sai thiết kế |
| Bảng nối chỉ là chi tiết kỹ thuật | Nó thường là một thực thể nghiệp vụ |
| Khoá tổ hợp luôn đủ cho bảng nối | Không, khi cần tham chiếu tới một dòng cụ thể |
| `PRIMARY KEY (a, b)` phục vụ cả hai chiều | Chỉ phục vụ chiều bắt đầu bằng `a` |
| 1:1 nên tách bảng cho sạch | Hầu như luôn nên gộp |
| Polymorphic là cách chuẩn cho đa hình | Nó đánh đổi toàn vẹn lấy linh hoạt |
| Cardinality cố định | Nó thay đổi theo yêu cầu nghiệp vụ |
| N:M luôn cần bảng nối riêng | Đúng — nhưng bảng đó có thể là một thực thể |
| Mảng trong PostgreSQL thay được bảng nối | Mất FK, mất constraint, JOIN vụng |

Về dòng cuối: PostgreSQL có kiểu mảng và `tags text[]` trông tiện. Nó chấp nhận được cho tag tự do không cần bảng riêng, nhưng nó không có FK — nên nếu `tags` phải tham chiếu tới một bảng `tags` có thật, dùng bảng nối.

## Debugging

1. **Nghi cardinality sai** — chạy câu này với mọi FK quan trọng:
   ```sql
   SELECT user_id, count(*) FROM user_settings GROUP BY 1 HAVING count(*) > 1;
   ```
   Nếu ra dòng nào, quan hệ bạn nghĩ là 1:1 thật ra không phải.
2. **Tìm dòng trùng trong bảng nối**:
   ```sql
   SELECT project_id, user_id, count(*) FROM project_members
   GROUP BY 1,2 HAVING count(*) > 1;
   ```
3. **Tìm dòng mồ côi** (khi không có FK):
   ```sql
   SELECT count(*) FROM comments c
   WHERE c.commentable_type = 'post'
     AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = c.commentable_id);
   ```
4. **Query một chiều nhanh, chiều kia chậm** → thiếu index chiều ngược.
5. **Số liệu sai sau JOIN** → đếm dòng trước `GROUP BY`; so với số thực thể.
6. **Xem toàn bộ FK của một bảng**: `\d+ tablename` trong psql.
7. **Vẽ ERD từ schema thật** (`pg_dump --schema-only` rồi dùng công cụ) — so với sơ đồ trong tài liệu. Khoảng cách giữa hai cái là nợ tài liệu.

## Production Considerations

- **Index mọi cột FK, và cả hai chiều của bảng nối.** Đây là hai dòng `CREATE INDEX` cho mỗi bảng nối, và bỏ sót chúng là nguyên nhân phổ biến của query chậm.
- **`UNIQUE` trên bảng nối là bắt buộc**, kể cả khi code "chắc chắn" không thêm trùng.
- **Cho bảng nối một `id` riêng** ngay khi nó có cột thứ ba. Thêm sau khó hơn nhiều.
- **Cân nhắc cardinality tương lai** trong thiết kế ban đầu, nhưng đừng thiết kế cho tương lai tưởng tượng. Cân bằng: nếu "một thành nhiều" là khả năng thực tế trong 1–2 năm, làm 1:N ngay.
- **`ON DELETE` là quyết định nghiệp vụ.** Với dữ liệu quan trọng, cân nhắc soft delete + `RESTRICT` thay vì `CASCADE`.
- **Kiểm tra độ sâu cascade** trước khi bật: chạy `DELETE` trong transaction rồi `ROLLBACK`, đếm số dòng bị ảnh hưởng.
- **Ghi cardinality vào tài liệu schema** bằng ngôn ngữ nghiệp vụ, không chỉ bằng FK. "Một task thuộc đúng một project; project không đổi sau khi tạo" là thông tin mà schema không diễn đạt hết.
- **Chống chu trình cho dữ liệu phân cấp** — bằng `CHECK` khi có thể, hoặc bằng kiểm tra ở tầng ứng dụng, và luôn giới hạn depth trong query đệ quy.
- **Với cây đọc rất nhiều**, cân nhắc materialized path hoặc closure table thay vì đệ quy mỗi lần đọc.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Gộp 1:1 | ít JOIN, đơn giản | bảng rộng hơn; cột lớn luôn được đọc |
| Tách 1:1 | tách cột lớn / phân quyền riêng | JOIN thêm ở mọi query |
| Bảng nối thuần (khoá tổ hợp) | gọn, đủ cho quan hệ đơn giản | không tham chiếu được từ nơi khác |
| Bảng nối có `id` | tham chiếu được, mở rộng được | thêm một cột, thêm một index |
| Polymorphic | linh hoạt, thêm loại dễ | không có FK, dữ liệu mồ côi |
| Nhiều cột FK + `CHECK` | toàn vẹn thật | thêm loại cần migration |
| Bảng cha chung | toàn vẹn + mở rộng | một tầng gián tiếp, INSERT hai bước |
| `ON DELETE CASCADE` | dọn tự động | xoá dây chuyền ngoài dự kiến |
| `ON DELETE RESTRICT` | an toàn | phải dọn theo thứ tự |
| Đối xứng lưu 2 dòng | query đơn giản | phải giữ đồng bộ |
| Đối xứng lưu 1 dòng | không lệch được | query phức tạp hơn |
| Mảng thay bảng nối | ít bảng | mất FK và constraint |

## Explain Without Notes

1. Hai câu hỏi để xác định cardinality, và câu hỏi thứ ba thường bị bỏ?
2. FK nằm ở phía nào trong 1:N? Điều gì xảy ra nếu đặt sai?
3. Ba dấu hiệu cho biết bảng nối đã thành một thực thể?
4. Vì sao `PRIMARY KEY (a, b)` không phục vụ query theo `b`?
5. Ba cách làm quan hệ đa hình, và mỗi cách đánh đổi gì?
6. Vì sao 1:1 thiếu `UNIQUE` là nguy hiểm?
7. Cardinality ảnh hưởng thế nào tới số dòng khi JOIN, và điều đó gây bug gì?

## Related

- [Normalization](02-normalization.md) — vì sao dữ liệu được chia ra bảng
- [Constraints & invariants](01-constraints-invariants.md) — FK, `UNIQUE`, `CHECK`
- [Migrations](04-migrations.md) — đổi quan hệ trên hệ thống đang chạy
- [Joins & aggregation](../00-sql/02-joins-aggregation.md) — cardinality quyết định số dòng và fan-out
- [Subqueries & CTE](../00-sql/03-subqueries-cte.md) — `WITH RECURSIVE` cho cây
- [Index & query plan](../01-postgresql/02-index-query-plan.md) — tiền tố trái, index chiều ngược
- [Locking & deadlock](../01-postgresql/05-locking-deadlock.md) — FK và deadlock

## Version / Context

PostgreSQL 16. `num_nonnulls()` từ 9.6. Kiểu mảng và `WITH RECURSIVE` là tính năng chuẩn của PostgreSQL; các khái niệm cardinality là lý thuyết quan hệ, đúng với mọi RDBMS.

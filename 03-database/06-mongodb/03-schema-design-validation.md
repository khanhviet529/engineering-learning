---
level: intermediate
area: database
prerequisites:
  - 01-document-model.md
  - 02-embed-vs-reference.md
related:
  - ../03-data-modeling/01-constraints-invariants.md
  - ../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md
---

# Schema design & validation

> "MongoDB không có schema" là sai. Schema luôn tồn tại — nó nằm trong code đọc dữ liệu. Câu hỏi duy nhất là schema đó được **ép** ở đâu, hay không được ép ở đâu cả.

*Baseline: MongoDB 7.x/8.x.*

## Position

```text
Application code  (schema ẩn: code giả định field nào tồn tại)
      ↓ validation ở app? (Zod, class-validator)
MongoDB collection
      ↓ validation ở DB? ($jsonSchema validator)
Documents (có thể khác cấu trúc nhau)
```

## Problem

Một collection sau 18 tháng phát triển:

```js
// Document tạo tháng 1/2025
{ _id: 1, name: "Khánh", email: "a@b.com" }

// Tháng 6: thêm phone
{ _id: 2, name: "An", email: "c@d.com", phone: "0900..." }

// Tháng 9: một dev khác dùng tên khác
{ _id: 3, name: "Bình", email: "e@f.com", phoneNumber: "0901..." }

// Tháng 12: tách tên, và phone thành array
{ _id: 4, firstName: "Chi", lastName: "Lê", email: "g@h.com", phones: ["0902..."] }

// Tháng 3/2026: một bug ghi phone thành number
{ _id: 5, name: "Dũng", email: "i@j.com", phone: 903000000 }
```

Giờ viết code đọc `phone`:

```ts
// Phải xử lý: phone, phoneNumber, phones[], number, undefined
const phone = u.phone ?? u.phoneNumber ?? u.phones?.[0];
const normalized = typeof phone === 'number' ? String(phone) : phone;
```

Và query im lặng sai:

```js
db.users.find({ phone: { $gt: "0900" } })   // bỏ qua _id: 5 (number), _id: 3, _id: 4
```

Không có gì báo lỗi. Không có migration nào thất bại. Dữ liệu chỉ đơn giản **không nhất quán**, và mỗi hàm đọc nó phải tự phòng thủ.

Đây là chi phí thật của "schemaless" — nó không biến mất, nó chỉ được chuyển từ database sang mọi dòng code đọc dữ liệu.

## Mental Model

```text
Schema KHÔNG BAO GIỜ mất. Nó chỉ chuyển chỗ.

PostgreSQL:  schema ở DATABASE     → ép lúc ghi, một nơi, không thể lách
MongoDB:     schema ở APPLICATION  → ép ở nơi bạn chọn, hoặc không ép

Câu hỏi đúng: "Schema của tôi được ép ở đâu?"
Không phải:   "Tôi có cần schema không?"
```

Ba mức ép, và bạn nên có ít nhất hai:

| Mức | Công cụ | Bảo vệ khỏi | Không bảo vệ khỏi |
|---|---|---|---|
| **Application** | Zod, class-validator, Mongoose | dữ liệu sai từ API | script chạy tay, service khác, migration |
| **Database** | `$jsonSchema` validator | **mọi** đường ghi | dữ liệu đã tồn tại trước khi bật |
| **Đọc** | parse + normalize khi đọc | dữ liệu cũ đã lệch | không ngăn dữ liệu lệch mới |

Khuyến nghị: **application + database**. Application cho thông báo lỗi tốt; database cho bảo đảm thật.

Lý do cần cả hai: validation ở application là thứ **có thể lách** — một script migration, một service khác, một lần `db.users.insertOne()` trong shell. Validator ở database là lớp cuối, giống [constraint trong PostgreSQL](../03-data-modeling/01-constraints-invariants.md).

## How It Works

### `$jsonSchema` validator

```js
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "name", "createdAt", "schemaVersion"],
      properties: {
        schemaVersion: { bsonType: "int", minimum: 1 },
        email: {
          bsonType: "string",
          pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"
        },
        name: { bsonType: "string", minLength: 1, maxLength: 200 },
        phones: {
          bsonType: "array",
          maxItems: 5,                       // ← ép TRẦN cho array
          items: { bsonType: "string" }
        },
        status: { enum: ["active", "suspended", "deleted"] },
        createdAt: { bsonType: "date" }
      },
      additionalProperties: true             // xem giải thích dưới
    }
  },
  validationLevel: "moderate",               // xem bảng dưới
  validationAction: "error"
});
```

Hai tham số quyết định behavior, và chọn sai gây sự cố:

| `validationLevel` | Áp dụng cho |
|---|---|
| `strict` (mặc định) | **mọi** insert và update — kể cả update document cũ đang không hợp lệ |
| `moderate` | insert mới + update document **đã hợp lệ**; document cũ không hợp lệ vẫn update được |
| `off` | không validate |

| `validationAction` | Khi vi phạm |
|---|---|
| `error` (mặc định) | từ chối ghi |
| `warn` | **cho ghi**, chỉ ghi log |

Lộ trình bật validator cho collection đang chạy — bốn bước, đây là cách duy nhất an toàn:

```text
1. validationAction: "warn", validationLevel: "moderate"
   → không chặn gì, thu log vi phạm
2. Đọc log, sửa dữ liệu cũ và sửa code ghi sai
3. Đổi sang validationAction: "error", giữ moderate
   → dữ liệu mới bị ép; document cũ chưa sửa vẫn update được
4. Sau khi backfill xong → validationLevel: "strict"
```

Bật `strict` + `error` ngay trên collection đang chạy là cách nhanh nhất gây outage: mọi update trên document cũ đột nhiên thất bại.

`additionalProperties: false` chặn field không khai báo. Nó nghiêm ngặt hơn nhưng làm mọi thay đổi schema thành breaking change — với collection đang phát triển, `true` thực dụng hơn.

### `maxItems` — ép trần array

Đây là ứng dụng có giá trị nhất của validator: nó biến quy tắc "array phải có trần" từ [note 02](02-embed-vs-reference.md) thành thứ database ép buộc.

```js
phones: { bsonType: "array", maxItems: 5 }
recentComments: { bsonType: "array", maxItems: 5 }
```

Không có nó, một `$push` bị bug sẽ phình document tới 16MB và bạn chỉ biết khi nó vỡ.

### Unique index — constraint duy nhất MongoDB thật sự có

```js
db.users.createIndex({ email: 1 }, { unique: true });

// Unique có điều kiện — chỉ ép trên document thoả filter
db.users.createIndex(
  { email: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $exists: false } } }
);
```

Partial unique index giải quyết vấn đề soft delete kinh điển: sau khi xoá mềm một user, email đó phải dùng lại được. Xem [Soft delete & audit patterns](../03-data-modeling/05-soft-delete-audit-patterns.md).

**MongoDB không có:**

| Constraint | PostgreSQL | MongoDB |
|---|---|---|
| `NOT NULL` | có | qua `required` trong validator |
| `UNIQUE` | có | **có** (unique index) |
| `CHECK` | có | qua validator (`minimum`, `pattern`, `enum`) |
| `FOREIGN KEY` | có | **không có** |
| `ON DELETE CASCADE` | có | **không có** — phải tự làm |
| default value | có | **không có** — phải đặt ở app |

Không có foreign key nghĩa là **reference mồ côi là trạng thái có thể xảy ra**, và bạn phải xử lý nó ở tầng đọc:

```js
// authorId trỏ tới user đã bị xoá — $lookup trả array rỗng
{ $lookup: { from: "users", localField: "authorId", foreignField: "_id", as: "author" } },
{ $set: { author: { $ifNull: [{ $first: "$author" }, { name: "[đã xoá]" }] } } }
```

Đây là chi phí thực sự của việc thiếu FK, và nó phải được thiết kế vào, không phải phát hiện sau.

### Schema evolution — không có `ALTER TABLE`

Thêm field mới **không cần migration** — đây là điểm mạnh thật:

```js
// Chỉ cần code xử lý được cả hai trường hợp
const tier = user.tier ?? 'free';       // document cũ không có field này
```

Nhưng thay đổi **phá tương thích** (đổi tên, đổi kiểu, tách field) cần migration, và MongoDB không giúp bạn. Hai chiến lược:

**A. Migration on read (lazy)** — không downtime, không backfill:

```ts
function normalizeUser(doc: unknown): User {
  const d = doc as Record<string, unknown>;
  switch (d.schemaVersion ?? 1) {
    case 1: {
      // v1: { name } → v2: { firstName, lastName }
      const [firstName = '', ...rest] = String(d.name ?? '').split(' ');
      return { ...d, firstName, lastName: rest.join(' '), schemaVersion: 2 } as User;
    }
    case 2:
      return d as unknown as User;
    default:
      throw new Error(`schemaVersion không hỗ trợ: ${d.schemaVersion}`);
  }
}
```

Được: không downtime, dữ liệu cũ được chuyển đổi khi đọc.
Mất: code phải giữ **mọi** version mãi mãi (hoặc tới khi backfill xong), và query trên field mới không hoạt động với document cũ.

Điểm cuối quan trọng: nếu bạn cần `db.users.find({ lastName: "Lê" })`, migration-on-read **không đủ** — document v1 không có field đó. Khi cần query, phải backfill thật.

**B. Backfill (eager)** — theo lô, giống expand/contract:

```js
// Chạy theo lô, không một câu duy nhất
let migrated = 0;
while (true) {
  const batch = db.users.find({ schemaVersion: { $lt: 2 } }).limit(1000).toArray();
  if (batch.length === 0) break;

  const ops = batch.map(u => {
    const [firstName = '', ...rest] = String(u.name ?? '').split(' ');
    return {
      updateOne: {
        filter: { _id: u._id },
        update: { $set: { firstName, lastName: rest.join(' '), schemaVersion: 2 },
                  $unset: { name: "" } }
      }
    };
  });
  db.users.bulkWrite(ops, { ordered: false });
  migrated += batch.length;
  sleep(100);                              // nhường I/O, tránh replication lag
}
```

Trong thực tế dùng **cả hai**: bật migration-on-read trước (code chịu được cả hai version), rồi backfill nền, rồi bỏ code v1. Đây chính là expand/contract của [Prisma migrations](../05-data-access/05-prisma-migrations-production.md) áp dụng cho document.

### `schemaVersion` — field nên có từ document đầu tiên

```js
{ _id: ..., schemaVersion: 2, firstName: "Chi", lastName: "Lê" }
```

Không có nó, bạn phải đoán version bằng cách kiểm tra field nào tồn tại (`if (d.firstName) ...`) — và cách đó vỡ khi có hai thay đổi độc lập. Thêm `schemaVersion` từ đầu tốn một int; thêm nó sau tốn một lần backfill.

## Example

```ts
// Ba lớp: Zod ở app (thông báo lỗi tốt) + validator ở DB (bảo đảm thật) + normalize khi đọc
const UserSchema = z.object({
  schemaVersion: z.literal(2),
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100),
  phones: z.array(z.string()).max(5),
  status: z.enum(['active', 'suspended', 'deleted']),
  createdAt: z.date(),
});
type User = z.infer<typeof UserSchema>;

async function createUser(input: unknown) {
  const data = UserSchema.parse({ ...(input as object), schemaVersion: 2, createdAt: new Date() });
  await db.collection('users').insertOne(data);   // validator ở DB là lớp cuối
}

async function getUser(id: ObjectId): Promise<User> {
  const doc = await db.collection('users').findOne({ _id: id });
  if (!doc) throw new NotFoundError('user', String(id));
  return UserSchema.parse(normalizeUser(doc));    // normalize v1 → v2, rồi validate
}
```

## Prediction

1. Bật `validationLevel: "strict"`, `validationAction: "error"` trên collection có 30% document không hợp lệ — điều gì xảy ra với update?
2. Với `moderate` — update document cũ không hợp lệ có thành công?
3. `maxItems: 5` rồi `$push` phần tử thứ 6 — kết quả?
4. Không có foreign key, xoá user còn post trỏ tới — post thế nào?
5. Migration-on-read cho `name` → `lastName`, rồi `find({ lastName: "Lê" })` — document v1 có được trả về?
6. Field `phone` là string ở 90% document, number ở 10%, `find({ phone: { $gt: "0900" } })` — bao nhiêu % được xét?
7. Unique index trên `email` với soft delete — user xoá mềm rồi đăng ký lại cùng email?
8. Thêm field mới vào schema, `additionalProperties: false` — document cũ có update được?

<details>
<summary>Đáp án</summary>

1. **Mọi update trên 30% đó thất bại** — outage tức thì.
2. Có — `moderate` chỉ ép với document đã hợp lệ.
3. Ghi bị từ chối (với `error`).
4. `authorId` trỏ tới ID không tồn tại — mồ côi, `$lookup` trả rỗng.
5. **Không** — query chạy trên dữ liệu thật, không qua code normalize.
6. 90% — 10% kiểu number bị bỏ qua im lặng.
7. Bị chặn — cần `partialFilterExpression`.
8. Có, nếu field mới được khai báo; nhưng mọi field chưa khai báo khác sẽ bị chặn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Insert cùng field với 3 kiểu khác nhau, rồi query `$gt` | Kết quả bỏ sót im lặng |
| Đếm kiểu thật: `$group` theo `{ $type: "$field" }` | Thấy sự không nhất quán |
| Bật `strict` + `error` trên collection có document cũ | Update thất bại hàng loạt |
| Đổi sang `moderate` | Update lại hoạt động |
| `maxItems: 3`, `$push` 5 lần | Bị chặn ở lần thứ 4 |
| Bỏ `maxItems`, `$push` 100.000 lần | Document phình tới 16MB |
| Xoá user, query post kèm `$lookup` author | Array rỗng — reference mồ côi |
| Unique index không partial + soft delete + đăng ký lại | Bị chặn |
| Migration-on-read rồi query field mới | Document cũ không khớp |
| `additionalProperties: false` rồi thêm field ở code | Ghi bị chặn |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| MongoDB không có schema | Schema ở application; câu hỏi là ai ép nó |
| Schemaless nghĩa là linh hoạt miễn phí | Chi phí chuyển sang mọi dòng code đọc dữ liệu |
| Không cần migration trong MongoDB | Chỉ với thay đổi additive; đổi tên/kiểu vẫn cần |
| Validator ép cả dữ liệu cũ | Chỉ ép lúc ghi; dữ liệu cũ không bị kiểm tra |
| `strict` an toàn hơn nên nên bật ngay | Bật ngay trên collection đang chạy = outage |
| MongoDB có foreign key | Không — reference mồ côi là trạng thái có thể xảy ra |
| Migration-on-read là đủ | Query trên field mới không hoạt động với document cũ |
| Validation ở app là đủ | Script và service khác lách được |

## Debugging

1. **Kiểm tra sự không nhất quán kiểu** — nên làm định kỳ, không chờ bug:
   ```js
   db.users.aggregate([
     { $group: { _id: { f: { $type: "$phone" } }, n: { $sum: 1 } } },
     { $sort: { n: -1 } }
   ]);
   ```
   Nhiều hơn một type cho cùng field là nguyên nhân của query sai.
2. **Đếm document theo `schemaVersion`** để biết backfill còn bao nhiêu:
   ```js
   db.users.aggregate([{ $group: { _id: "$schemaVersion", n: { $sum: 1 } } }]);
   ```
3. **Xem validator hiện tại**: `db.getCollectionInfos({ name: "users" })[0].options`.
4. **Tìm document không hợp lệ** trước khi siết validator:
   ```js
   db.users.find({ $nor: [ { $jsonSchema: mySchema } ] }).count();
   ```
5. **Tìm reference mồ côi**:
   ```js
   db.posts.aggregate([
     { $lookup: { from: "users", localField: "authorId", foreignField: "_id", as: "a" } },
     { $match: { a: { $size: 0 } } }, { $count: "orphans" }
   ]);
   ```
6. **Ghi bị từ chối** → lỗi validation của MongoDB chỉ rõ field và quy tắc nào vi phạm; đọc nó thay vì đoán.

## Production Considerations

- **`schemaVersion` trong mọi document, từ document đầu tiên.** Thêm sau tốn một lần backfill.
- **Validator ở database** cho mọi collection quan trọng, với `maxItems` cho mọi array.
- **Bật validator theo 4 bước** (`warn`/`moderate` → sửa → `error` → `strict`). Không bao giờ nhảy thẳng.
- **Validation ở application** bằng Zod cho thông báo lỗi tốt và type suy ra được.
- **Kiểm tra sự nhất quán kiểu định kỳ** như một job — nó phát hiện bug ghi trước khi query sai.
- **Xử lý reference mồ côi ở tầng đọc** (`$ifNull`) — nó là trạng thái hợp lệ, không phải ngoại lệ.
- **Backfill theo lô với `sleep`**, theo dõi replication lag. Xem [Operations & production](07-operations-production.md).
- **Partial unique index** cho mọi trường hợp có soft delete.
- Nếu bạn thấy mình cần validator rất nghiêm ngặt cho mọi field, không có thay đổi schema, và nhiều constraint quan hệ — đó là tín hiệu PostgreSQL phù hợp hơn. Xem [note 08](08-postgresql-vs-mongodb.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Validator ở DB | bảo đảm thật, không lách được | thay đổi schema cần cập nhật validator |
| Chỉ validation ở app | linh hoạt, thông báo lỗi tốt | script/service khác lách được |
| `strict` | nhất quán tối đa | update document cũ thất bại |
| `moderate` | bật được trên collection đang chạy | document cũ vẫn không hợp lệ |
| `additionalProperties: false` | chặn field lạ | mọi thay đổi thành breaking |
| Migration on read | không downtime, không backfill | code giữ nhiều version; query field mới không hoạt động |
| Backfill | dữ liệu thật nhất quán | tốn thời gian, cần theo lô |

## Explain Without Notes

1. Vì sao "MongoDB không có schema" là sai? Schema nằm ở đâu?
2. Ba mức ép schema, và vì sao cần ít nhất hai?
3. Bốn bước bật validator an toàn trên collection đang chạy?
4. `strict` vs `moderate` khác nhau ở đâu, và vì sao khác biệt đó quan trọng?
5. Migration-on-read **không** giải quyết được vấn đề gì?
6. Ba constraint MongoDB không có, và hệ quả của việc thiếu foreign key?

## Related

- [Document model](01-document-model.md) — BSON type, `null` vs `$exists`
- [Embed vs reference](02-embed-vs-reference.md) — `maxItems` ép trần array
- [Indexes & query planning](04-indexes-query-planning.md) — unique và partial index
- [Operations & production](07-operations-production.md) — backfill và replication lag
- [Constraints & invariants](../03-data-modeling/01-constraints-invariants.md) — database bảo vệ gì
- [Soft delete & audit patterns](../03-data-modeling/05-soft-delete-audit-patterns.md) — partial unique index
- [Prisma migrations](../05-data-access/05-prisma-migrations-production.md) — expand/contract
- [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md) — validate ở ranh giới

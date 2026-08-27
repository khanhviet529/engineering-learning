---
level: intermediate
area: backend
prerequisites:
  - 02-rest-api-contract.md
related:
  - ../../05-cross-cutting/testing/07-contract-testing.md
  - ../../03-database/03-data-modeling/04-migrations.md
---

# API versioning & evolution

> Cách tốt nhất để xử lý versioning là **không cần version**. Version là chi phí vĩnh viễn: mỗi version phải được test, giữ chạy, và bảo trì bởi người không viết nó.

## Position

```text
Client cũ (mobile app không update được) ─┐
Client mới                                ├→ API → Service → DB
Client bên thứ ba                         ─┘
```

## Problem

Bạn cần đổi `status: string` thành `status: { code: string; label: string }`.

Nhưng: một mobile app đã publish với version cũ đang chạy trên 50.000 thiết bị. Người dùng không update. Một số thiết bị không update được nữa (OS cũ). Bạn không kiểm soát được khi nào client cũ biến mất.

Đây là điểm khác biệt căn bản giữa web và API:

```text
Web app:  deploy frontend mới → mọi người dùng nhận ngay
API:      deploy → client cũ VẪN GỌI api cũ, có thể trong nhiều năm
```

## Mental Model

Phân loại mọi thay đổi trước khi làm gì khác:

```text
BACKWARD COMPATIBLE (an toàn — không cần version)
✅ Thêm field vào RESPONSE
✅ Thêm field OPTIONAL vào request
✅ Thêm endpoint mới
✅ Thêm giá trị mới vào enum RESPONSE  (nếu client xử lý default)
✅ Nới lỏng validation (cho phép nhiều hơn)
✅ Thêm HTTP header

BREAKING (cần version hoặc migration path)
❌ Xoá / đổi tên field
❌ Đổi type của field  (string → object, number → string)
❌ Thêm field BẮT BUỘC vào request
❌ Thắt chặt validation
❌ Đổi status code cho cùng tình huống
❌ Đổi ngữ nghĩa (cùng field, khác ý nghĩa)  ← nguy hiểm nhất
❌ Đổi giá trị mặc định
❌ Xoá giá trị khỏi enum
```

Hàng "đổi ngữ nghĩa" nguy hiểm nhất vì nó **không gây lỗi** — client vẫn parse được, chỉ hiểu sai. Ví dụ: đổi `amount` từ đơn vị đồng sang đơn vị xu. Không có test nào bắt được, và hậu quả là sai số tiền 100 lần.

Nguyên tắc thiết kế để tránh versioning:

> **Tolerant reader**: client bỏ qua field không biết, không fail khi thấy giá trị enum lạ.
> **Additive change**: thêm, không đổi.

Nếu cả server và client tuân theo hai nguyên tắc này, phần lớn thay đổi không cần version.

## How It Works

### Ba cách version, và khi nào dùng

```text
1. URL path        /v1/tasks, /v2/tasks
   ✅ rõ ràng, dễ debug, dễ route ở proxy, cache được
   ❌ trùng lặp route
   → mặc định tốt nhất cho phần lớn API

2. Header          Accept: application/vnd.api.v2+json
   ✅ URL sạch, đúng chuẩn REST hơn
   ❌ khó test bằng curl/browser, dễ quên, cache phải Vary
   → dùng khi có yêu cầu cụ thể

3. Query param     /tasks?version=2
   ✅ đơn giản nhất
   ❌ dễ bị bỏ qua, lẫn với filter, cache khó
   → tránh
```

Với URL path, chỉ version **major**. Không có `/v1.2.3` — nếu bạn cần version minor thì thay đổi đó nên là backward compatible.

### Migration path — cách thay đổi mà không version

Đổi `status: string` → `statusDetail: object` trong 4 bước, không có version mới:

```text
Bước 1: THÊM field mới, GIỮ field cũ
{
  "status": "open",                                    ← deprecated nhưng còn đó
  "statusDetail": { "code": "open", "label": "Đang mở" }
}

Bước 2: Đánh dấu deprecated
- Tài liệu: "status deprecated, dùng statusDetail, sẽ xoá 2027-01-01"
- Response header: Deprecation: true, Sunset: Wed, 01 Jan 2027 00:00:00 GMT
- Log mỗi lần field cũ được đọc (đo bằng client ID)

Bước 3: ĐO — bao nhiêu client còn dùng field cũ?
- Chờ tới khi gần 0, hoặc tới sunset date

Bước 4: XOÁ field cũ
```

Bước 3 là bước bị bỏ nhiều nhất và cũng là bước quan trọng nhất: không có số liệu, bạn chỉ đang đoán về việc xoá có an toàn hay không.

```ts
// Đo việc sử dụng field deprecated
@Get(':id')
async findOne(@Param('id') id: string, @Headers('x-client-id') clientId?: string) {
  const task = await this.tasks.find(id);

  this.metrics.increment('api.deprecated_field.read', {
    field: 'status',
    client: clientId ?? 'unknown',
  });

  return { ...toDto(task), status: task.status };   // field cũ vẫn có
}
```

### Deprecation header (RFC 8594 / draft)

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Wed, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.example.com/migrate-v2>; rel="deprecation"
```

### Khi buộc phải có v2

```ts
// NestJS versioning
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

@Controller({ path: 'tasks', version: '1' })
export class TasksV1Controller {
  constructor(private readonly tasks: TasksService) {}
  @Get(':id') find(@Param('id') id: string) {
    return toV1Dto(this.tasks.find(id));       // chỉ khác ở tầng DTO
  }
}

@Controller({ path: 'tasks', version: '2' })
export class TasksV2Controller {
  constructor(private readonly tasks: TasksService) {}
  @Get(':id') find(@Param('id') id: string) {
    return toV2Dto(this.tasks.find(id));
  }
}
```

Quy tắc quan trọng: **version chỉ tồn tại ở tầng DTO/controller.** Service và domain logic **không** được biết về version. Nếu logic nghiệp vụ phân nhánh theo version, bạn sẽ có hai hệ thống phải bảo trì thay vì một.

### Chính sách sunset

```text
Công bố: version mới ra + version cũ có ngày kết thúc
Hỗ trợ:  tối thiểu 6–12 tháng cho client nội bộ, 12–24 tháng cho bên thứ ba
Nhắc:    email + Deprecation header + log
Đo:      traffic theo version, theo client
Tắt:     giảm dần (brownout) trước khi tắt hẳn
```

**Brownout** là kỹ thuật hữu ích: trả 410 Gone cho version cũ trong 1 giờ vào một ngày công bố trước, để client phát hiện họ vẫn phụ thuộc — trước khi bạn tắt vĩnh viễn.

## Example

```ts
// Thiết kế mở rộng được từ đầu — giảm nhu cầu version
// ❌ Array trần: thêm metadata là breaking
GET /tasks → [ {...}, {...} ]

// ✅ Bọc: thêm pageInfo, meta sau này không phá gì
GET /tasks → { "data": [...], "pageInfo": {...} }

// ❌ Enum số: thêm giá trị mới, client cũ hiểu sai
{ "status": 1 }

// ✅ Enum string + client tolerant
{ "status": "open" }
// Client: switch(status) { case 'open': ...; default: renderUnknown(); }
```

## Prediction

1. Thêm field `avatarUrl` vào response — client cũ hỏng không?
2. Đổi `id` từ number sang string — client cũ hỏng không?
3. Thêm giá trị `archived` vào enum `status`; client cũ có `switch` không có `default` — điều gì xảy ra?
4. Đổi `amount` từ đơn vị đồng sang xu, giữ nguyên tên và type — test nào bắt được?
5. Thêm field bắt buộc `projectId` vào request — client cũ nhận gì?
6. Bạn xoá `/v1` sau 3 tháng — có gì có thể xảy ra?
7. Version phân nhánh trong service layer — bao nhiêu hệ thống bạn phải bảo trì?

<details>
<summary>Đáp án chọn lọc</summary>

3. Rơi vào nhánh không xử lý — có thể crash hoặc hiện trạng thái rỗng.
4. **Không test nào** — type đúng, parse được, chỉ giá trị sai 100 lần. Đây là lý do đổi ngữ nghĩa nguy hiểm nhất.
5. 400 cho mọi request.
7. Hai — và số này nhân lên với mỗi version.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi tên field trong response, chạy client cũ | `undefined` — hỏng im lặng |
| Thêm field bắt buộc vào request | 400 cho mọi client cũ |
| Đổi enum số sang string | So sánh `=== 1` hỏng |
| Thêm giá trị enum, client không có `default` | Nhánh không xử lý |
| Đổi đơn vị tiền, giữ tên field | Không có lỗi; số sai 100 lần |
| Xoá version cũ mà không đo traffic | Client không rõ nào hỏng |
| Đổi 404 thành 200 với body rỗng | Client kiểm tra status không phát hiện |
| Version phân nhánh trong service | Đếm số nhánh `if (version === ...)` sau 3 version |
| Brownout 1 giờ cho v1 | Xem client nào báo lỗi — thông tin quý trước khi tắt hẳn |

## What Usually Goes Wrong

- **Đổi ngữ nghĩa mà không đổi tên** — không có test nào bắt được.
- **Xoá field mà không đo** ai còn dùng.
- **Version phân nhánh sâu vào service layer** → hai hệ thống.
- **Không có ngày sunset** → v1 sống mãi, và không ai dám xoá.
- **Client không tolerant** → mọi thay đổi additive cũng thành breaking.
- **Array trần / enum số** → thiết kế tự tạo nhu cầu version.
- **Không có contract test** → breaking change lọt qua CI.
- **Thắt chặt validation** như một "sửa bug" → phá client đang gửi dữ liệu cũ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Version giải quyết vấn đề thay đổi | Nó hoãn vấn đề và thêm chi phí vĩnh viễn |
| Thêm field là breaking | Không, nếu client tolerant |
| Chỉ cần `/v2` là xong | Bạn vừa cam kết bảo trì hai API |
| Client sẽ update khi bạn thông báo | Mobile app đã publish thì không |
| Version minor có ý nghĩa cho API | Nếu cần minor version, thay đổi đó nên là compatible |
| Thắt validation là sửa bug | Với client đang chạy, nó là breaking change |
| Có thể xoá version cũ khi thấy hợp lý | Cần số liệu, không cần cảm giác |

## Debugging

1. **Client cũ hỏng sau deploy** → so sánh response schema trước/sau. Tìm field bị xoá, đổi tên, đổi type.
2. **Không rõ ai dùng gì** → thêm log/metric theo `X-Client-Id` và version. Không có dữ liệu này thì mọi quyết định xoá là đánh cược.
3. **Contract test trong CI** — so response thật với spec đã đông cứng. Đây là cách duy nhất bắt breaking change tự động. Xem [Contract testing](../../05-cross-cutting/testing/07-contract-testing.md).
4. **Nghi đổi ngữ nghĩa** → kiểm tra bằng dữ liệu thật, không bằng type. So giá trị trước/sau cho cùng một record.
5. **Traffic theo version** → dashboard; nó cho biết khi nào an toàn để tắt.
6. Kiểm tra OpenAPI spec có được sinh từ code (không viết tay) — spec lệch là nguồn của breaking change không phát hiện.

## Production Considerations

- **Thiết kế mở rộng được từ đầu**: bọc collection, enum string, ID string, field optional. Nó rẻ hơn versioning rất nhiều.
- **Client tolerant reader**: bỏ qua field lạ, có `default` cho enum.
- **Contract test trong CI** để breaking change fail build.
- **Metric theo version và theo client** trước khi nghĩ tới việc xoá.
- **Deprecation + Sunset header** và ngày cụ thể trong tài liệu.
- **Brownout** trước khi tắt hẳn.
- **Version chỉ ở tầng DTO** — service layer không biết version.
- **Với API nội bộ**, cân nhắc không version chút nào: deploy client và server cùng lúc, dùng contract test để bảo đảm. Đây thường là lựa chọn đúng cho monorepo.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không version, chỉ additive | không có chi phí bảo trì kép | ràng buộc thiết kế; không đổi được ngữ nghĩa |
| URL version | rõ ràng, dễ route và cache | trùng lặp route |
| Header version | URL sạch | khó test, cần `Vary` |
| Hỗ trợ nhiều version lâu | client thoải mái | chi phí bảo trì tăng theo số version |
| Sunset nhanh | ít chi phí | phá client chậm update |
| Contract test | bắt breaking change tự động | cần bảo trì spec/test |

## Explain Without Notes

1. Phân loại 5 thay đổi backward compatible và 5 breaking.
2. Vì sao "đổi ngữ nghĩa mà không đổi tên" là loại thay đổi nguy hiểm nhất?
3. Bốn bước migration để đổi một field mà không cần version?
4. Vì sao version không được phân nhánh vào service layer?
5. Brownout là gì và giải quyết vấn đề gì?

## Related

- [REST API contract](02-rest-api-contract.md) — thiết kế mở rộng được
- [Error model](05-error-model.md) — `code` cũng là hợp đồng cần ổn định
- [Contract testing](../../05-cross-cutting/testing/07-contract-testing.md) — bắt breaking change
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — cùng nguyên lý ở tầng schema
- [Deprecation & migration](../04-architecture/03-domain-logic-boundaries.md) — ranh giới nội bộ

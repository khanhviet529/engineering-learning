---
level: advanced
area: backend
---

# Backend architecture

Folder này trả lời một câu hỏi duy nhất, hỏi đi hỏi lại ở nhiều quy mô khác nhau:

> **Khi một thứ thay đổi, tôi phải sửa ở đâu — và bao nhiêu chỗ?**

Con số đó là chỉ số sức khoẻ kiến trúc trung thực nhất. Nó không nằm trong sơ đồ nào; nó đo được bằng `grep`.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Controller → Service → Repository](01-controller-service-repository.md) | Ba tầng để làm gì, và khi nào không cần? |
| 2 | [Modular monolith](02-modular-monolith.md) | Vì sao layer không đủ, và có nên tách microservices không? |
| 3 | [Domain logic boundaries](03-domain-logic-boundaries.md) | Quy tắc nghiệp vụ nên sống ở đâu? |
| 4 | [Error handling strategy](04-error-handling-strategy.md) | Lỗi đi tới client, log và alert thế nào? |
| 5 | [Configuration](05-configuration.md) | Cái gì vào artifact, cái gì vào môi trường? |

Note 1 → 3 đi từ ngoài vào trong (tầng → module → domain). Note 4 và 5 là hai quyết định xuyên suốt phải thống nhất từ đầu, vì thêm sau nghĩa là rà lại toàn bộ codebase.

### Khi codebase đã lớn — bốn note về *chi phí* của trừu tượng

Note 1–5 trả lời *"code đặt ở đâu"*. Bốn note sau trả lời câu khó hơn: *"khi nào thêm một tầng là đúng, và khi nào nó là over-engineering"*.

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 6 | [SOLID trong thực tế](06-solid-in-practice.md) | SOLID áp dụng tới đâu là đủ? Vì sao nó là heuristic, không phải luật? |
| 7 | [Clean architecture pragmatic](07-clean-architecture-pragmatic.md) | Khi nào cần nhiều tầng, khi nào 2 tầng là đúng? |
| 8 | [Service decomposition](08-service-decomposition.md) | Service inject 15 dependency nói lên điều gì? |
| 9 | [BFF & aggregation](09-bff-and-aggregation.md) | Khi nào cần BFF, và ba thứ phải thiết kế cùng nó? |

Câu hỏi chung của cả bốn note, và là câu nên hỏi trong mọi code review:

> **Trừu tượng này cho phép tôi làm gì mà không có nó thì không làm được?**
>
> Không trả lời được → xoá nó.

Đọc note 8 trước note 6 nếu bạn đang có một service quá lớn ngay bây giờ — nó cho quy trình chẩn đoán cụ thể, và bước sửa rẻ nhất (event cho side effect) thường giải quyết phần lớn vấn đề mà không tách class nào.

## Bốn ranh giới, bốn thứ chúng bảo vệ

```text
LAYER      controller / service / repository
           → bảo vệ khỏi: đổi giao thức, đổi storage
           → không bảo vệ khỏi: module này chạm bảng module kia

MODULE     tasks / billing / identity
           → bảo vệ khỏi: mọi thứ phụ thuộc mọi thứ
           → ép bằng: public API + eslint + madge + GRANT ở PostgreSQL

DOMAIN     quy tắc nghiệp vụ vs điều phối vs hạ tầng
           → bảo vệ khỏi: quy tắc bị hoà tan vào controller/SQL/frontend
           → ép bằng: domain không import framework

RUNTIME    artifact vs môi trường
           → bảo vệ khỏi: staging và production là hai thứ khác nhau
           → ép bằng: validate config, fail fast
```

## Đo, đừng vẽ sơ đồ

Sáu lệnh trả lời chính xác hơn mọi tài liệu kiến trúc:

```bash
# 1. Vòng phụ thuộc — mục tiêu: 0
npx madge --circular --extensions ts src/

# 2. Module nào chạm bảng của module khác — mục tiêu: 0
grep -rn "prisma.task\." src/modules --include="*.ts" | grep -v "src/modules/tasks/"

# 3. Domain có import hạ tầng không — mục tiêu: 0
grep -rn "prisma\|HttpException\|@Injectable\|axios" src/domain/

# 4. Bao nhiêu chỗ đọc process.env — mục tiêu: 1 file
grep -rn "process.env" src/ --include="*.ts" | grep -v "src/config/"

# 5. Một tính năng điển hình đụng bao nhiêu module — mục tiêu: 1–2
git log --name-only --pretty=format: -20 | cut -d/ -f1-3 | sort -u

# 6. Service nào quá lớn (thường là nhiều use case bị gộp)
find src -name "*.service.ts" -exec wc -l {} + | sort -rn | head
```

Nếu lệnh 5 luôn ra cùng một tập folder, những folder đó thực chất là **một** module dù bạn đã đặt tên riêng cho chúng.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Cùng logic tồn tại ở 2 nơi (HTTP và cron) | logic nằm trong controller → [1](01-controller-service-repository.md) |
| Đổi tên một cột làm vỡ nhiều module | truy cập chéo bảng → [2](02-modular-monolith.md) |
| `Nest can't resolve` / phải dùng `forwardRef` | vòng phụ thuộc = ranh giới sai → [2](02-modular-monolith.md) |
| Không trả lời được "quy tắc X ở đâu" | quy tắc bị hoà tan → [3](03-domain-logic-boundaries.md) |
| Test một quy tắc cần dựng DB | domain dính hạ tầng → [3](03-domain-logic-boundaries.md) |
| Alert bị tắt vì kêu suốt | 4xx log ở mức error → [4](04-error-handling-strategy.md) |
| Không lần được từ báo cáo user tới log | thiếu `requestId` → [4](04-error-handling-strategy.md) |
| Client retry lỗi không bao giờ tự khỏi | thiếu phân loại `retryable` → [4](04-error-handling-strategy.md) |
| Chạy local ổn, staging `undefined` | không validate config → [5](05-configuration.md) |
| Phải build lại image cho mỗi môi trường | config nướng vào artifact → [5](05-configuration.md) |
| Tắt gấp một tính năng cần một lần deploy | feature flag để nhầm trong env var → [5](05-configuration.md) |

## Nguyên tắc chung của cả folder

```text
1. Ranh giới xuất hiện khi có thứ để bảo vệ, không vì quy ước.
2. Quy ước không được công cụ ép sẽ bị vi phạm — hãy ép trong CI.
3. Hướng của lỗi khi con người quên phải là hướng an toàn.
4. Trừu tượng hoá sau ví dụ thứ hai, không phải trước ví dụ thứ nhất.
5. Đo bằng lệnh, không tranh luận bằng sơ đồ.
```

## Position

```text
HTTP / Queue / Cron / CLI → NestJS → APPLICATION → DOMAIN → Repository → PostgreSQL
                                     ↑ folder này
```

## Related

- [02-nestjs/](../02-nestjs/README.md) — nơi những ranh giới này được implement
- [00-http-api/](../00-http-api/README.md) — hợp đồng ở tầng ngoài cùng
- [03-auth/](../03-auth/README.md) — authorization là một ranh giới phải ép ở tầng dữ liệu
- [06-system-design/](../../06-system-design/README.md) — cùng câu hỏi ở quy mô nhiều service
- [Modular monolith → microservices](../../06-system-design/08-monolith-to-microservices.md)
- [05-cross-cutting/](../../05-cross-cutting/README.md) — concern xuyên mọi ranh giới

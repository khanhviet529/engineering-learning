---
level: foundation | intermediate | advanced
area: frontend | backend | database | infra | cross-cutting | system-design
prerequisites:
  - <đường dẫn tới note cần đọc trước>
related:
  - <đường dẫn tới note liên quan>
---

# <Topic>

> Một dòng: behavior nào của hệ thống mà note này giải thích?

## Position

Topic này nằm ở đâu trên đường đi của một request?

```text
Browser → Next.js → HTTP → NestJS → PostgreSQL
                                ↑ ở đây
```

Ghi cụ thể, không ghi nhãn chung. `React → HTTP API` tốt hơn `Frontend`.

## Problem

Vấn đề nào khiến khái niệm này tồn tại? Nếu không có nó thì hệ thống sai ở đâu?

Không mở đầu bằng định nghĩa. Mở đầu bằng thứ bị hỏng.

## Mental Model

Giải thích bằng ngôn ngữ đơn giản, một hình dung mà bạn có thể vẽ lại từ đầu.

Không copy định nghĩa từ documentation.

## How It Works

Cơ chế thực tế bên trong. Ai làm gì, theo thứ tự nào, giữ state ở đâu.

## Example

Ví dụ tối thiểu có thể chạy hoặc suy luận được. Ưu tiên TypeScript. Không viết boilerplate.

```ts
// nhỏ, tập trung vào behavior
```

## Prediction

Trước khi chạy ví dụ, tự trả lời:

1. …
2. …

Viết câu trả lời ra trước khi chạy. Đây là bước dễ bị bỏ nhất và cũng là bước quan trọng nhất.

## Break It

Các cách cố tình làm hệ thống hỏng, và điều bạn quan sát được khi nó hỏng:

| Phá thế nào | Dự đoán quan sát được gì |
|---|---|
| … | … |

## What Usually Goes Wrong

Failure mode phổ biến trong code thật.

## Common Misconceptions

Những điều developer thường tưởng đúng nhưng thực tế sai.

| Tưởng rằng | Thực tế |
|---|---|
| … | … |

## Debugging

Khi lỗi xảy ra, kiểm tra theo thứ tự nào? Đi từ tín hiệu rẻ nhất đến đắt nhất.

1. …
2. …

## Production Considerations

Điều gì thay đổi khi rời khỏi máy local: nhiều instance, độ trễ mạng thật, dữ liệu lớn, người dùng đồng thời, restart, deploy.

## Trade-offs

Không có giải pháp miễn phí. Đổi cái gì lấy cái gì? Khi nào **không** nên dùng?

## Explain Without Notes

3–5 câu hỏi để tự giải thích mà không nhìn tài liệu:

1. …
2. …

## Related

- [Note liên quan](../path/to/note.md) — quan hệ là gì

## Version / Context

Nếu behavior phụ thuộc phiên bản, ghi rõ. Ví dụ: *Next.js 15, App Router*.

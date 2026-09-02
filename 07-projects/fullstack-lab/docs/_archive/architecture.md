# Architecture

> **SUPERSEDED.** File này không còn là contract. Nội dung canonical hiện tại: [cấu trúc repository](../engineering/repository-structure.md) (bao gồm quy tắc quyết định kiến trúc) và [baseline kiến trúc đã phê duyệt](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md); failure experiments đã gộp vào [lộ trình phát hành](../product/delivery-roadmap.md). Giữ lại để tham chiếu lịch sử.

## Current target

```text
Browser
  │ HTTPS/HTTP
  ▼
Next.js web
  │ typed API client
  ▼
NestJS modular monolith
  ├── Auth
  ├── Workspaces
  ├── Projects
  ├── Tasks
  ├── Comments
  └── Activity
        │
        ▼
   PostgreSQL
```

## Module boundary

Mỗi module sở hữu use case, validation và persistence boundary của nó. Module khác giao tiếp qua application interface, không đọc trực tiếp bảng của nhau nếu không có lý do được ghi lại trong ADR.

## Request flow

```text
HTTP request
 → request id / logging
 → authentication
 → authorization
 → validation
 → use case
 → transaction
 → repository
 → response mapping
```

## Decision rules

- Bắt đầu bằng PostgreSQL và modular monolith.
- Chỉ thêm Redis khi có cache behavior hoặc rate-limit experiment cụ thể.
- Chỉ thêm queue khi có công việc async với retry/idempotency cần quan sát.
- Không dùng eventual consistency cho dữ liệu cốt lõi của task nếu chưa nêu rõ UX trade-off.
- Mỗi quyết định khó đảo ngược phải có ADR với điều kiện xem lại.

## Failure experiments

- gửi hai mutation cùng lúc để tái hiện lost update;
- kill API giữa transaction và kiểm tra activity log;
- làm Redis unavailable và quan sát fallback;
- chạy worker lặp cùng một job để kiểm tra idempotency;
- restart container và kiểm tra persistence;
- tạo dữ liệu lớn rồi so sánh query trước/sau index.

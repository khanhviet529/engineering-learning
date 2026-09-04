# ADR-0012: `packages/mock` — mock HTTP dựng từ hợp đồng, dùng chung cho dev và test

**Status:** Proposed

**Date:** 2026-09-04

**Owners:** Chủ dự án phê duyệt; controller thực thi

**Related docs:** [cấu trúc repository](../engineering/repository-structure.md), [kế hoạch triển khai](../implementation-plan.md) (mốc M0.3), [quy ước API](../api/api-conventions.md), [hợp đồng endpoint](../api/endpoint-contracts.md), [chiến lược kiểm thử](../operations/testing-strategy.md)

## Context

[Kế hoạch triển khai](../implementation-plan.md) tách M2, M3 và M4 thành việc chạy song song giữa frontend và backend. Điều đó chỉ đúng nếu frontend có thứ để gọi trước khi backend có endpoint. Mốc M0.3 vì vậy yêu cầu một mock phục vụ đúng schema của `@flowboard/contracts`, và **bắt buộc trả cả nhánh lỗi** — `401`, `403`, `404`, từng loại `409`, và `429` kèm `Retry-After`. Lý do rất cụ thể: nếu mock chỉ biết trả `200` thì frontend sẽ được viết như thể lỗi không tồn tại, và mọi trạng thái UI đã thiết kế sẽ phải làm lại khi backend thật xuất hiện.

Vấn đề là chỗ đặt nó. [Cấu trúc repository](../engineering/repository-structure.md) liệt kê **đúng ba** package — `contracts`, `ui`, `config` — và nói rõ rằng thay đổi package boundary phải có ADR trước khi implementation. Ba chỗ đặt khả dĩ đều có vấn đề:

- Đặt trong `apps/web` thì `apps/api` không dùng lại được cho contract test, và M0.3 phải chờ M0.5 vì lúc này `apps/web` chưa tồn tại.
- Đặt trong `packages/contracts` thì kéo một dependency chỉ phục vụ test vào đúng package mà hợp đồng yêu cầu giữ trung lập, không phụ thuộc runtime nào.
- Đặt trong `scripts/` thì nó không phải workspace package nên không khai báo được dependency lên `@flowboard/contracts`.

Phạm vi áp dụng là toàn bộ giai đoạn phát triển, ở mọi phase. Ngoài scope: mock **không** phải một môi trường staging, không được deploy, và không bao giờ là nguồn quyết định behavior — Markdown vẫn là nguồn đó.

## Decision

Thêm `packages/mock` làm workspace package thứ tư, và cập nhật [cấu trúc repository](../engineering/repository-structure.md) để cây thư mục phản ánh đúng thực tế thay vì để tài liệu lệch khỏi repo.

Ranh giới của nó:

- **Chỉ phụ thuộc `@flowboard/contracts`.** Không phụ thuộc `apps/*`, không phụ thuộc `packages/ui`.
- **Mọi response phải parse được bằng chính schema của contract.** Đây là điều kiện có test cưỡng chế, không phải lời hứa: một mock trả sai shape còn tệ hơn không có mock, vì nó dạy frontend sai một cách tự tin.
- **Không chứa business logic.** Nó trả fixture tất định theo kịch bản được chọn, không tái hiện invariant nghiệp vụ. Quyền, concurrency và idempotency thật vẫn chỉ được chứng minh bằng integration test chạy trên PostgreSQL thật, đúng như [chiến lược kiểm thử](../operations/testing-strategy.md) yêu cầu.
- **`devDependencies` của app, không phải dependency runtime.** Nó không được đi vào bundle production.

Fixture của mock dùng lại đúng bộ fixture chuẩn trong [chiến lược kiểm thử](../operations/testing-strategy.md) — Project B có Owner/Editor/Viewer, một Workspace Admin không có `project_members` row, và User A là Owner của Project A riêng tư — để cùng một tên actor mang cùng một nghĩa ở mọi lớp test.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| **`packages/mock` (được chọn)** | Cả web và API dùng lại; ranh giới rõ; test cưỡng chế được rằng response khớp contract; có ngay ở M0.3 mà không cần chờ app | Thêm một package vào cây, nên cần chính ADR này |
| Mock nằm trong `apps/web` | Không đổi package boundary | `apps/api` không dùng lại được cho contract test; và M0.3 phải chờ M0.5, làm mất chính lý do M0.3 tồn tại |
| Handler nằm trong `packages/contracts` | Không thêm package | Kéo dependency chỉ phục vụ test vào package mà hợp đồng yêu cầu giữ trung lập runtime |
| Không có mock, frontend chờ backend | Không thêm gì | Xoá bỏ khả năng chạy song song ở M2–M4, tức là bỏ đi lý do chính của việc làm hợp đồng trước |

## Consequences

**Tích cực.** M2, M3 và M4 chạy song song thật. Nhánh lỗi được dựng từ đầu chứ không phải chắp vá về sau. Mock và contract không thể trôi khỏi nhau vì test bắt buộc mọi response parse được bằng schema thật.

**Chi phí và rủi ro.** Có thêm một package phải bảo trì; mỗi khi hợp đồng đổi thì mock đổi theo — nhưng test đối chiếu làm việc đó lộ ra ngay thay vì âm thầm. Rủi ro lớn nhất là ai đó nhầm mock với hành vi thật: nó **không** cưỡng chế phân quyền, concurrency hay idempotency, nên một tính năng chỉ chạy đúng trên mock thì chưa được chứng minh gì cả. Định nghĩa done ở mỗi mốc vì vậy vẫn đòi integration test trên PostgreSQL thật.

**Cần cập nhật cùng lúc.** Cây thư mục trong [cấu trúc repository](../engineering/repository-structure.md), bảng ownership của từng workspace, và mục M0.3 trong [kế hoạch triển khai](../implementation-plan.md).

**Không ảnh hưởng** private-project authorization hay ranh giới phase: mock không chạy ở production và không có đường nào để nó cấp quyền cho ai.

## Revisit When

- Backend thật đã phủ hết các endpoint mà mock đang phục vụ ở một mốc: khi đó cân nhắc thu hẹp mock về đúng phần còn thiếu, thay vì giữ hai bản mô tả cùng một endpoint.
- Xuất hiện nhu cầu mock hành vi có trạng thái qua nhiều request (ví dụ để dựng lại một chuỗi conflict): đó là một quyết định khác về phạm vi, cần xem lại ADR này thay vì mở rộng âm thầm.
- Nếu có ai đề nghị deploy mock ra ngoài máy dev hoặc CI, ADR này phải được xem lại trước — đó là thay đổi bản chất, không phải thay đổi quy mô.

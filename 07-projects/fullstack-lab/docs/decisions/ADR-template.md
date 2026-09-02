# ADR-NNNN: <Quyết định ngắn gọn>

**Status:** Proposed

**Date:** YYYY-MM-DD

**Owners:** <vai trò hoặc nhóm chịu trách nhiệm>

**Related docs:** <relative links đến baseline, product, UX, security, data, operations hoặc phase liên quan>

## Context

Mô tả vấn đề, phạm vi, ràng buộc product/permission/data/operation và lý do quyết định này khó đảo ngược. Nêu phase áp dụng và xác nhận điều gì vẫn ngoài scope. Không đưa secret hoặc dữ liệu private vào đây.

## Decision

Nêu lựa chọn được phê duyệt, boundary chính xác, owner thực thi và điều kiện có hiệu lực. Nếu quyết định thay đổi baseline, nói rõ contract nào thay đổi và migration/rollout nào bắt buộc.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| <Phương án được chọn> | <lợi ích liên quan ràng buộc> | <trade-off được chấp nhận> |
| <Phương án thay thế> | <lợi ích> | <rủi ro/lý do không chọn> |
| <Hoãn hoặc giữ nguyên, nếu phù hợp> | <lợi ích> | <hệ quả> |

## Consequences

Liệt kê hệ quả tích cực, chi phí, rủi ro, migration/backfill/rollback hoặc forward-recovery, test, observability, tài liệu/Pencil và vận hành cần cập nhật. Nêu rõ tác động đến private-project authorization và phase boundary nếu có.

## Revisit When

Nêu tín hiệu hoặc mốc cụ thể khiến quyết định cần được xem lại, ví dụ phase mới được mở, giả định chi phí/latency thay đổi, telemetry cho thấy giới hạn không còn đúng, hoặc có yêu cầu product làm thay đổi scope. Khi cần thay thế, tạo ADR mới và đánh dấu ADR này `Superseded`; không sửa lịch sử quyết định đã Accepted.

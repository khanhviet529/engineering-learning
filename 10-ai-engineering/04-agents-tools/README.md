---
level: intermediate
area: ai-engineering
---

# Agents & Tools

Làm sao AI **hành động** — và làm sao nó không làm việc nguy hiểm.

Hai câu định hình cả folder:

> **Model không chạy tool. Nó xin gọi tool. Application quyết định và thực thi.**
>
> **Agent = model + vòng lặp + tool + state + policy.** Không có gì thần bí.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Tool calling](./01-tool-calling.md) | Vòng một lượt tool; vì sao tool hẹp thắng tool rộng |
| 2 | [Tool security](./02-tool-security.md) | Bảy lớp ở tầng thực thi; vì sao prompt không chặn được gì |
| 3 | [Agent loop](./03-agent-loop.md) | Sáu điều kiện dừng; vì sao pipeline cố định thắng agent 80% trường hợp |

Đọc note 2 **trước** khi cho model bất kỳ tool nào có side effect.

## Bốn ý chính

**① Tham số suy ra được từ dữ liệu thật thì đừng để model cung cấp.**

```text
❌ schema: { orderId, userId, amount }
✅ schema: { orderId }
   userId  ← từ session
   amount  ← từ đơn hàng trong DB
```

**② Quy tắc nghiệp vụ ở CODE, không ở prompt.**

```text
❌ system prompt: "Chỉ hoàn tiền cho đơn dưới 500.000đ"
   → người dùng tự nhận là quản lý → model hoàn 12 triệu

✅ if (order.total > cfg.maxAutoRefund) throw new ToolDenied(...)
   → không thể bị thuyết phục
```

**③ Authz phải kiểm cả OBJECT, không chỉ ACTION.** "User có quyền huỷ đơn" ≠ "user được huỷ đơn *này*". Đưa `userId` vào **điều kiện truy vấn**.

**④ Điều kiện dừng quan trọng nhất của agent là "không tiến triển".** `maxSteps` giới hạn thảm hoạ mỗi run; phát hiện lặp chặn được lãng phí hệ thống.

## Phân loại tool theo mức nguy hiểm

Không phải tool nào cũng cần cùng chính sách:

```text
R   đọc, phạm vi user      getMyOrders            → authz + rate limit
R+  đọc, phạm vi rộng      searchAllTickets       → + tenant chặt, + trần kết quả
W   ghi, đảo ngược được    updateMyAddress        → + trần tần suất, + audit
W!  ghi, KHÓ đảo ngược     cancelOrder, sendEmail → + XÁC NHẬN NGƯỜI, + idempotency
$   liên quan tiền         refundOrder            → + hạn mức ở CODE, + phê duyệt
X   không nên tồn tại      runSql, execShell,
                           httpRequest(url tự do) → không cho model
```

`readCalendar` và `deleteCalendarEvent` **không thể** có cùng chính sách chỉ vì chúng nằm cạnh nhau trong danh sách tool.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Database bị khoá bởi query của model | tool quá rộng (`runSqlQuery`) → [2](./02-tool-security.md) |
| Người dùng tác động lên dữ liệu người khác | authz kiểm action không kiểm object → [2](./02-tool-security.md) |
| Model làm việc quy tắc cấm | quy tắc ở prompt → [2](./02-tool-security.md) |
| Số tiền / số lượng sai | tham số đó do model cung cấp → [1](./01-tool-calling.md) |
| `400` từ provider khi có tool | thiếu `tool_result`, hoặc tool message mồ côi → [1](./01-tool-calling.md) |
| Model gọi tool tuần tự dù có thể song song | `tool_result` chia nhiều message → [1](./01-tool-calling.md) |
| Context nổ sau vài lượt có tool | `tool_result` không có trần → [1](./01-tool-calling.md) |
| Model gọi sai tool | mô tả không nói "khi nào KHÔNG dùng" → [1](./01-tool-calling.md) |
| Chi phí khổng lồ, không lỗi nào trong log | agent lặp cùng tool cùng args → [3](./03-agent-loop.md) |
| Mất tiến trình agent khi deploy | state trong RAM → [3](./03-agent-loop.md) |
| Tool có side effect chạy hai lần | thiếu lock cho run; thiếu idempotency → [3](./03-agent-loop.md) |
| `stop_reason` nhiều `MAX_STEPS` | agent thiếu tool, hoặc mô tả không rõ → [3](./03-agent-loop.md) |
| Người dùng xác nhận việc A, việc B xảy ra | preview do model sinh → [2](./02-tool-security.md) |
| Không biết ai đã làm gì | audit nằm trong message → [2](./02-tool-security.md) |
| SSRF qua tool HTTP | blocklist thay vì allowlist → [2](./02-tool-security.md) |

## Agent có phải cái bạn cần?

```text
① MỘT LỜI GỌI       "phân loại ticket này"          → không cần vòng lặp
② PIPELINE CỐ ĐỊNH  "đọc → phân loại → tra → viết"  → BẠN viết các bước
                                                       ← 80% TRƯỜNG HỢP
③ AGENT             "làm gì cần thiết"               → chỉ khi thứ tự
                                                       KHÔNG biết trước
```

Viết được sơ đồ các bước ⇒ **viết code theo sơ đồ đó**. Pipeline cố định rẻ hơn, nhanh hơn, test được, debug được.

## Position

```text
Model  ──"gọi X(args)"──▶  ┌──────────────────────────────┐
                            │ ① allowlist                  │
                            │ ② schema (args là unknown)   │
                            │ ③ identity từ SESSION        │
                            │ ④ authz TRÊN OBJECT          │
                            │ ⑤ policy ở CODE              │
                            │ ⑥ confirmation nếu W!/$      │
                            │ ⑦ audit (bảng riêng)         │
                            └──────────────┬───────────────┘
                                           ▼
Model  ◀──tool_result───────────────  thực thi (có timeout)
```

## Related

- [01-context-and-output/03-structured-output.md](../01-context-and-output/03-structured-output.md) — `args` là `unknown`
- [02-chatbot-web/01-chatbot-architecture.md](../02-chatbot-web/01-chatbot-architecture.md) — trạm ⑪
- [06-safety/](../06-safety/README.md) — vì sao context không đáng tin
- [07-production/07-human-in-the-loop.md](../07-production/07-human-in-the-loop.md) — thiết kế xác nhận
- [05-evaluation/02-rag-and-agent-evaluation.md](../05-evaluation/02-rag-and-agent-evaluation.md) — đo quỹ đạo, `cost per success`
- [Access control](../../05-cross-cutting/security/04-access-control.md)
- [Injection](../../05-cross-cutting/security/02-injection.md) — vì sao tool SQL là ý tồi
- [SSRF & supply chain](../../05-cross-cutting/security/05-ssrf-supply-chain.md)
- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md)
- [Message queues](../../03-database/04-message-queues/README.md) — agent run là job

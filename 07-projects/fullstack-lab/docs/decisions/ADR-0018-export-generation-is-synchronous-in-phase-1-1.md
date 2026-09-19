# ADR-0018: Sinh file export là đồng bộ ở Phase 1.1, và `202` là lời hứa không giữ được

**Status:** Accepted

**Date:** 2026-09-19

**Owners:** Chủ dự án ký; backend thực thi; tôi giữ hợp đồng và tài liệu.

**Related docs:** [ADR-0017](ADR-0017-report-export-file-storage.md) · [endpoint-contracts.md](../api/endpoint-contracts.md) · [progress-export.md](../reporting/progress-export.md) · [query-and-index-policy.md](../data/query-and-index-policy.md) · [implementation-plan.md](../implementation-plan.md)

## Context

Backend dừng ở M6 và nêu một khoảng trống mà **tôi tạo ra**: hợp đồng mô tả `202` cộng một record `requested`, tức một vòng đời **bất đồng bộ**, trong một phase cấm queue và worker. `progress-export.md` viết "Cơ chế generation phải chỉ dùng capability đã được duyệt cho phase này" — tức là chính tài liệu đó cũng hoãn câu hỏi thay vì trả lời nó.

Họ nêu hai đường đi được, và điểm đáng giữ trong báo cáo của họ là cả hai đều **nói sai một điều gì đó**:

- **Render đồng bộ rồi trả DTO đã chụp lúc `requested`.** Lúc client nhận response, file đã tồn tại nhưng response nói `requested`. Một response nói sai về chính nó.
- **Fire-and-forget trong process API.** Giữ được `202 requested` đúng nghĩa, nhưng restart giữa chừng để lại một dòng `requested` **vĩnh viễn** — không có gì tồn tại để lật nó. Đúng như họ viết: "về bản chất là worker không có recovery".

Phương án thứ hai vi phạm thẳng nguyên tắc đã chốt hai lần trong dự án này: một dòng không được nói sai về chính nó. Đó là lý do `expired` không phải một status ([database-design.md](../data/database-design.md)), và là lý do bytes không nằm trên filesystem container ([ADR-0017](ADR-0017-report-export-file-storage.md)).

Nhưng phương án thứ nhất cũng nói sai — chỉ là ở response thay vì ở database. **Nên câu hỏi thật không phải "sinh file bằng cơ chế nào", mà là "vì sao response lại là `202`".**

`202` theo RFC 9110 nghĩa là request đã được nhận **nhưng xử lý chưa xong**. Nếu Phase 1.1 sinh file đồng bộ thì xử lý **đã** xong lúc response rời server, và `202` là một phát biểu sai về hệ thống — sai với mọi người đọc hợp đồng sau này.

Phase áp dụng: **1.1**. Vẫn ngoài scope: queue, worker, retry, delivery.

## Decision

**Sinh file đồng bộ, bên trong chính request `POST`, sau khi transaction claim đã commit. Response là `201`, mang trạng thái **thật** của record tại thời điểm trả về — `ready` hoặc `failed`, không bao giờ là `requested`.**

Bốn ràng buộc:

1. **Hai transaction giữ nguyên, không gộp.** Transaction một: authorize, validate và snapshot filter, insert `report_exports` với `requested`, ghi activity, **commit**. Rồi render, ngoài mọi transaction. Transaction hai: insert bytes, chuyển status, commit. Đây không phải nghi thức — transaction một là **claim**, và nó phải commit trước khi làm việc tốn thời gian, đúng khuôn mẫu idempotency đã dùng ở mọi mutation khác.

2. **`requested` vẫn tồn tại và vẫn có nghĩa.** Nó là trạng thái thật của dòng trong khoảng giữa hai transaction, quan sát được bởi một request `GET` đồng thời. Nó không biến mất khỏi enum, và ở Phase 1.2 nó trở thành trạng thái khởi đầu bình thường.

3. **Client không được rẽ nhánh theo mã trạng thái.** Client đọc `status` trong body. `201` hôm nay và `202` ở Phase 1.2 phải không làm gì hỏng, vì không client nào được phép phụ thuộc vào sự khác biệt đó. Ràng buộc này ghi vào hợp đồng, không phải một lời khuyên.

4. **Render có ngân sách thời gian tường minh.** Vượt ngân sách là `failed`, ghi trong transaction hai, và response vẫn `201`. Không có đường nào để một request treo vô hạn vì một project lớn bất thường.

**Giới hạn được chấp nhận và gọi đúng tên:** process API chết **giữa** hai transaction để lại một dòng `requested` mà không gì lật được. Cửa sổ đó đúng bằng thời gian sinh một file. Không có cách sửa nào ở Phase 1.1 mà không dựng đúng cái worker đang bị cấm. Dòng đó không bao giờ tải được (`409 REPORT_NOT_READY`), nên nó tốn dung lượng chứ không gây hiểu nhầm; người dùng tạo request mới. Phase 1.2 là chỗ nó được dọn.

Chủ dự án đã ký 19/09/2026.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| **Đồng bộ + `201` + trạng thái thật** (chọn) | Không có phát biểu sai nào, ở response lẫn ở database. Không thêm cơ chế. Vòng đời ba trạng thái và ba endpoint giữ nguyên cho Phase 1.2 | Thời gian request bằng thời gian render, nên cần ngân sách. Đổi mã trạng thái ở Phase 1.2 — vô hại **vì** ràng buộc (3), nhưng chỉ vô hại nếu ràng buộc đó được cưỡng chế bằng test |
| Đồng bộ + `202` + DTO chụp lúc `requested` | Hợp đồng không đổi một ký tự | Response nói `requested` trong khi file đã có. Đúng loại lỗi mà `expired`-không-phải-status được dựng ra để chặn, chỉ khác chỗ: ở response thay vì ở dòng database |
| Fire-and-forget trong process API | `202 requested` đúng nghĩa ngay hôm nay | Là một worker không có recovery. Restart để lại dòng `requested` vĩnh viễn. Đây là thêm một thành phần bất đồng bộ **và** bỏ luôn phần khó của nó — tệ hơn cả việc chưa có gì |
| Thêm worker durable ngay ở Phase 1.1 | Giải đúng bài toán | Kéo Redis, BullMQ, `apps/worker`, health, backup, telemetry vào cùng một lượt — đúng định nghĩa của Phase 1.2. Một nút bấm tải file không trả nổi chi phí đó |
| Sinh file trước transaction claim | Không cần hai transaction | Hai request đồng thời cùng key đều render. Idempotency mất ý nghĩa vì không có claim nào được commit trước |

## Consequences

**Được.** M6 hiện thực được mà không thêm thành phần vận hành nào. Không có response hay dòng nào nói sai về chính nó. Hình dạng hợp đồng — ba endpoint, bốn status, hai error code — không đổi khi Phase 1.2 mở.

**Chi phí.** Request `POST` chậm bằng thời gian render. Ở quy mô Phase 1.1 và trần 25 MB của ADR-0017, dự kiến dưới vài giây — **chưa đo**, và đó là một lý do nữa để ngân sách thời gian là tường minh chứ không phải mặc định của framework.

**Test bắt buộc, vì ràng buộc (3) là thứ dễ trôi nhất.** Phải có một bài khẳng định client không rẽ nhánh theo mã trạng thái — nếu chỉ ghi trong tài liệu thì Phase 1.2 sẽ phát hiện nó đã bị vi phạm, vào đúng lúc không sửa rẻ được nữa.

**Cần cập nhật cùng lượt:** `endpoint-contracts.md` (mã trạng thái và ràng buộc (3)), `progress-export.md` (đang mô tả `202` và shape response cũ thiếu ba field nullable — backend phát hiện), và một dòng nợ cho dòng `requested` mồ côi.

## Revisit When

- Phase 1.2 mở: response thành `202`, `requested` thành trạng thái khởi đầu bình thường, và worker nhận phần recovery. ADR này **không** cần Superseded khi đó — nó đã dự liệu chính lần đổi ấy.
- Thời gian render đo được vượt ngân sách ở một project thật, tức quy mô đã ra khỏi giả định "một nút bấm tải file".
- Có yêu cầu product cho gửi export qua email hoặc lên lịch — lúc đó bất đồng bộ là thật, không phải một lời hứa trang trí.

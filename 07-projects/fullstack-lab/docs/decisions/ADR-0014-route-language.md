# ADR-0014: Segment của URL viết bằng tiếng Việt không dấu, query key giữ tiếng Anh

**Status:** Accepted

**Date:** 2026-09-04

**Owners:** Chủ dự án quyết định; frontend thực thi; tài liệu design ghi lại

**Related docs:** [information architecture](../design/information-architecture.md) (bảng route), [danh mục màn hình](../design/screen-inventory.md), [đặc tả tương tác](../design/interaction-specifications.md), [hợp đồng endpoint](../api/endpoint-contracts.md), [kế hoạch triển khai](../implementation-plan.md)

## Context

Quyết định này được ghi lại **sau khi** M2 đã dựng xong, và đó chính là lý do nó cần tồn tại.

`information-architecture.md` công bố route bằng tiếng Anh: `/sign-in`, `/workspaces/:workspaceId`, `/projects/:projectId/settings`. Frontend dựng M2 bằng tiếng Việt: `/dang-nhap`, `/khong-gian-lam-viec/:workspaceId`, `/du-an/:projectId/cai-dat`. Mười ba route, không một cái nào khớp tài liệu.

Đây **không** phải frontend đi lệch hợp đồng. Chính tài liệu đã cho phép: *"Tên thư mục Next.js cụ thể có thể triển khai tương đương, nhưng không đổi ý nghĩa hoặc ID màn hình."* Câu đó biến cột `Route` thành một gợi ý, và một gợi ý thì không ai phải cập nhật.

Sai lệch bị phát hiện khi agent design escalate một chuyện khác: họ vẽ `PRM-01` thành trang con và ghi route `/du-an/:projectId/thanh-vien` lên artifact — path họ đọc được **từ code**. Tôi kiểm và kết luận sai lần đầu, rằng artifact có một route lệch quy ước, vì trong artifact 51/52 chuỗi dạng path là tiếng Anh. Đo lại mới thấy 51 chuỗi đó là **API endpoint** trong sheet tham chiếu REF-16 và ngày tháng, không phải UI route: artifact chưa từng vẽ một UI route nào. Bên lệch là tài liệu, không phải artifact và không phải code.

## Decision

**Segment của path dùng tiếng Việt không dấu.** URL là chữ người dùng đọc, gõ, và dán cho nhau — cùng một loại bề mặt với nhãn nav và tiêu đề màn hình, và cùng một lý do khiến toàn bộ UI của Flowboard là tiếng Việt.

**Query key giữ tiếng Anh** (`task`, `panel`, `limit`, `cursor`). Chúng là tham số kỹ thuật, đi cùng hợp đồng API chứ không cùng UI, và người dùng không đọc chúng.

**API path giữ tiếng Anh** (`POST /workspaces/:workspaceId/members`). Chúng là hợp đồng giữa hai chương trình. Không có gì mâu thuẫn khi `/khong-gian-lam-viec/:id/thanh-vien` gọi `GET /workspaces/:id/members`: một cái là bề mặt người dùng, cái kia là giao diện máy.

**Screen ID vẫn là khóa bền vững** và vẫn tiếng Anh (`WSP-03`, `PRM-01`). Route đổi được mà ID không đổi.

**`information-architecture.md` là nơi công bố route, và nó ghi đúng path người dùng thấy.** Câu cho phép "triển khai tương đương" bị xoá. Bảng route thêm cột `Trạng thái` phân biệt route đã dựng với route dự kiến, và route của M3/M4/M5 được đặt tên **trước** ở đó.

## Consequences

Điều đắt nhất không phải chọn thứ tiếng nào — mà là mất nơi công bố. Trong suốt M2, path thật chỉ tồn tại dưới dạng tên thư mục. Không tài liệu nào ghi chúng, nên không ai đối chiếu được, và một agent design đọc code thay vì đọc hợp đồng là hệ quả tự nhiên chứ không phải lỗi của họ. Đặt tên trước cho route M3–M5 là để lần sau không phải phát hiện muộn như vậy.

Cái giá của phương án này: URL không khớp API path, nên khi đọc log hay debug phải dịch một bước trong đầu (`/du-an/...` ↔ `/projects/...`). Đây là cái giá có thật và đã được cân nhắc; nó rơi vào người phát triển, còn phương án ngược lại đẩy cái giá sang người dùng.

Đã bác bỏ — **đổi 13 route sang tiếng Anh**: khiến URL, API path và Screen ID cùng một thứ tiếng, và loại luôn bước dịch khi debug. Bác bỏ vì nó đẩy chữ tiếng Anh vào bề mặt duy nhất mà người dùng phải tự tay gõ, để đổi lấy sự tiện lợi của người phát triển; và vì không có dòng hợp đồng nào bị vi phạm để biện minh cho việc đổi tên 13 thư mục đã có test xanh.

Không bị ảnh hưởng: hợp đồng endpoint, mô hình phân quyền, tên bảng và cột database, error code, Screen ID.

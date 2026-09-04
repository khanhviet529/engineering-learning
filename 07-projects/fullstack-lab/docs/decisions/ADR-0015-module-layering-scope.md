# ADR-0015: Tầng trong module `apps/api` được dựng theo việc nó phải làm, không theo quy tắc đồng loạt

**Status:** Accepted

**Date:** 2026-09-04

**Owners:** Chủ dự án phê duyệt; backend thực thi; review cưỡng chế

**Related docs:** [quy ước backend](../engineering/backend-conventions.md) (đồ thị phụ thuộc và cơ chế từng tầng), [ADR-0005](ADR-0005-module-dependency-and-activity-boundary.md), [ADR-0004](ADR-0004-drizzle-orm.md), [kế hoạch triển khai](../implementation-plan.md)

## Context

`apps/api` chia mỗi module thành `presentation / application / domain / infrastructure`. [Quy ước backend](../engineering/backend-conventions.md) mô tả **cơ chế** của cách chia đó rất kỹ — chiều import, đồ thị acyclic, tầng nào biết gì. Nhưng không tài liệu nào ghi **vì sao** chọn nó thay vì `Controller → Service → Repository`, tức là layout mặc định của NestJS.

Khoảng trống đó có giá thật. Một bản review kiến trúc từ ngoài đã đề xuất `Controller → Service → Repository` và cảnh báo *"không nên áp Clean Architecture quá sớm"*. Cảnh báo đó **đúng như một quy tắc chung**, và không có gì trong repo để trả lời nó bằng — nên câu hỏi sẽ được hỏi lại, và lần sau người trả lời có thể không biết bốn cơ chế bên dưới đang phụ thuộc vào cách chia tầng.

Bản thân cách chia tầng được chọn ở M0 mà không có ADR. Đó là chỗ thiếu thật sự: nó là một quyết định kiến trúc có hệ quả trên mọi module, và nó chỉ tồn tại dưới dạng một hình vẽ trong tài liệu quy ước.

## Decision

**Giữ bốn tầng, nhưng lý do chính đáng là những gì chúng đang gánh, không phải bản thân việc phân tầng.** Bốn cơ chế dưới đây tồn tại được **chỉ vì** có tầng `domain` tách khỏi `infrastructure`, và mỗi cái đều là một ràng buộc thật của sản phẩm:

| Cơ chế | Nó giải quyết gì | Không có tầng thì thành gì |
|---|---|---|
| `ColumnEmptinessCheck` | Use case archive của `board-columns` phải biết cột còn task hay không, mà `tasks` **chưa tồn tại** ở mốc đó và module `board-columns` không được import nó | Import chéo `board-columns → tasks`, hoặc một `forwardRef` che cycle — đúng thứ [ADR-0005](ADR-0005-module-dependency-and-activity-boundary.md) cấm |
| `ProjectAssigneeCheck` | Bất biến "không gỡ member đang giữ việc" nằm trong hợp đồng từ M2, nhưng bảng `tasks` chỉ có ở M4 | Bất biến không kiểm được cho tới M4; M2 đóng với một luật chưa ai chứng minh |
| `ActivityRecorder` | `activity_logs` phải có **đúng một** nơi ghi, và mọi row phải nằm trong transaction của mutation mô tả nó | Mỗi module tự insert; một lịch sử có thể mâu thuẫn với dữ liệu mà không ai phát hiện |
| `WorkspaceMembershipPort` | `projects` cần biết target có là workspace member không, mà không được đọc bảng của `workspaces` | Repository của module này đọc table của module kia; ranh giới sở hữu dữ liệu mất |

Ba trong bốn cái là **port có adapter đến ở một mốc sau**. Đó là tính chất quyết định: một port cho phép viết và kiểm luật ở mốc này trong khi thứ hiện thực nó còn chưa tồn tại. `Controller → Service → Repository` không có chỗ nào để đặt một interface như vậy mà không biến nó thành import chéo.

**Và tầng chỉ được dựng khi có việc.** Module `activity` hiện có **đúng hai** thư mục — `domain` và `infrastructure` — vì nó không có endpoint và không có use case: nó là một port cộng một repository. Không tạo `presentation/` và `application/` rỗng cho nó. Đây là phần dễ làm sai nhất của quyết định này: dựng bốn thư mục ở mọi nơi vì "cho đồng bộ" biến cách chia tầng thành nghi thức, và nghi thức dạy người đọc rằng khuôn mẫu này tuỳ tiện — sau đó họ thôi tin cả những chỗ nó đang gánh việc thật.

**Phép thử để một module được dùng ít tầng hơn.** Module nào **không** có cả ba điều sau thì không cần `application` tách khỏi `presentation`, và phải ghi một dòng nói vì sao:

1. một phụ thuộc mà nó **không được import** (cross-module port),
2. một bất biến cần kiểm **trước khi** thứ hiện thực nó tồn tại,
3. một quyết định authorization nào ngoài guard chuẩn.

Cảnh báo "đừng áp Clean Architecture quá sớm" vì vậy được **chấp nhận, không bị bác**. Nó chỉ không áp cho các module hiện có, vì mỗi module hiện có mang ít nhất một trong ba điều trên.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Bốn tầng, dựng theo việc (chọn) | Bốn port ở trên có nhà; luật kiểm được trước khi adapter tồn tại; ranh giới sở hữu dữ liệu cưỡng chế được bằng chiều import | Nhiều file hơn; một request đi qua bốn thư mục; đòi phán đoán ở mỗi module mới thay vì một quy tắc máy móc |
| `Controller → Service → Repository` (mặc định NestJS) | Ít file, đọc một mạch, đúng cho CRUD | Không có chỗ đặt port cross-module: `ColumnEmptinessCheck` thành import chéo hoặc `forwardRef` cycle. Ba bất biến hiện đang được kiểm sớm sẽ phải hoãn tới khi bảng của module kia tồn tại. `activity_logs` mất tính một-nơi-ghi |
| Bốn tầng ở **mọi** module không trừ ai | Đồng bộ tuyệt đối, không phải phán đoán | `activity` sẽ có hai thư mục rỗng. Nghi thức trên module không cần làm cả khuôn mẫu mất uy tín ở chỗ nó cần |
| Clean Architecture đầy đủ (entity, use-case interactor, DTO mapper mỗi chiều) | Tách tuyệt đối khỏi framework | Cái giá không mua được gì ở đây: chỉ có một transport (REST), một database (PostgreSQL theo [ADR-0004](ADR-0004-drizzle-orm.md)), và không có kế hoạch đổi cả hai. Mapper hai chiều cho mọi biên là chi phí thường trực để đổi lấy một khả năng chưa ai yêu cầu |

## Consequences

Cái giá là thật và không nên nói giảm: một người mới đọc bốn thư mục để lần theo một request, và số file nhiều hơn `Controller → Service → Repository` khoảng gấp đôi cho cùng một endpoint. [Quy ước backend](../engineering/backend-conventions.md) giữ đồ thị phụ thuộc để việc lần theo đó có bản đồ, nhưng bản đồ không làm đường ngắn lại.

Đổi lại, có một thứ đo được: **ba bất biến đang được kiểm ở mốc sớm hơn mốc tạo ra bảng mà chúng nói về.** M2 chứng minh được "không gỡ member đang giữ việc" bằng một adapter điều khiển được, trong khi `tasks` còn chưa tồn tại. Khi M4 đến, việc phải làm là thay adapter — không phải viết lại luật rồi hy vọng nó khớp với thứ M2 đã công bố.

Hệ quả cho review: một module mới dựng bốn tầng **mà không có** một trong ba điều ở phép thử là chỗ reviewer phải hỏi, và câu trả lời "cho đồng bộ" không được chấp nhận. Ngược lại, một module dùng ít tầng hơn phải mang một dòng nói vì sao — như `activity` đang làm.

Không bị ảnh hưởng: hợp đồng endpoint, mô hình phân quyền, schema database, `packages/contracts`. Cách chia tầng là chuyện bên trong `apps/api`; không có gì ngoài nó nhìn thấy.

## Revisit When

- Một module mới không có phụ thuộc nào phải đi qua port, không có bất biến nào cần kiểm sớm, và không có quyết định authorization riêng — khi đó nó dùng ba tầng, và ADR này là chỗ ghi lại tiền lệ đó.
- Số port cross-module **không tăng** qua hai mốc liên tiếp: dấu hiệu rằng tầng `domain` đang giữ interface vì thói quen chứ không vì ràng buộc, và phép thử ở trên cần siết lại.
- Xuất hiện transport thứ hai (GraphQL, gRPC, message consumer) hoặc datastore thứ hai: khi đó `presentation` tách khỏi `application` chuyển từ "có ích" sang "bắt buộc", và ADR này cần nói mạnh hơn thay vì mềm hơn.
- Ai đó đề xuất `Controller → Service → Repository` lần nữa: đọc lại bảng bốn cơ chế ở mục Decision trước khi trả lời. Nếu bốn cơ chế đó đã biến mất khỏi code thì đề xuất kia **đúng**, và ADR này phải bị thay thế chứ không bảo vệ.

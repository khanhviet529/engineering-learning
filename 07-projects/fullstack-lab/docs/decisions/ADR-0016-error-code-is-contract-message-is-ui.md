# ADR-0016: `code` là hợp đồng, `message` là chẩn đoán, và chữ cho người dùng thuộc frontend

**Status:** Accepted

**Date:** 2026-09-05

**Owners:** Chủ dự án quyết định; backend trả `code` và `details`; frontend sở hữu chữ hiển thị

**Related docs:** [hợp đồng endpoint](../api/endpoint-contracts.md), [quy ước API](../api/api-conventions.md), [quy ước frontend](../engineering/frontend-conventions.md), [danh mục màn hình](../design/screen-inventory.md), [kế hoạch triển khai](../implementation-plan.md)

## Context

Danh mục error code là đóng và được cưỡng chế hai chiều giữa tài liệu và enum — 28 code, cộng `ERROR_STATUS`. Phần đó đã ổn định từ M2.

Chữ **hiển thị** thì chưa có chủ. Đo trên cây ở ngày viết ADR này: **18 chỗ trong `apps/web` render thẳng `failure.message` của server vào JSX**, rải trong 16 file, gồm cả `features/tasks/task-form.tsx` đang được dựng ở M4. Không tài liệu nào nói ai viết chữ đó, và không có chỗ nào rà được toàn bộ giọng văn của sản phẩm.

Hệ quả đã thấy: cùng một code cho hai chữ khác nhau ở hai màn mà không ai đối chiếu được, và `VALIDATION_FAILED` xuất hiện ở tám file — mỗi chỗ tự quyết nói gì.

Điều khiến chuyện này phải quyết bây giờ chứ không phải sau: M4 là mốc sinh ra nhiều chữ lỗi nhất trong tất cả các mốc — `TASK_VERSION_CONFLICT`, `SYS-04` conflict, validation của comment, reviewer, date range. Quyết sau M4 nghĩa là sửa lại toàn bộ chúng.

## Decision

**Backend trả *điều gì đã xảy ra*. Frontend quyết định *nói điều đó với người dùng thế nào*.**

**1. `code` là hợp đồng.** Mọi phân nhánh logic của client dựa trên `error.code`. Không bao giờ dựa trên `error.message`:

```ts
if (error.code === "TASK_NOT_FOUND") { … }   // đúng
if (error.message === "Task not found") { … } // cấm
```

`message` là chuỗi tự do và sẽ đổi khi ai đó viết lại một câu; `code` là thứ hai bên đã thoả thuận.

**2. `message` là *chẩn đoán*, không phải chữ cho người dùng.** Nó dành cho log, cho `requestId` khi truy vết sự cố, và cho `Error.message` trong stack trace — `ApiError extends Error` gọi `super(failure.message)` là dùng đúng vai. **Frontend không render `message` cho người dùng thấy**, trừ ngoại lệ ở mục 4.

**3. Dữ liệu động đi trong `details`, không đi trong văn xuôi.** Đây là chỗ ADR này chặt hơn nguyên tắc "server trả message khi nội dung là dữ liệu nghiệp vụ động": nếu số version nằm trong câu chữ thì frontend buộc phải **đọc văn xuôi để lấy dữ liệu**, tức là vẫn phụ thuộc chuỗi, chỉ ở dạng khó thấy hơn.

Envelope đã làm đúng cho hai code, và `.refine()` chặn `details` cho mọi code khác:

| Code | `details` |
|---|---|
| `VALIDATION_FAILED` | `[{ field, code, message }]` |
| `TASK_VERSION_CONFLICT` | `{ currentVersion }` |

Ca mới cần dữ liệu động thì **mở `details` với shape khai báo tường minh** và cập nhật `.refine()` — có chủ đích, có review. Không thêm văn xuôi. `details` **không** trở thành ngăn đựng đồ tạp: mỗi shape thuộc đúng một code.

**4. Danh sách ngoại lệ, đóng và đếm được.** Frontend được phép hiển thị `message` của server ở **đúng một** chỗ hôm nay:

| Code | Route | Vì sao |
|---|---|---|
| `FORBIDDEN` | `POST /invitations/accept` khi email của actor **không khớp** email được mời | Đây là ngoại lệ duy nhất trong hợp đồng nơi câu trả lời cố tình **không** mơ hồ: actor đang giữ token từ hộp thư đó nên đã biết địa chỉ, và nói mơ hồ chỉ làm họ không biết phải đăng nhập bằng tài khoản nào |

Một ngoại lệ có tên thì đếm được và kiểm được. "Server message khi cần" thì không — đó là lý do bảng này thay cho một quy tắc mềm. Thêm dòng vào bảng là một sửa đổi ADR, không phải một lựa chọn lúc code.

**5. Cùng một `code` được nói khác nhau ở các màn khác nhau, và đó là chủ đích.** `NOT_FOUND` trên board và `NOT_FOUND` khi mở một lời mời phải nói hai điều khác nhau, vì chỉ frontend biết người dùng đang ở đâu và đang cố làm gì. Server không có thông tin đó và không nên đoán.

**6. Chữ sống cạnh feature, mỗi feature một module** (`features/x/messages.ts`). **Không** gom vào một catalogue theo `code`: một map `code → chữ` không diễn đạt được sự phụ thuộc ngữ cảnh ở mục 5, nên nó sẽ hoặc sai, hoặc bị vòng qua. Mục tiêu của việc gom theo feature là **rà được**: đọc mười file thay vì grep mười sáu component khi cần soát lại giọng văn tiếng Việt của sản phẩm.

**7. Một guard đọc thực tại.** Một bộ kiểm quét `apps/web/src` và chặn `failure.message` lọt vào JSX, trừ danh sách ngoại lệ ở mục 4 — cùng lối `no-hardcoded-colors.test.ts` quét màu ghi cứng, và `web-routes.test.ts` đọc `src/app` trên đĩa. Quy tắc chỉ nằm trong tài liệu thì không chặn được ai; ba mốc vừa rồi đã chứng minh điều đó nhiều lần.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| `code` là hợp đồng, `message` là chẩn đoán, chữ ở frontend (chọn) | Chữ khớp ngữ cảnh màn hình; đổi giọng văn không cần deploy backend; i18n về sau chỉ chạm frontend; server không phải đoán người dùng đang ở đâu | Frontend phải viết chữ cho mọi code nó xử lý; 18 chỗ hiện tại phải sửa |
| Server trả chữ cho người dùng, frontend hiển thị nguyên văn (thực hành hiện tại) | Ít việc cho frontend; một chỗ sửa chữ | Cùng một chữ cho mọi ngữ cảnh, nên nó phải chung chung để không sai chỗ nào — và chữ chung chung không giúp được ai. Đổi một câu là deploy backend. i18n phải làm ở server, nơi không biết locale của người xem trừ khi ta thêm một kênh nữa. Và nó khuyến khích chính thứ mục 1 cấm: khi chữ đã là hợp đồng thì sớm muộn có người so chuỗi |
| Catalogue trung tâm `code → chữ` ở frontend | Rà một chỗ; không trùng lặp | Không diễn đạt được mục 5. Cùng `NOT_FOUND` cần hai câu khác nhau, nên catalogue phải có khoá phức hợp `code × màn` — tức là chính cách gom theo feature, chỉ viết ngược và xa chỗ dùng |
| Mở `details` tổng quát cho mọi code | Không bao giờ cần văn xuôi | Chưa đáng: đếm được **đúng một** ca hôm nay cần dữ liệu động ngoài hai shape đã có. `.refine()` đóng là thứ giữ `details` khỏi thành ngăn đồ tạp, và mở nó trước khi có nhu cầu là mất tính chất đó để đổi lấy một khả năng chưa ai yêu cầu |

## Consequences

**Nợ phải trả, và nó có thật.** 18 chỗ trong 16 file đang render `failure.message` vào JSX — bao gồm `features/auth/*` (5 file), `features/board/column-editor.tsx` (3 chỗ), `features/members/*`, `features/workspaces/*`, và `features/tasks/task-form.tsx`. ADR này `Accepted` nghĩa là code hiện tại **không tuân thủ**, và điều đó được ghi vào bảng nợ chứ không nói giảm.

Việc trả nợ **để M5**, không phải M4: frontend đang giữa mốc lớn nhất, và đổi 16 file lúc này là xung đột chắc chắn với việc đang chạy. Guard ở mục 7 vì vậy cũng dựng ở M5 — dựng trước khi trả nợ thì nó đỏ 18 lần và bị tắt, và một guard bị tắt thì không bảo vệ gì.

**Cái giá đã cân nhắc:** frontend phải viết chữ cho mọi code nó xử lý, và một code mới sinh ra việc ở hai lane thay vì một. Đổi lại, chữ nói đúng ngữ cảnh, đổi giọng văn không cần deploy backend, và nếu sau này cần thêm ngôn ngữ thì toàn bộ việc nằm ở nơi biết locale của người xem.

**Không bị ảnh hưởng:** danh mục 28 error code, `ERROR_STATUS`, hai shape `details` hiện có, mô hình phân quyền, `requestId`. Backend vẫn trả `message` như hôm nay — nó chỉ đổi vai từ "chữ cho người dùng" sang "chẩn đoán", và không endpoint nào phải sửa vì việc đó.

## Revisit When

- Danh sách ngoại lệ ở mục 4 dài quá **ba** dòng: dấu hiệu rằng ranh giới đang bị đẩy dần, và phải chuyển sang mở `details` theo code thay vì tiếp tục thêm ngoại lệ văn xuôi.
- Có yêu cầu đa ngôn ngữ thật: khi đó mục 6 cần thêm một tầng khoá (locale), và cách gom theo feature phải được xem lại xem còn là chỗ đúng để giữ chuỗi hay không.
- Xuất hiện một client thứ hai không phải web (mobile app, CLI): lúc đó "chữ thuộc frontend" nghĩa là mỗi client tự viết, và cần quyết định lại xem có nên có một tầng chia sẻ chuỗi hay không — nhưng vẫn **không** đưa nó về server.
- Guard ở mục 7 phải tắt hoặc phải thêm ngoại lệ quá hai lần trong một mốc: quy tắc đang sai chỗ nào đó, và ADR này phải đọc lại chứ không phải guard bị nới.

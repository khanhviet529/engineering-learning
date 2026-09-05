# Chín lỗi thật, và cổng nào đã im lặng

Tài liệu này không phải nhật ký. Nó ghi chín lỗi **thật sự đã xảy ra** khi dựng Flowboard, mỗi lỗi kèm câu hỏi quan trọng hơn bản thân lỗi: **cổng nào bắt được, và cổng nào chạy mà không thấy gì.**

Vì sao câu thứ hai mới là bài học. Biết một lỗi thì sửa được **một** lỗi. Biết rằng 1.347 test xanh trong lúc lỗi đó tồn tại thì biết được **cả một lớp lỗi mà kiểu test ấy không với tới** — và đó mới là thứ làm người ta đổi cách làm.

Mỗi mục có sáu phần: triệu chứng · vì sao xảy ra · ai hay mắc · vì sao cổng cũ im lặng · các giải pháp · chọn gì **cho dự án này** và vì sao. Phần cuối quan trọng: cùng một lỗi có lời giải tốt nhất khác nhau tuỳ ràng buộc, và một tài liệu chỉ nói "cách đúng" mà không nói "đúng với điều kiện nào" là một tài liệu sẽ bị áp sai chỗ.

## Luận điểm rút ra từ cả chín

| Lỗi | Cổng bắt | Cổng im lặng |
|---|---|---|
| Đếm `n.styles` — field không tồn tại | agent design phản biện | bộ đếm của người review |
| 28 ref ẩn trong `descendants` | agent design phản biện | cùng bộ đếm đó, **hai lần** |
| `.omit()` trên schema có `.refine()` | `next build` | `tsc`, test của chính package |
| `useSearchParams` thiếu Suspense | `next build` | format, lint, typecheck, 367 test |
| Thư mời trỏ route không tồn tại | đọc mailer **tình cờ** | 954 test, cả hai lane |
| CORS chặn `PATCH`/`DELETE` | E2E qua **socket thật** | 1.347 test |
| `exposedHeaders` thiếu | người review, lúc kiểm báo cáo CORS | **chính E2E** |
| Tiền đề rotate secret sai | backend **đọc code** | người viết yêu cầu |
| `dueStates` thiếu một khoá | test ghim của backend | **tổng vẫn khớp** |
| Màu đã sửa chưa bao giờ tới ứng dụng | CI, **lượt chạy đầu tiên** | freeze design, review của tôi, 1.377 test |
| `dist` thiếu trên runner sạch | cùng lượt chạy đó | mọi máy dev, vì `dist` **còn sót lại** |

> **Mọi cổng bắt được lỗi đều là cổng chạy thứ thật. Mọi cổng im lặng đều là cổng kiểm một *mô hình* của thứ thật.**

`inject()` bỏ qua tầng HTTP. jsdom stub `fetch`. `tsc` không evaluate module. Contract test so **hình dạng**, không so **hành vi**. Một bộ đếm đọc field không tồn tại thì luôn trả `0` — và `0` trông y hệt một kết quả tốt.

---

## 1. CORS chặn `PATCH` và `DELETE`

**Triệu chứng.** Mọi lệnh sửa và xoá chết trong browser. Server **không thấy gì** — log trống. Client chỉ nhận một `TypeError` của `fetch`.

**Vì sao xảy ra.** `app.enableCors({ origin, credentials })` không truyền `methods`. Adapter Fastify uỷ quyền cho `@fastify/cors`, mặc định `GET,HEAD,POST` — **khác** mặc định của Nest/Express mà hầu hết ví dụ trên mạng đang dùng. Bảy endpoint đã công bố không gọi được: bốn `PATCH`, ba `DELETE`.

**Ai hay mắc.** Bất kỳ ai đổi Express sang Fastify, hoặc đọc tài liệu Nest rồi dùng adapter khác. Lời gọi API y hệt nhau; chỉ mặc định của thư viện bên dưới đổi.

**Vì sao cổng cũ im lặng.** Test API gọi `inject()` — vào thẳng Fastify, **không qua HTTP**, nên không có preflight nào. Test web chạy jsdom với `fetch` bị stub, cũng không có preflight. Lỗi sống đúng ở khe giữa hai lane, nơi không bộ test nào của bên nào đi qua.

| Giải pháp | Được | Mất |
|---|---|---|
| `methods: "*"` | một dòng | **Không hợp lệ** khi `credentials: true` |
| Liệt kê đúng method hợp đồng công bố | Khớp hợp đồng; method lạ bị chặn | Thêm method mới phải nhớ sửa hai chỗ |
| Đặt API sau proxy cùng origin | Không còn CORS | Đổi topology; mất ranh giới `web`/`api` |

**Chọn: liệt kê tường minh.** Hợp đồng endpoint đã công bố một danh sách chính xác, nên danh sách CORS chỉ là bản chiếu của nó — và một method không có trong hợp đồng thì cũng không nên qua được CORS. Proxy cùng origin tốt hơn cho triển khai lớn, nhưng ở đây nó xoá mất ranh giới hai service mà toàn bộ kiến trúc đang dựa vào.

**Ngăn tái phát.** Một test đi qua **socket thật** (`app.listen()` rồi `fetch` một `OPTIONS`), lặp qua **chính** danh sách method của hợp đồng. Test viết bằng `inject()` sẽ **xanh cả khi lỗi còn nguyên** — nó bỏ qua đúng lớp đang hỏng.

## 2. `exposedHeaders` thiếu — `requestId` luôn là `unknown`

**Triệu chứng.** Thông báo lỗi trên giao diện luôn kết bằng `Mã tra cứu: unknown`. Client không bao giờ tôn trọng được `Retry-After` của `429` hay của `409 IDEMPOTENCY_IN_PROGRESS`.

**Vì sao xảy ra.** Cùng một dòng `enableCors`. `exposedHeaders` cũng mặc định `null`, nên browser chỉ cho JavaScript đọc **6 header safelisted**. Server *có* gửi `x-request-id`; browser *không* cho đọc.

**Ai hay mắc.** Ai dùng custom header để truy vết. Nó âm thầm tuyệt đối: `curl` thấy header, DevTools tab Network cũng thấy header, chỉ `response.headers.get()` trả `null`.

**Vì sao cổng cũ im lặng.** **Kể cả E2E cũng không bắt được** — nó khẳng định giao diện hiện đúng màn hình, mà màn hình vẫn đúng khi mã tra cứu là `unknown`. Lỗi này tìm ra khi người review đọc *báo cáo* của E2E và tự chạy `curl` để kiểm một claim khác.

| Giải pháp | Được | Mất |
|---|---|---|
| Bỏ custom header, nhét `requestId` vào body | Không cần CORS gì | `requestId` biến mất ở lỗi mạng — đúng lúc cần nhất |
| Khai `exposedHeaders` | Giữ được cả hai kênh | Phải nhớ khi thêm header mới |

**Chọn: khai `exposedHeaders`.** `requestId` phải đọc được **cả khi body không parse được**, nên nó phải ở header. Và `Retry-After` là header chuẩn — chuyển nó vào body là tự chế lại một thứ HTTP đã có.

**Bài học chung với mục 1.** Hai lỗi, một dòng code, hai mặc định thư viện. Khi một hàm nhận object cấu hình, **thứ không truyền cũng là một quyết định** — chỉ là quyết định do người viết thư viện đưa ra thay bạn.

## 3. Thư mời trỏ tới một route không tồn tại

**Triệu chứng.** Mọi người được mời bấm link trong thư và nhận `404`. Tính năng không có đường vào nào.

**Vì sao xảy ra.** Backend dựng link `/loi-moi`; frontend dựng route `/loi-moi/chap-nhan`. Mỗi bên đúng theo hợp đồng **mà bên đó đọc**.

**Ai hay mắc.** Mọi dự án có hai lane song song và một giá trị đi qua giữa: đường dẫn trong email, tên webhook, khoá cache, tên sự kiện analytics.

**Vì sao cổng cũ im lặng.** 954 test xanh, và **cả hai bên đều xanh một cách đúng đắn**: test backend lấy token **ra khỏi** Mailpit rồi gọi API trực tiếp; test frontend render component với `token` truyền vào và tự đặt `window.location`. Không bên nào nhìn vào chính cái path trong thư. Nó bị bắt vì người review **tình cờ** đọc mailer khi đang kiểm việc khác.

| Giải pháp | Được | Mất |
|---|---|---|
| Test so hằng số của hai bên với nhau | Rẻ | Chỉ chứng minh **hai chuỗi giống nhau**, không chứng minh route tồn tại |
| Một nguồn dùng chung + guard đọc đĩa | Không thể lệch | Thêm một package phụ thuộc |
| E2E mở mọi link trong mọi thư | Bắt được cả lỗi khác | Cần hạ tầng |

**Chọn: cả hai cái sau.** Path sống ở `packages/contracts` (`WEB_ROUTES`), và một test đọc `src/app` **trên đĩa** khẳng định mỗi path có `page.tsx` thật. Đặt lại hằng số về giá trị cũ thì test đỏ kèm tên file còn thiếu — đã thử. E2E sau đó thêm một vòng lặp mười dòng mở mọi link trong mọi thư.

**Bài học.** Guard phải đọc **thực tại**, không đọc một hằng số khác. Xem commit `630b872`.

## 4. `.omit()` trên schema có `.refine()` — chỉ `build` thấy

**Triệu chứng.** `next build` dừng ở bước export với `Error: .omit() cannot be used on object schemas containing refinements`.

**Vì sao xảy ra.** Zod từ chối `.omit()` khi schema đã có `.refine()`, và nó **ném lúc evaluate module** — không phải lúc gọi.

**Ai hay mắc.** Ai tái dùng schema bằng `.omit()`/`.pick()`/`.partial()` sau khi đã thêm ràng buộc chéo field.

**Vì sao cổng cũ im lặng.** `tsc` **không chạy** module nên không thấy. 18 test của chính package không import tới đường đó nên cũng không. Cổng duy nhất bắt được là cổng duy nhất **thật sự chạy** code: `next build`.

| Giải pháp | Được | Mất |
|---|---|---|
| Bỏ `.refine()`, validate ở use case | `.omit()` dùng được | Ràng buộc rời khỏi schema — hai nơi kiểm một luật |
| Tách phần field ra một object dùng chung | Cả hai schema `.extend` từ một nguồn | Thêm một tầng gián tiếp |

**Chọn: tách field dùng chung.** Ràng buộc ở lại schema, hai phạm vi khai `.refine()` riêng — vì luật thật sự khác nhau: sort theo `position` cần `columnId` ở cấp project, và **vô nghĩa** ở cấp workspace.

**Bài học.** Một cổng chỉ bắt được lỗi ở tầng nó chạm tới. `tsc` kiểm kiểu, không kiểm việc module có nạp được không. Xem `0674b3d`.

## 5. `useSearchParams` thiếu Suspense — lại chỉ `build` thấy

**Triệu chứng.** `next build` dừng: *"useSearchParams() should be wrapped in a suspense boundary"*.

**Vì sao xảy ra.** Một client component đọc query param trên route được prerender tĩnh.

**Ai hay mắc.** Mọi dự án Next App Router có state nằm ở URL.

**Vì sao cổng cũ im lặng.** Cổng ra mà lane đó tự đặt gồm **format, lint, typecheck và test** — **không có `build`**. Ba trong bốn cổng không evaluate module. Đây là lần **thứ hai liên tiếp** một lỗi chỉ lộ ở `build`, sau mục 4.

| Giải pháp | Được | Mất |
|---|---|---|
| Bọc `<Suspense>` | Một dòng, Next khuyến nghị | Có một khoảnh khắc bailout trước hydrate |
| Đọc `searchParams` ở server rồi truyền xuống | Không bailout | Chỉ hợp khi component **chỉ đọc**, không ghi lại URL |

**Chọn: tuỳ component.** Màn chấp nhận lời mời **chỉ đọc** `?token=` nên nhận `searchParams` từ server. Màn "việc của tôi" **đọc và ghi** `?workspace=` nên state đó thuộc client, và Suspense là ranh giới đúng.

**Bài học.** Danh sách cổng phải gồm `build`. Hai lỗi liên tiếp cùng hình dạng — **chỉ tồn tại khi module thật sự chạy** — là đủ để coi đó là quy tắc, không phải trùng hợp.

## 6. Đếm một field không tồn tại

**Triệu chứng.** Báo cáo đo artifact thiết kế: `0 hardcoded hex`, `31 biến chết`. Cả hai sai. Thật ra 112 hex và chỉ 9 biến chết.

**Vì sao xảy ra.** Bộ đếm đọc `n.styles`. Trong định dạng đó **không có** `n.styles` — thuộc tính style nằm thẳng trên node. `undefined` ở mọi node nên mọi phép đếm trả `0`.

**Ai hay mắc.** Ai viết script phân tích trên một định dạng chưa đọc schema. Ngôn ngữ động không báo lỗi khi đọc một field không tồn tại.

**Vì sao cổng cũ im lặng.** Không có cổng nào — đây là script phân tích, không phải code sản phẩm. Tệ hơn: **hai bên cùng dùng một lens sai**, nên hai báo cáo **khớp số chính xác** và sự trùng khớp đó tạo ra niềm tin sai. Nó bị bắt vì agent design đọc lại schema khi được lệnh xoá 31 biến.

**Chọn: viết xuống, không chỉ sửa.** Bốn bẫy đo đi vào [pencil-measurement.md](../design/pencil-measurement.md), mỗi cái kèm đoạn JS chạy được và **con số sai nó từng sinh ra**.

**Bài học.** `0` là kết quả nguy hiểm nhất trong một phép đo, vì nó trông giống thành công. Một phép đo trả `0` phải chứng minh được nó **có khả năng** trả khác `0` — cùng nguyên tắc với "mỗi khẳng định phủ định cần một quan sát dương tính". Xem `a62d8f9`.

## 7. 28 ref ẩn — suýt xoá code đang chạy

**Triệu chứng.** Kết luận: ba component có `0 instance`, đề nghị xoá. Sai. Chúng có **2, 8 và 18** ref.

**Vì sao xảy ra.** Ref nằm trong giá trị replacement của `descendants`, và bộ duyệt cây thô **không đi vào vùng đó**.

**Ai hay mắc.** Ai duyệt một cây có "override lồng": AST có macro, JSON config có template, DOM có shadow root.

**Vì sao cổng cũ im lặng.** Cùng bộ đếm ở mục 6, và đây là **lần thứ hai** cùng một cái bẫy — người review đã gặp, đã sửa, rồi viết một bộ đếm mới vẫn không đi vào `descendants`. Agent design từ chối lệnh xoá và đưa số đếm đúng.

**Chọn: một quy tắc mạnh hơn một bản sửa.** *"`0 instance` không bao giờ đủ để biện minh một lệnh xoá."* Phải ra `0` ở **cả hai** cột — thô và ẩn.

**Bài học.** Một bài học phải học lại là một bài học chưa từng được viết xuống. Đó là lý do `pencil-measurement.md` ra đời ngay sau đó.

## 8. Tiền đề sai trong chính yêu cầu

**Triệu chứng.** Yêu cầu gửi cho backend: *"đổi `SESSION_SECRET` là vô hiệu mọi session, vì tất cả đang ký bằng key cũ."* Sai hoàn toàn.

**Vì sao xảy ra.** Biến được **đặt tên theo thứ nó không làm**. `SESSION_SECRET` ký **cursor phân trang**. Session token là `randomBytes(32)`, **không ký bằng gì**, database giữ SHA-256. Đường thật sự đau là `CSRF_SECRET` — HMAC của session token, nên xoay nó làm **mọi mutation từ tab đang mở** hỏng `403`.

**Ai hay mắc.** Ai tin một cái tên thay vì đọc chỗ dùng. Tên biến là tài liệu **không có ai kiểm**.

**Vì sao cổng cũ im lặng.** Không cổng máy móc nào bắt được — đây là lỗi trong một **yêu cầu**, không phải trong code. Backend đọc code, thấy tiền đề sai, và **nói ra thay vì làm theo**. Làm theo là dựng cơ chế hai key cho đường không cần nó và bỏ sót đường cần.

**Chọn: sửa tiền đề, ghi cả cái tên gây hiểu nhầm thành nợ.** Đổi tên là thay đổi vận hành cho mọi môi trường đang chạy, nên nó là một việc riêng có chủ đích.

**Bài học, và đây là bài học đắt nhất trong tài liệu này.** Mỗi prompt giao cho agent đều có một dòng: *"thấy yêu cầu nào sai thì **dừng và nói, đừng làm theo**."* Dòng đó thu về ít nhất **tám** lần chặn được một chỉ thị sai — trong đó hai lệnh xoá code đang chạy. Không viết dòng đó thì agent sẽ làm theo, và làm rất tốt, một việc sai.

## 9. Thiếu một khoá mà tổng vẫn khớp

**Triệu chứng.** `dueStates` của endpoint tổng quan có **bốn** khoá trong khi enum có **năm**: `scheduled` bị gộp vào `none`.

**Vì sao xảy ra.** Hợp đồng được viết từ một frame thiết kế, và ví dụ trong hợp đồng cộng lại đúng bằng tổng — nên khoá cuối buộc phải gom hai nhóm, nhưng nó mang tên của nhóm hẹp hơn.

**Ai hay mắc.** Ai thiết kế API tổng hợp. Phép kiểm tự nhiên nhất — *"các phần có cộng lại bằng tổng không?"* — **luôn đúng** với cách gộp này.

**Vì sao cổng cũ im lặng.** Chính vì tổng khớp. Hệ quả thật là `dueStates.none` **không** bằng số bản ghi lọc theo `dueState=none`: **một cái tên, hai nghĩa, ở hai endpoint**. Backend phát hiện khi so từng khoá với chính bộ lọc cùng tên, rồi **ghim chỗ lệch bằng một test** và báo lại thay vì tự sửa hợp đồng.

**Chọn: đủ năm khoá.** Một tên chỉ được mang một nghĩa trong toàn hệ thống.

**Bài học.** Bất biến dễ kiểm nhất thường là bất biến yếu nhất. Khi một phép cộng khớp, hãy hỏi thêm: **từng phần có đúng nghĩa cái tên nó mang không?**

## 10. Màu đã sửa chưa bao giờ tới ứng dụng

**Triệu chứng.** `packages/ui/src/tokens.css` ship `--fb-color-text-subtle: #94A3B8` — đúng giá trị **2,6:1** mà vòng design đã sửa. Giá trị đúng `#6B7280` nằm trong artifact và không ở đâu khác.

**Vì sao xảy ra.** `tokens.css` là file **được sinh ra** từ artifact bằng `pnpm tokens`. Vòng design sửa màu, người review xác minh, freeze được chốt, `.pen` được commit — và không ai chạy lệnh sinh lại.

**Ai hay mắc.** Mọi dự án có file sinh ra được commit: client OpenAPI, snapshot i18n, migration từ schema, type sinh từ GraphQL. Nguồn đổi thì file sinh **không tự đổi theo**, và nó vẫn hợp lệ về cú pháp nên không cổng thông thường nào phàn nàn.

**Vì sao cổng cũ im lặng.** Không cổng nào kiểm quan hệ **nguồn → file sinh**. `pnpm verify` xanh vì `tokens.css` là CSS hợp lệ. 1.377 test xanh vì không test nào so nó với artifact. Biên bản freeze ghi "đã sửa" và đúng — với artifact, không với ứng dụng. Bước bắt được nó, `pnpm tokens && git diff --exit-code`, **đã tồn tại trong workflow từ lâu và chưa từng thực thi**.

| Giải pháp | Được | Mất |
|---|---|---|
| Nhớ chạy `pnpm tokens` sau mỗi vòng design | Không tốn gì | Dựa vào trí nhớ — đã hỏng ngay lần đầu |
| Sinh lại lúc build, không commit file sinh | Không thể lệch | Build phụ thuộc artifact; `.pen` phải có mặt ở mọi môi trường build |
| Commit file sinh **và** một cổng CI so lại | Đọc được trong diff, và lệch thì đỏ | Cần CI thật sự chạy |

**Chọn: cách thứ ba** — nó đã được chọn từ đầu và viết đúng. Thứ thiếu không phải thiết kế mà là **việc cổng đó chưa bao giờ chạy**.

**Bài học.** Một file được sinh ra mà được commit thì **bắt buộc** phải có một cổng so nó với nguồn. Không có cổng đó, nó chỉ là một bản sao sẽ trôi — và nó trôi im lặng, vì bản thân nó vẫn hợp lệ.

## 11. `dist` thiếu trên runner sạch

**Triệu chứng.** `Failed to resolve entry for package "@flowboard/contracts"` — 22 suite đổ ngay lúc import, không phải ở assertion nào.

**Vì sao xảy ra.** Job `integration` chạy test mà không build trước. `packages/contracts` trỏ `main` vào `./dist`.

**Ai hay mắc.** Mọi monorepo có package nội bộ build ra `dist`. Nó **không bao giờ** lộ trên máy phát triển, vì `dist` còn lại từ lần build bất kỳ trước đó.

**Vì sao cổng cũ im lặng.** Không cổng nào từng **bắt đầu từ số không**. Máy dev luôn chạy trên trạng thái tích luỹ; CI chưa từng chạy. Đây là **lần thứ hai** cùng một nguyên nhân — lần đầu là `web.Dockerfile` build thiếu `contracts` và `ui`, tìm ra ở M5.5 khi lần đầu có người dựng image từ context sạch.

| Giải pháp | Được | Mất |
|---|---|---|
| Trỏ `main` vào source `.ts` | Không cần build | Mất ranh giới build; mọi consumer phải tự transpile |
| Thêm bước build vào job | Một dòng, đúng chỗ | Phải nhớ ở **mọi** job có consumer |
| Một job `build` chạy trước, chia artifact | Khai báo một lần | Thêm bậc trong pipeline |

**Chọn: thêm bước build.** Pipeline hiện có 5 job và chỉ 2 job cần `dist`; chia artifact là thêm phức tạp cho một vấn đề hai dòng.

**Bài học, và nó lớn hơn bản sửa.** **Một phụ thuộc được thoả mãn bằng state còn sót lại thì không phải là một phụ thuộc đã được khai báo.** Chỗ duy nhất chứng minh được điều đó là môi trường bắt đầu từ số không — CI, hoặc một `docker build` không cache. Máy phát triển **không bao giờ** là chỗ đó.

---

## Bốn thói quen rút ra

**1. Mỗi giá trị đi qua ranh giới hai lane phải có một nguồn, và một guard đọc thực tại.** Guard so hằng số với hằng số chỉ chứng minh hai chuỗi giống nhau. Đọc đĩa, đọc socket, đọc `package.json` mà runtime thật sự chạy.

**2. Danh sách cổng phải gồm thứ chạy code thật.** `typecheck` không evaluate module. `inject()` không đi qua HTTP. jsdom không có mạng. Ba lỗi trong chín lỗi ở đây sống sót vì không cổng nào chạy thứ thật.

**3. Một phép đo trả `0` phải chứng minh được nó có thể trả khác `0`.** Áp cho cả test (`khẳng định phủ định cần một quan sát dương tính`) lẫn script phân tích.

**4. Viết vào prompt quyền dừng và phản biện.** Nó thu về nhiều hơn mọi cổng tự động cộng lại — tám lần, trong đó hai lần cứu code đang chạy khỏi bị xoá.

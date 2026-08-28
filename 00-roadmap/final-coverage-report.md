# Final Coverage Report

Báo cáo trạng thái của repo: cái gì đã có, cái gì chưa, và chất lượng được kiểm chứng bằng gì.

Cập nhật: **2026-08-28**

## Tổng quan bằng số

```text
Tổng số note              227   (không tính README gốc và templates/)
Tổng dung lượng           ~3,9 MB
Liên kết nội bộ           3.522
Liên kết hỏng             11    (toàn bộ trỏ tới 07-projects/.../phases/ chưa viết)
                          + 1 placeholder có chủ đích trong templates/topic-note.md
```

| Vùng | Số note | Trạng thái |
|---|---|---|
| `00-roadmap/` | 11 | Hoàn chỉnh |
| `01-web-frontend/` | 43 | Hoàn chỉnh |
| `02-backend-api/` | 40 | Hoàn chỉnh |
| `03-database/` | 35 | Hoàn chỉnh |
| `04-infrastructure/` | 40 | Hoàn chỉnh |
| `05-cross-cutting/` | 39 | Hoàn chỉnh |
| `06-system-design/` | 11 | Hoàn chỉnh |
| `09-ai-assisted-development/` | 6 | Hoàn chỉnh |
| `07-projects/` | 1 | **Chưa hoàn chỉnh** — xem bên dưới |
| `08-learning-log/` | 1 | Khung để người học tự ghi |

## Cấu trúc nội dung

```text
00-roadmap                   hệ thống học, behavior map, index, audit, báo cáo này
01-web-frontend              web foundations · JS/TS · React · Next.js
02-backend-api               HTTP/API · Node.js · NestJS · auth · architecture
03-database                  SQL · PostgreSQL · Redis · data modeling · message queues
04-infrastructure            Linux · networking · Docker · CI/CD · Kubernetes
05-cross-cutting             security · testing · observability · performance
                             · reliability · concurrency
06-system-design             yêu cầu → mở rộng → nhất quán → phân vùng → sự kiện
                             → ranh giới service → giả định phân tán → template
07-projects                  fullstack lab (README có 12 milestone; phase files chưa viết)
08-learning-log              nơi người học ghi lại
09-ai-assisted-development   làm việc với AI: ngữ cảnh · review · xác minh · rủi ro
```

## Điều gì được kiểm chứng

Mỗi note trong repo được viết theo cùng một khung, và khung đó có thể kiểm tra được:

```text
□ Mở đầu bằng MỘT SỰ CỐ CỤ THỂ, không phải định nghĩa
□ Position     — vị trí trong đường đi runtime, không phải nhãn phân loại
□ Problem      — vấn đề nó giải quyết, trước khi nói về công cụ
□ Mental Model — mô hình để suy luận, có sơ đồ
□ Example      — code nhỏ, tập trung vào HÀNH VI
□ Prediction   — câu hỏi dự đoán kèm đáp án gấp lại được
□ Break It     — bảng thí nghiệm phá vỡ có chủ đích
□ What Usually Goes Wrong / Common Misconceptions
□ Debugging    — quy trình, không phải danh sách lệnh
□ Production Considerations · Trade-offs
□ Explain Without Notes — kiểm tra hiểu biết
□ Related      — liên kết thật, đi được tới nơi
□ Version / Context — ghim phiên bản khi hành vi phụ thuộc phiên bản
```

Không phải note nào cũng có đủ mọi mục — chủ đề nhỏ thì bỏ bớt. Nhưng mọi note đều có: sự cố mở đầu, mental model, prediction, và related.

## Ba tính chất của repo

```text
① MỞ ĐẦU BẰNG SỰ CỐ, KHÔNG BẰNG ĐỊNH NGHĨA
   227 note, mỗi note bắt đầu bằng một tình huống production cụ thể.
   Đơn vị học là BEHAVIOR của hệ thống; công cụ chỉ là phương tiện quan sát.

② LIÊN KẾT THẬT, KHÔNG PHẢI NHÃN
   3.522 liên kết nội bộ. Bạn đi được từ "React race condition"
   → AbortController → HTTP timeout → retry → idempotency → distributed lock,
   vì đó là đường một người debug thật sẽ đi.

③ KIỂM CHỨNG ĐƯỢC
   Mỗi note có Prediction (dự đoán trước khi chạy) và Break It (phá có chủ đích).
   Đọc xong mà không trả lời được Prediction = chưa hiểu.
```

## Còn thiếu

### `07-projects/fullstack-lab/phases/` — 10 file

`fullstack-lab/README.md` mô tả 12 milestone và liên kết tới 10 file phase chưa tồn tại:

```text
phase-01-ui-state.md        phase-06-concurrency.md
phase-02-async-ui.md        phase-07-performance.md
phase-03-api-crud.md        phase-08-cache-queue.md
phase-04-database.md        phase-09-docker.md
phase-05-auth.md            phase-10-production.md
```

Đây là 11 trong 12 liên kết hỏng còn lại (liên kết thứ 12 là placeholder `path/to/note.md` có chủ đích trong `templates/topic-note.md`).

Mỗi phase nên là một **bài lab có thể chạy**: mục tiêu, điều kiện đầu vào, các bước dựng, và — quan trọng nhất — **các thí nghiệm phá vỡ** liên kết ngược về note lý thuyết tương ứng.

### `00-roadmap/03-ai-assisted-learning.md`

Ngắn (khoảng 640 byte) so với phần còn lại của repo. Nó vẫn đúng và được liên kết từ hai nơi, nhưng có thể mở rộng theo khung chuẩn — đặc biệt phần "ranh giới giữa dùng AI để học và dùng AI để thay việc học", nay đã có [09-ai-assisted-development/](../09-ai-assisted-development/README.md) làm đối chiếu.

## Kiểm chứng repo

Ba việc nên chạy định kỳ:

```text
① KIỂM TRA LIÊN KẾT
   duyệt mọi .md, trích mọi liên kết markdown trỏ tới file .md, phân giải tương đối,
   báo cáo file không tồn tại kèm số lần được tham chiếu.
   → phát hiện note bị hứa hẹn mà chưa viết, và note bị đổi tên

② KIỂM TRA CẤU TRÚC
   mọi note có: sự cố mở đầu · Position · Mental Model · Prediction · Related
   → phát hiện note viết vội

③ KIỂM TRA PHIÊN BẢN
   mọi note có phần Version / Context khi hành vi phụ thuộc phiên bản
   → phát hiện nội dung sẽ lỗi thời mà không ai biết
```

## Cách dùng repo này

```text
CÓ TRIỆU CHỨNG CỤ THỂ      → behavior-index.md
MUỐN BẢN ĐỒ THEO TẦNG       → knowledge-map.md
MUỐN LỘ TRÌNH HỌC           → 02-roadmap.md (12 behavior, theo thứ tự)
TRA THEO TÊN                → 04-topic-index.md
BẮT ĐẦU MỘT VÙNG MỚI        → README của folder đó
                              (thứ tự đọc + bảng chẩn đoán riêng)
```

Và cách đọc một note để nó có tác dụng:

```text
① đọc phần mở đầu và Position — biết note này thuộc về đâu
② đọc Mental Model — dừng lại, tự vẽ lại sơ đồ
③ LÀM Prediction TRƯỚC KHI mở đáp án   ← bước quyết định
④ chọn 2–3 dòng trong Break It và LÀM THẬT
⑤ trả lời Explain Without Notes bằng lời của mình
⑥ ghi vào 08-learning-log/ điều bạn dự đoán SAI
```

Bước ⑥ là bước có giá trị lâu dài nhất: điều bạn dự đoán sai chính là chỗ mental model của bạn khác thực tế.

## Related

- [Learning system](00-learning-system.md) — chu trình MODEL → PREDICT → BREAK → EXPLAIN → RECALL
- [Behavior index](behavior-index.md) — tra theo triệu chứng
- [Knowledge map](knowledge-map.md) — tra theo tầng
- [Topic index](04-topic-index.md) — tra theo tên
- [Roadmap](02-roadmap.md) — 12 behavior theo thứ tự
- [Knowledge audit](knowledge-audit.md) — audit ban đầu và kế hoạch
- [Project roadmap](project-roadmap.md) — lộ trình dự án

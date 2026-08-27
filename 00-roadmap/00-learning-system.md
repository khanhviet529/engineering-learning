---
level: foundation
area: cross-cutting
---

# Learning System

Cách dùng repository này. Đọc file này trước mọi file khác.

## Mục tiêu

Không tối ưu cho việc nhớ syntax. Tối ưu cho khả năng:

- đọc và sửa code người khác viết;
- **dự đoán** behavior trước khi chạy;
- debug theo tầng chứ không đoán;
- giải thích trade-off;
- thiết kế hệ thống;
- dùng AI mà vẫn giữ năng lực kỹ thuật cốt lõi.

Cách kiểm tra bạn có đang đi đúng hướng: sau một buổi học, bạn có thể **dự đoán sai** một điều gì đó không? Nếu mọi thứ đều "hợp lý" và "dễ hiểu", bạn đang đọc chứ chưa học.

## Vì sao học theo behavior chứ không theo công nghệ

Học theo công nghệ tạo ra kiến thức **rời rạc và hết hạn nhanh**:

```text
Học "Redis" → biết SET, GET, EXPIRE, HSET
           → gặp stale data trong production → không biết bắt đầu từ đâu
```

Học theo behavior tạo ra kiến thức **chuyển giao được**:

```text
Vì sao cần cache?  → có chi phí đọc lặp lại
cache hit/miss     → không phải lúc nào cũng có sẵn
stale data         → bản sao không tự đồng bộ
TTL                → chấp nhận sai trong bao lâu
invalidation       → ai chịu trách nhiệm xoá
stampede           → nhiều miss cùng lúc
distributed cache  → nhiều instance thấy khác nhau
→ Redis là một implementation của chuỗi trên
```

Chuỗi thứ hai còn đúng khi bạn đổi sang Memcached, sang CDN, sang cache trong process, hoặc sang cache của Next.js. Chuỗi thứ nhất thì không.

Điều này cũng có nghĩa: khi đọc một note, **nếu bạn chưa cảm nhận được problem thì đừng học API**. Quay lại đọc phần `Problem` cho đến khi nó thành một câu hỏi bạn thật sự muốn trả lời.

## Một buổi học

Thời lượng mục tiêu: 60–90 phút. Ngắn hơn cũng được, nhưng phải đủ 5 bước.

### 0. Recall (5 phút)

Mở learning log của buổi trước. Trả lời lại phần *Explain without notes* **mà không mở note**.

Đây là bước rẻ nhất và có ROI cao nhất. Nếu không trả lời được, hôm nay không học topic mới — học lại topic cũ. Kiến thức không được recall sẽ mất, và bạn sẽ tưởng mình đã học.

### 1. Model (15 phút)

Đọc phần `Position` → `Problem` → `Mental Model` → `How It Works` của note.

Rồi **đóng note và vẽ lại mental model bằng tay**. Nếu không vẽ lại được thì bạn chưa có model, bạn chỉ vừa đọc chữ.

Không đọc lý thuyết quá 20 phút trước khi chạy code. Lý thuyết không có phản hồi.

### 2. Predict (5 phút — không được bỏ)

Trước khi chạy bất cứ gì, **viết ra giấy** hoặc vào learning log:

- Tôi nghĩ output sẽ là gì?
- Component nào render? Query nào chạy? Request nào đi ra?
- Nếu tôi làm X thì tôi nghĩ sẽ hỏng thế nào?

Đây là bước duy nhất tạo ra học tập thật. Cơ chế: **nếu bạn không dự đoán thì bạn không thể sai; nếu không sai thì mental model không được sửa.** Đọc xong rồi thấy "à đúng vậy" là ảo giác hiểu (hindsight bias) — nó cảm giác giống hiểu nhưng không tạo ra khả năng dự đoán lần sau.

Dự đoán phải **cụ thể và có thể sai**. "Nó sẽ chạy" không phải dự đoán. "Effect chạy 2 lần, log thứ tự là A, C, B" là dự đoán.

### 3. Build (20–30 phút)

Dựng ví dụ **nhỏ nhất** kiểm chứng được dự đoán. Không dựng cả application.

Chạy trong [Fullstack Lab](../07-projects/fullstack-lab/README.md) để mọi experiment tích luỹ vào một hệ thống thật thay vì nằm rải rác trong sandbox.

So sánh kết quả với dự đoán. **Ghi lại chỗ lệch.** Chỗ lệch chính là nội dung buổi học.

### 4. Break (15–20 phút)

Chủ động phá. Mỗi note có bảng `Break It` — làm theo, và thêm cách của riêng bạn:

- input rỗng, input rất lớn, input sai type;
- hai request đồng thời, click liên tục;
- mạng chậm (throttle DevTools), mạng mất giữa request;
- tắt database, tắt Redis;
- timeout ngắn hơn thời gian xử lý;
- refresh trang giữa lúc mutation đang chạy;
- restart container, xoá volume;
- điền dữ liệu gấp 100 lần.

Mục đích không phải "làm nó lỗi". Mục đích là **nhìn thấy failure mode** để lần sau nhận ra nó trong production từ triệu chứng.

Một quy tắc: nếu bạn chưa từng thấy một thứ hỏng, bạn không biết nó hoạt động — bạn chỉ biết nó *đã* hoạt động một lần.

### 5. Explain (10 phút)

Đóng hết tài liệu. Tự giải thích thành tiếng hoặc viết ra:

- Chuyện gì xảy ra?
- Nó xảy ra ở **tầng nào**?
- Vì sao hệ thống lại hoạt động như vậy?
- Giả định nào của tôi đã sai?
- Failure mode là gì?
- Nếu lỗi này xuất hiện trong production, tôi kiểm tra theo thứ tự nào?
- Trade-off của giải pháp là gì?

Nếu bạn phải mở tài liệu để trả lời, đánh dấu câu đó và recall lại buổi sau.

## Vì sao vòng này theo thứ tự đó

```text
MODEL     cho bạn một giả thuyết để kiểm chứng
   ↓
PREDICT   biến giả thuyết thành phát biểu có thể sai
   ↓
BUILD     tạo phản hồi từ thực tế
   ↓
BREAK     mở rộng vùng bạn đã quan sát sang vùng failure
   ↓
EXPLAIN   buộc kiến thức thành dạng có thể truy xuất
   ↓
RECALL    chống lại việc quên
```

Đảo thứ tự sẽ mất tác dụng:

- **Build trước Model** → copy-paste, chạy được nhưng không biết vì sao.
- **Build trước Predict** → không có gì để so sánh, không phát hiện được mental model sai.
- **Explain trước Break** → giải thích được happy path, bất lực khi production hỏng.
- **Không Recall** → tuần sau phải học lại.

## Pass 1 / Pass 2

Không phải note nào cũng cần dài như nhau. Có hai mức:

**Pass 1 — note ngắn 5 mục** (dùng [learning-log.md](../templates/learning-log.md)):
Position, prediction, what happened, what I misunderstood, explain without notes.
Ưu tiên **tốc độ và tính đều đặn**. Mục tiêu là đi hết một behavior.

**Pass 2 — mở rộng note quan trọng** (dùng [topic-note.md](../templates/topic-note.md)):
thêm mental model đầy đủ, failure modes, misconceptions, debugging order, production considerations, trade-offs, cross-links.

Chỉ làm Pass 2 cho topic mà bạn thật sự sẽ dùng lại. Làm Pass 2 cho mọi thứ là cách chắc chắn để bỏ dở.

## Quy tắc chống tự lừa

| Dấu hiệu tự lừa | Sửa |
|---|---|
| "Hiểu rồi" nhưng chưa chạy | Chạy, và dự đoán trước khi chạy |
| Đọc lại note thấy quen → tưởng đã nhớ | Recall chủ động, không đọc lại thụ động |
| Chưa từng thấy nó hỏng | Làm bảng `Break It` |
| Giải thích được bằng thuật ngữ | Giải thích lại cho người không biết thuật ngữ đó |
| Copy code AI sinh và nó chạy | Xoá một dòng, dự đoán hỏng gì, kiểm tra |
| Nhớ giải pháp nhưng không nhớ problem | Đọc lại phần `Problem`; giải pháp không có problem là trivia |

## Nhịp học

Đều đặn quan trọng hơn cường độ. Một behavior mỗi 3–5 buổi là nhịp hợp lý.

```text
Buổi 1   Model + Predict + Build
Buổi 2   Recall + Break
Buổi 3   Recall + Explain + Pass 2 nếu topic quan trọng
```

Nếu bỏ nhiều ngày: **không nhảy tiếp**. Quay lại recall behavior gần nhất trước.

## Dùng AI trong vòng học này

Câu hỏi duy nhất cần hỏi trước khi nhờ AI:

> Nếu AI làm hộ bước này, mình có mất **feedback** cần thiết để hiểu behavior không?

| Bước | Giao AI được? |
|---|---|
| Model | Được — nhờ giải thích lại, nhờ đưa phản ví dụ |
| **Predict** | **Không.** Đây là feedback loop của bạn |
| Build | Được phần boilerplate, scaffold, seed data |
| **Break** | Nhờ **gợi ý** cách phá, nhưng tự chạy và tự quan sát |
| **Explain** | **Không.** Nhưng nhờ AI *chấm* explanation của bạn thì rất tốt |
| Recall | Nhờ AI đặt câu hỏi kiểm tra — dùng tốt |

Chi tiết: [AI-Assisted Learning](03-ai-assisted-learning.md) (học) và [09-ai-assisted-development/](../09-ai-assisted-development/README.md) (làm việc).

## Related

- [Roadmap](02-roadmap.md) — 12 behavior theo thứ tự phụ thuộc
- [Behavior Map](01-behavior-map.md) — behavior → công nghệ chạm tới
- [Behavior Index](behavior-index.md) — triệu chứng → note
- [templates/topic-note.md](../templates/topic-note.md) — cấu trúc note Pass 2
- [templates/learning-log.md](../templates/learning-log.md) — cấu trúc note Pass 1
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi chạy experiment

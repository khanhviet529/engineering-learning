# Scenarios

Bài tập nối kiến thức. Đây là folder duy nhất trong repo **không** chứa khái niệm mới — mọi câu trả lời đều nằm ở note khác, và mục đích là buộc bạn tìm ra note nào.

## Vì sao folder này tồn tại

Biết từng khái niệm riêng lẻ không đủ. Vấn đề thật đến dưới dạng **triệu chứng**, không dưới dạng tên chủ đề:

```text
Người dùng nói:  "trang chậm"
Không nói:       "endpoint này có N+1 và thiếu index trên khoá ngoại"
```

Khoảng cách giữa hai câu đó là kỹ năng mà folder này luyện.

## Nội dung

| Note | Gồm |
|---|---|
| [Scenario walkthroughs](01-scenario-walkthroughs.md) | 5 tình huống: 8 API · API 5 giây · list 5M dòng · service 15 dependency · Prisma query chậm |

## Cách dùng

```text
1. Đọc scenario
2. TỰ TRẢ LỜI 5 câu hỏi — viết ra, đừng nghĩ trong đầu
3. Mở phần phân tích
4. Ghi chỗ LỆCH vào learning log
```

Bước 2 là bước duy nhất tạo ra giá trị. Đọc phân tích mà không dự đoán trước cho cảm giác hiểu nhưng không tạo ra khả năng chẩn đoán lần sau — xem [Learning System](../../00-roadmap/00-learning-system.md) về ảo giác hiểu.

## Ba bài học chung của cả năm scenario

1. **Triệu chứng ≠ nguyên nhân.** "8 API chậm" thật ra là payload; "Prisma chậm" thật ra là thiếu index trên khoá ngoại; "15 dependency" thật ra là side effect coupling.
2. **Câu hỏi nghiệp vụ đi trước câu hỏi kỹ thuật.** *"Dữ liệu cũ 5 phút có được không?"* rẻ hơn mọi tối ưu query.
3. **Đo trước khi sửa.** Trong cả 5 scenario, phép đo đầu tiên đổi hoàn toàn hướng giải quyết.

## Tự tạo scenario

Mỗi vấn đề thật bạn gặp nên thành một scenario:

```text
1. Viết triệu chứng + số liệu (không viết nguyên nhân)
2. Viết 5 câu hỏi chẩn đoán
3. Viết dự đoán của bạn
4. Đo
5. Ghi chỗ lệch
```

Sau 10 scenario tự viết, bạn sẽ nhận ra phần lớn vấn đề rơi vào một số ít họ nguyên nhân — và đó là lúc chẩn đoán trở nên nhanh.

## Related

- **[Application Engineering Map](../../00-roadmap/application-engineering-map.md)** — tra note theo problem
- [Full-stack triage](../performance/07-full-stack-triage.md) — playbook đo lường theo thứ tự
- [Behavior Index](../../00-roadmap/behavior-index.md) — tra note theo triệu chứng
- [Learning System](../../00-roadmap/00-learning-system.md) — vòng PREDICT → BUILD → BREAK → EXPLAIN
- [08-learning-log/](../../08-learning-log/README.md) — nơi ghi chỗ dự đoán sai

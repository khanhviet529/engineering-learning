---
level: meta
area: roadmap
---

# AI-Assisted Learning

> Dùng AI để **làm việc** là chủ đề khác, và nó ở [09-ai-assisted-development/](../09-ai-assisted-development/README.md). Note này chỉ trả lời một câu: **dùng AI thế nào để vẫn học được?**

## Vấn đề

AI làm cho việc *có được câu trả lời* gần như miễn phí. Nhưng học không xảy ra khi bạn có câu trả lời — nó xảy ra khi bạn **dự đoán sai và biết mình sai**.

```text
Không có AI:   gặp lỗi → đoán → thử → sai → đoán lại → hiểu
Có AI, dùng sai: gặp lỗi → hỏi → dán code → hết lỗi → KHÔNG hiểu gì
```

Lần thứ hai gặp cùng lỗi, người thứ nhất nhận ra nó trong 30 giây. Người thứ hai lại đi hỏi.

Đây không phải lời khuyên đạo đức. Nó là một quan sát về cơ chế: **mental model chỉ được sửa khi có feedback về một dự đoán cụ thể.** Không dự đoán ⇒ không có gì để sửa ⇒ cảm giác hiểu mà không có khả năng chẩn đoán.

## Nguyên tắc một câu

> AI có thể làm hộ **implementation**, nhưng không được lấy mất **feedback** cần thiết để bạn hình thành mental model.

Áp dụng nó bằng một câu hỏi duy nhất, hỏi trước mỗi lần định nhờ AI:

```text
"Nếu AI làm hộ bước này, mình có mất feedback cần thiết
 để hiểu behavior này không?"

KHÔNG mất  →  giao đi, không do dự
CÓ mất     →  tự làm trước, rồi mới hỏi
```

## Cho AI làm — không do dự

Những việc này **không** tạo ra feedback về mental model. Làm tay chỉ tốn thời gian:

| Việc | Vì sao an toàn |
|---|---|
| boilerplate, scaffold project | không có gì để hiểu sai |
| code lặp lại, đổi tên hàng loạt | mechanical |
| sinh dữ liệu test, seed data | không phải kiến thức behavior |
| viết test **sau khi** bạn đã nêu behavior cần test | bạn đã làm phần có giá trị |
| giải thích stack trace, giải thích message lỗi lạ | tra từ điển, không phải chẩn đoán |
| dịch cú pháp giữa hai công nghệ | bạn đã biết ý định |
| review code của bạn | phản hồi *sau khi* bạn đã quyết định |
| **đưa phản ví dụ và câu hỏi kiểm tra** | tăng feedback thay vì lấy đi |

Dòng cuối là cách dùng AI tốt nhất khi học, và ít người dùng: bảo nó **hỏi ngược** bạn.

## Không giao hoàn toàn khi đang học behavior đó

Năm bước này **chính là** chỗ học xảy ra. Giao đi là bỏ luôn buổi học:

| Bước | Nếu giao cho AI thì mất gì |
|---|---|
| **Prediction** | mất toàn bộ giá trị của thí nghiệm — không có dự đoán thì không thể sai |
| **Thiết kế experiment** | mất khả năng tự đặt câu hỏi kiểm chứng được, kỹ năng chuyển giao mạnh nhất |
| **Kết luận nguyên nhân bug** | mất kỹ năng chẩn đoán; lần sau vẫn phải hỏi |
| **Explanation bằng lời của bạn** | đây là bài kiểm tra duy nhất phát hiện được "hiểu giả" |
| **Quyết định trade-off** | trade-off phụ thuộc ngữ cảnh mà AI không có; và đây là phần công việc thật của engineer |

Chú ý chữ **"hoàn toàn"**. Bạn *được* hỏi sau khi đã tự làm. Thứ tự mới là điều quan trọng.

## Thứ tự đúng: dự đoán trước, hỏi sau

```text
1. Đọc mục Problem + Mental Model của note
2. VIẾT dự đoán ra giấy hoặc vào learning log     ← không bỏ bước này
3. Chạy thử / gây lỗi thật
4. So sánh: dự đoán vs thực tế
5. GIỜ MỚI hỏi AI — và hỏi đúng câu:
      "Tôi dự đoán X, thực tế Y. Giả định nào của tôi sai?"
6. Giải thích lại bằng lời của mình, không nhìn note
```

Bước 5 là khác biệt giữa dùng AI để học và dùng AI để tránh học. So sánh hai prompt cho cùng một tình huống:

```text
❌ "Sửa lỗi CORS này cho tôi"
   → có code chạy được, không hiểu gì, gặp lại vẫn tắc

✅ "Tôi tưởng CORS chặn request trước khi nó tới server, nhưng log server
    cho thấy request ĐÃ tới. Giả định nào của tôi sai?"
   → sửa đúng một mental model cụ thể, và nó không quay lại
```

Prompt thứ hai chỉ viết được **sau khi** bạn đã có dự đoán. Đó là lý do bước 2 không bỏ được.

## Bốn prompt đáng dùng khi học

```text
① "Hỏi tôi 5 câu để kiểm tra xem tôi có thật sự hiểu <behavior> không.
    Đừng đưa đáp án trước."

② "Tôi giải thích <behavior> như sau: <giải thích của bạn>.
    Chỗ nào trong đó sai hoặc thiếu?"

③ "Cho tôi một trường hợp mà cách hiểu này DẪN TỚI KẾT LUẬN SAI."

④ "Thiết kế cho tôi một experiment nhỏ nhất để kiểm chứng
    <giả định>. Đừng nói kết quả."
```

Cả bốn đều có một điểm chung: chúng bắt AI **tạo thêm feedback** cho bạn, thay vì trả lời thay bạn. Câu *"Đừng đưa đáp án trước"* / *"Đừng nói kết quả"* là phần quan trọng nhất của prompt.

## Hai bẫy cụ thể

**Bẫy 1 — AI tự tin về thứ nó sai.** Nó sẽ bịa ra tên option, tên hàm, hành vi phiên bản. Với repo này, đặc biệt hay sai ở: cấu hình cache Next.js, cờ CLI của Prisma, tên field trong `EXPLAIN`, API Redis. Cách xử lý: [Hallucination & verification](../09-ai-assisted-development/04-hallucination-verification.md).

**Bẫy 2 — code chạy được không phải bằng chứng bạn hiểu.** Bài kiểm tra rẻ và đáng tin: **đóng hết tab, giải thích lại bằng lời.** Chỗ bạn phải nói *"đại khái là..."* chính là chỗ mental model còn trống.

## Liên hệ với vòng học của repo

```text
MODEL    → AI được: giải thích khái niệm, đưa phản ví dụ
PREDICT  → KHÔNG giao. Đây là bước duy nhất tạo ra học tập
BUILD    → AI được: scaffold, boilerplate
BREAK    → AI được: gợi ý cách gây lỗi. Bạn tự quan sát và kết luận
EXPLAIN  → KHÔNG giao. AI chỉ được chấm bài bạn viết
RECALL   → AI được: sinh câu hỏi ôn tập từ learning log của bạn
```

Hai chữ **KHÔNG giao** nằm ở đúng hai bước mà người học hay bỏ nhất kể cả khi không có AI. AI làm cho việc bỏ chúng dễ hơn nhiều — đó là toàn bộ rủi ro, và cũng là toàn bộ nội dung note này.

## Related

- [Learning system](./00-learning-system.md) — vòng MODEL → PREDICT → BREAK → EXPLAIN → RECALL
- [09-ai-assisted-development/](../09-ai-assisted-development/README.md) — dùng AI để **làm việc** (khác với để học)
- [Context engineering](../09-ai-assisted-development/02-context-engineering.md) — vì sao chất lượng đầu ra phụ thuộc ngữ cảnh bạn đưa
- [Hallucination & verification](../09-ai-assisted-development/04-hallucination-verification.md) — AI sai ở đâu, kiểm chứng thế nào
- [Reviewing AI code](../09-ai-assisted-development/03-reviewing-ai-code.md) — đọc code AI viết
- [Learning log template](../templates/learning-log.md) — chỗ ghi dự đoán sai

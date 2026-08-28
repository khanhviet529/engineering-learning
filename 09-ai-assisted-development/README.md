---
level: intermediate
area: cross-cutting
---

# AI-Assisted Development

Folder này nói về dùng AI để **làm việc**. Dùng AI để **học** nằm ở [AI-Assisted Learning](../00-roadmap/03-ai-assisted-learning.md) — hai việc khác nhau, và nhầm lẫn giữa chúng là nguồn của phần lớn vấn đề.

Nguyên tắc chi phối toàn bộ folder:

> **AI có thể làm hộ implementation, nhưng không được lấy mất feedback cần thiết để bạn hình thành mental model.**

Và ba hệ quả trực tiếp:

```text
① AI thay đổi chi phí VIẾT code, không thay đổi chi phí HIỂU code
   → nút thắt dịch chuyển từ viết sang XÁC MINH

② Độ trôi chảy không tương quan với độ chính xác
   → code trông đúng và đọc mạch lạc dù API không tồn tại

③ Trách nhiệm không dịch chuyển
   → "AI viết đoạn đó" không phải một lời giải thích trong postmortem
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [AI thay đổi cái gì](01-what-ai-changes.md) | Xong tính năng trong 4 giờ, vì sao sửa bug mất 1,5 ngày? |
| 2 | [Context engineering](02-context-engineering.md) | Hai người, cùng câu hỏi, vì sao hai kết quả khác hẳn? |
| 3 | [Reviewing AI code](03-reviewing-ai-code.md) | Code sạch, test xanh — vì sao khách hàng thấy hoá đơn của người khác? |
| 4 | [Hallucination & verification](04-hallucination-verification.md) | Cấu hình apply thành công — vì sao nó không có tác dụng suốt 3 tháng? |
| 5 | [AI security & limits](05-ai-security-limits.md) | Dán một stack trace — vì sao credential không bao giờ được xoay? |

Note 2 có tác động lớn nhất tới chất lượng đầu ra hằng ngày. Note 3 là nút thắt mới của quy trình. Note 5 cần đọc trước khi đưa tính năng AI vào sản phẩm.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Code merge nhanh, sửa bug chậm | nợ hiểu biết | [1](01-what-ai-changes.md) |
| Không giải thích được code mình "đã viết" | bỏ qua chế độ học | [1](01-what-ai-changes.md) |
| Nhận về giải pháp in-memory cho hệ thống nhiều pod | chưa nêu số instance | [2](02-context-engineering.md) |
| Code không khớp quy ước codebase | chưa đưa mẫu | [2](02-context-engineering.md) |
| Code over-engineer cho quy mô nhỏ | chưa nêu quy mô và phản ví dụ | [2](02-context-engineering.md) |
| Hỏi lại nhiều lần mà kết quả không tốt hơn | sửa prompt chứ không sửa ngữ cảnh | [2](02-context-engineering.md) |
| PR 800 dòng review 12 phút rồi lọt bug | kích thước PR và review theo tín hiệu bề mặt | [3](03-reviewing-ai-code.md) |
| Test xanh nhưng bug tồn tại | test sinh từ code, không từ behavior | [3](03-reviewing-ai-code.md) |
| Thiếu `tenant_id` trong query | AI không biết ràng buộc bạn chưa nêu | [3](03-reviewing-ai-code.md) |
| `npm install` thất bại với gói AI đề xuất | hallucination loại ① | [4](04-hallucination-verification.md) |
| API có thật nhưng không có ở phiên bản đang dùng | hallucination loại ④ | [4](04-hallucination-verification.md) |
| Cấu hình apply thành công mà không có tác dụng | hallucination loại ⑤ | [4](04-hallucination-verification.md) |
| Thiết kế sai vì tin một "giá trị mặc định" | hallucination loại ⑥ | [4](04-hallucination-verification.md) |
| Không biết credential đã đi tới đâu | thiếu chính sách và redact | [5](05-ai-security-limits.md) |
| Tính năng AI trả về dữ liệu của người khác | phân quyền ở prompt, không ở tầng thực thi | [5](05-ai-security-limits.md) |
| Đầu ra mô hình gây XSS | coi đầu ra là dữ liệu tin cậy | [5](05-ai-security-limits.md) |

## Mười quy tắc mặc định

```text
Ngữ cảnh
 1. Nêu sáu ràng buộc: phiên bản · số instance · quy mô · đồng thời
    · chế độ lỗi · quy ước đội.
 2. Nêu VẤN ĐỀ, không nêu giải pháp — trừ khi bạn đã quyết định.
 3. Đưa MẪU code có sẵn thay vì mô tả quy ước bằng lời.
 4. Ràng buộc lặp lại ba lần thì đưa vào FILE, không vào prompt.

Kiểm soát chất lượng
 5. KHÔNG MERGE CODE BẠN KHÔNG GIẢI THÍCH ĐƯỢC.
 6. BẠN định nghĩa behavior; AI viết test sau — không để AI suy test từ code.
 7. Giới hạn kích thước PR — nó quan trọng hơn trước, vì viết code giờ rất nhanh.
 8. Chạy qua danh sách chín mục AI hay bỏ sót với mọi PR.

Xác minh và an toàn
 9. Mọi thứ compiler không kiểm tra được (YAML, env, cờ, giá trị mặc định)
    phải xác minh bằng tài liệu chính thức hoặc bằng test hành vi.
10. Không gửi secret hay dữ liệu người dùng thật; nếu lỡ gửi, XOAY NGAY.
```

## Chín thứ AI hay bỏ sót

Danh sách này để **chạy qua**, không để đọc:

```text
① quyền truy cập (thiếu tenant_id / owner_id)    ② đồng thời (race, thiếu unique)
③ nhiều instance (state in-memory)               ④ đường lỗi (thiếu timeout)
⑤ giới hạn (không phân trang, Promise.all vô hạn) ⑥ trường hợp biên
⑦ giao dịch                                      ⑧ tài nguyên không đóng
⑨ quy ước dự án
```

## Ba chế độ, một câu hỏi

```text
TỰ ĐỘNG HOÁ  việc bạn đã biết làm, chỉ tốn thời gian   → giao hết, kiểm tra kết quả
CỘNG TÁC     biết đích, chưa biết đường                → AI đề xuất, bạn chọn
HỌC          đang xây mental model                     → KHÔNG giao phần suy nghĩ

Câu hỏi phân biệt:
  "Nếu AI làm bước này, tôi có mất feedback cần thiết để hiểu behavior không?"
```

## Ba việc AI làm tốt mà ít người dùng tới

```text
① PHẢN BIỆN THIẾT KẾ CỦA BẠN
   "đây là thiết kế và ràng buộc của tôi. Nó hỏng ở đâu?"
   → tỉ lệ giá trị/rủi ro cao nhất: bạn giữ quyền thiết kế, AI mở rộng danh sách kiểm tra

② GIẢI THÍCH CODE NGƯỜI KHÁC VIẾT
   codebase cũ, thư viện lạ, stack trace khó → rủi ro thấp, giá trị cao

③ ĐẶT CÂU HỎI KIỂM TRA HIỂU BIẾT CỦA BẠN
   "hỏi tôi 10 câu về đoạn code này" → đảo ngược vai trò, bạn vẫn phải nghĩ
```

## Kiểm tra nhanh trước khi merge

```text
□ Tôi giải thích được đoạn này cho người khác mà không nhìn code chứ?
□ Nếu nó gây sự cố lúc 3 giờ sáng, tôi sửa được không?
□ Test mô tả HÀNH VI HỆ THỐNG hay mô tả CODE?
□ Có test cho đường TỪ CHỐI không?
□ Đã chạy qua chín mục ở trên chưa?
□ Mọi API và thư viện đã được kiểm chứng chưa?
□ Cấu hình mới đã được xác nhận là CÓ TÁC DỤNG chưa?
```

## Position

```text
MODEL → PREDICT/BUILD → BREAK → EXPLAIN → RECALL
          ↑ AI rất nhanh ở đây
          nhưng học nằm ở bốn bước còn lại

prompt → [2] ngữ cảnh → code → [3] review → [4] xác minh → merge
                                    ↑ nút thắt mới
[5] chạy suốt: dữ liệu ra ngoài · code đi vào · AI trong sản phẩm
```

## Related

- [AI-Assisted Learning](../00-roadmap/03-ai-assisted-learning.md) — dùng AI để **học**
- [Learning system](../00-roadmap/00-learning-system.md) — chu trình học của repo này
- [Testing](../05-cross-cutting/testing/README.md) — behavior là hợp đồng bạn định nghĩa
- [Security](../05-cross-cutting/security/README.md) — mọi nguyên tắc vẫn áp dụng ở ranh giới AI
- [Access control](../05-cross-cutting/security/04-access-control.md) — mục AI hay bỏ sót nhất
- [Concurrency](../05-cross-cutting/concurrency/README.md) — mục thứ hai hay bỏ sót
- [System design](../06-system-design/README.md) — quyết định vẫn là của bạn
- [00-roadmap/](../00-roadmap/README.md) — bản đồ toàn repo

## Version / Context

Nội dung mô tả cách làm việc, không gắn với một công cụ AI cụ thể. Công cụ và mô hình thay đổi nhanh; các nguyên tắc — xác minh ngữ cảnh, giữ feedback loop, coi đầu ra là dữ liệu không đáng tin, chịu trách nhiệm cuối — thì không. Rủi ro của tính năng AI trong sản phẩm tham chiếu OWASP Top 10 for LLM Applications.

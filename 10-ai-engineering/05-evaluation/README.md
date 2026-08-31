---
level: intermediate
area: ai-engineering
---

# Evaluation

Làm sao **biết** AI feature tốt hay tệ — thay vì cảm thấy.

Đây là vùng bị bỏ nhiều nhất và tốn nhất về sau. Lý do nó bị bỏ: nó không cần thiết để demo, và nó trở nên bắt buộc ngay khi có người dùng thật.

> **"Tôi thử thấy ổn" không phải phép đo.** Nếu bạn không có con số trước và sau, bạn không biết thay đổi của mình làm gì.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Evaluating AI features](./01-evaluating-ai-features.md) | Golden dataset, bốn loại kiểm tra, LLM-as-judge và giới hạn của nó |
| 2 | [RAG & agent evaluation](./02-rag-and-agent-evaluation.md) | Tách retrieval khỏi generation; đo quỹ đạo của agent |

## Bắt đầu ở đâu — hôm nay

Không cần pipeline. Ba việc, khoảng một buổi:

```text
① 20 CA từ bug thật + ca biên (mơ hồ, rỗng, injection)
   → mỗi bug được báo về = một dòng mới, THÊM TRƯỚC KHI SỬA

② DETERMINISTIC CHECKS trên 100% ca — không cần model, chạy vài giây
   parse được? · đúng schema? · enum hợp lệ? · citation TỒN TẠI?

③ BA METRIC ONLINE — miễn phí, phản ánh người dùng thật
   citation bịa · không tìm thấy tài liệu · tỉ lệ Regenerate
```

Ba việc đó bắt được phần lớn regression thô, và chúng đáng có **trước** cả golden dataset lớn hay LLM-as-judge.

## Bốn ý chính

**① Deterministic checks có tỉ lệ lợi ích/chi phí cao nhất.** Không cần model, chạy được ở CI, chặn merge được, và bắt đúng những lỗi thật: JSON hỏng, enum lạ, citation bịa, thiếu field.

**② Cost và latency nằm trong CÙNG báo cáo với chất lượng.**

```text
Prompt v7 → v8
  correctness  0.84 → 0.89      ✓
  cost/ca      $0.004 → $0.019  4.7×   ← có đáng không?
  p95 latency  1.2s → 3.8s      3.2×   ← chấp nhận được không?
```

Không có hai dòng dưới, bạn sẽ "cải thiện chất lượng" bằng cách âm thầm tăng chi phí gấp năm.

**③ LLM-as-judge dùng cho so sánh TƯƠNG ĐỐI, không cho giá trị tuyệt đối.** Nó có thiên vị độ dài, thiên vị văn phong, thiên vị vị trí. Phải hiệu chỉnh bằng người (50 ca) để biết nó lệch bao nhiêu.

**④ Với pipeline nhiều tầng, một con số cuối không nói tầng nào kém.**

```text
answer_correctness = 0.71
   có thể là  retrieval 0.95 × generation 0.75
   hoặc là    retrieval 0.52 × generation 0.95   ← hai kế hoạch KHÁC NHAU
```

`recall@k` là chỉ số rẻ nhất để đo và nó **đặt trần** cho mọi thứ phía sau.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Không biết prompt hiện tại tốt hơn 3 tháng trước | không có baseline → [1](./01-evaluating-ai-features.md) |
| Sửa cái này, hỏng cái khác | thiếu tag `regression` → [1](./01-evaluating-ai-features.md) |
| Chất lượng tăng, hoá đơn tăng gấp 5 | không đo cost cùng chất lượng → [1](./01-evaluating-ai-features.md) |
| Eval pass, production lỗi | eval không chạy đường code production → [1](./01-evaluating-ai-features.md) |
| Điểm judge tăng, người dùng không thấy tốt hơn | judge thiên vị; chưa hiệu chỉnh → [1](./01-evaluating-ai-features.md) |
| Không phát hiện model bịa | dataset không có ca thiếu dữ liệu → [1](./01-evaluating-ai-features.md) |
| Tối ưu nhiều tháng không cải thiện | tối ưu tầng không phải nút thắt → [2](./02-rag-and-agent-evaluation.md) |
| Không biết retrieval hay generation kém | chỉ có con số end-to-end → [2](./02-rag-and-agent-evaluation.md) |
| recall cao mà answer sai | pack cắt mất chunk; hoặc generation → [2](./02-rag-and-agent-evaluation.md) |
| Agent "thành công" nhưng đắt | chỉ đo kết quả, không đo quỹ đạo → [2](./02-rag-and-agent-evaluation.md) |
| Chọn agent rẻ hơn mà tổng đắt hơn | so `cost/run` thay vì `cost/success` → [2](./02-rag-and-agent-evaluation.md) |
| Eval chạy 2 giờ, không ai chạy | thiếu tầng unit/step; chỉ có end-to-end → [2](./02-rag-and-agent-evaluation.md) |
| Prompt injection lọt qua | không có tag `security` → [1](./01-evaluating-ai-features.md) |

## Eval chạy ở đâu

```text
CI (mỗi PR đổi prompt/model/chunking)
   → deterministic, 100% ca. Nhanh. CHẶN merge nếu regression/security tụt.

Nightly / trước release
   → + exact match + judge trên toàn bộ dataset. Báo cáo có bảng so sánh.

Hằng ngày (canary)
   → 30–50 ca trên production config → bắt thay đổi từ PHÍA PROVIDER

Production (liên tục)
   → deterministic trên 1–5% traffic + metric hành vi người dùng
```

Dòng thứ ba là dòng duy nhất phát hiện được thay đổi bạn không kiểm soát. → [06-versioning-and-release.md](../07-production/06-versioning-and-release.md)

## Position

```text
Thay đổi (prompt · model · chunking · retrieval)
        │
        ▼
   OFFLINE EVAL  ──▶ chặn merge nếu tụt
        │
        ▼
   CANARY 5%     ──▶ metric theo variant
        │
        ▼
   100% + metric online liên tục
```

## Related

- [01-context-and-output/01-prompt-as-input-contract.md](../01-context-and-output/01-prompt-as-input-contract.md) — prompt có version để so sánh
- [01-context-and-output/03-structured-output.md](../01-context-and-output/03-structured-output.md) — nền của deterministic checks
- [03-rag/04-rag-failure-modes.md](../03-rag/04-rag-failure-modes.md) — sáu tầng cần đo riêng
- [04-agents-tools/03-agent-loop.md](../04-agents-tools/03-agent-loop.md) — `stop_reason`, quỹ đạo
- [07-production/](../07-production/README.md) — metric online, versioning
- [Testing pyramid](../../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — vì sao test truyền thống không đủ
- [Deterministic tests](../../05-cross-cutting/testing/06-deterministic-tests.md) — flaky test
- [CI/CD](../../04-infrastructure/03-cicd/README.md) — eval là quality gate

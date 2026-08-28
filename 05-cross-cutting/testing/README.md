---
level: intermediate
area: cross-cutting
---

# Testing

Một câu định hình toàn bộ folder này:

> **Đơn vị test là một HÀNH VI của hệ thống, không phải một class.**

Nếu bạn viết lại phần triển khai từ đầu nhưng giữ nguyên hành vi, test tốt vẫn xanh. Test kém sẽ đỏ — và đó là cách phân biệt duy nhất bạn cần.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Test theo behavior](01-testing-pyramid-behavior.md) | Vì sao 1.847 test và 92% coverage không bắt được bug tính tiền hai lần? |
| 2 | [Unit vs integration](02-unit-vs-integration.md) | Vì sao 120 unit test xanh mà tổng đơn hàng lệch một xu? |
| 3 | [API & E2E tests](03-api-e2e-tests.md) | Vì sao đội ngũ merge khi CI đỏ? |
| 4 | [Mocking & test doubles](04-mocking-test-doubles.md) | Vì sao mock luôn khớp với API bạn *nghĩ* là có thật? |
| 5 | [Testcontainers](05-testcontainers.md) | Vì sao SQLite trong test là một quyết định tốn kém? |
| 6 | [Deterministic tests](06-deterministic-tests.md) | Vì sao `--retry 2` che giấu một race condition suốt bốn tháng? |
| 7 | [Contract testing](07-contract-testing.md) | Vì sao test của cả hai team đều xanh mà production hỏng? |

Note 1 là nền. Note 6 là note quyết định bộ test của bạn có còn được ai tin không.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Refactor không đổi hành vi làm hỏng hàng trăm test | test gắn với cấu trúc | [1](01-testing-pyramid-behavior.md) |
| Coverage cao nhưng bug vẫn lọt | test không assert, thiếu đường từ chối | [1](01-testing-pyramid-behavior.md) |
| Unit test xanh, lỗi ở kiểu dữ liệu/ràng buộc | kiểm chứng sai tầng | [2](02-unit-vs-integration.md) |
| Test không bắt được thiếu `await` | mock repository | [2](02-unit-vs-integration.md), [4](04-mocking-test-doubles.md) |
| App không khởi động được, không test nào đỏ | thiếu API test dựng `AppModule` thật | [3](03-api-e2e-tests.md) |
| E2E chạy 55 phút, đỏ 20% | quá nhiều E2E, chờ theo thời gian | [3](03-api-e2e-tests.md) |
| Đổi CSS làm test đỏ | selector gắn với cấu trúc | [3](03-api-e2e-tests.md) |
| Test xanh, API bên thứ ba đã đổi | mock trôi khỏi thực tế | [4](04-mocking-test-doubles.md), [7](07-contract-testing.md) |
| Test hỏng khi đổi số lần retry | assert lời gọi thay vì kết quả | [4](04-mocking-test-doubles.md) |
| Hành vi khác giữa test và production | DB khác loại hoặc khác phiên bản | [5](05-testcontainers.md) |
| Bộ test chậm vì khởi động container | một container mỗi file | [5](05-testcontainers.md) |
| Test đỏ ngẫu nhiên | sáu nguồn không xác định | [6](06-deterministic-tests.md) |
| Test pass riêng lẻ, đỏ khi chạy cả bộ | trạng thái sót / phụ thuộc thứ tự | [6](06-deterministic-tests.md) |
| Test đỏ chỉ vào một số giờ trong ngày | múi giờ | [6](06-deterministic-tests.md) |
| Test đỏ chỉ khi chạy song song | cô lập dữ liệu, hoặc race trong code | [6](06-deterministic-tests.md) |
| Hai service trôi khỏi nhau, cả hai đều xanh | thiếu contract | [7](07-contract-testing.md) |

## Mười quyết định mặc định

```text
Nội dung test
 1. Test hành vi quan sát được từ ngoài, không test lời gọi hàm.
 2. Tên test là một câu về hệ thống — đọc được bởi người không biết code.
 3. Với mỗi hành vi: đường đúng · biên · TỪ CHỐI · ĐỒNG THỜI.
    Hai cái sau là nơi bug production sống.
 4. Mỗi bug production sinh ra một test trước khi được sửa.

Chọn tầng
 5. Đẩy mỗi kiểm chứng xuống tầng RẺ NHẤT VẪN CÒN CÓ NGHĨA.
 6. Mock ở ranh giới TIẾN TRÌNH; dùng thật ở ranh giới TẦNG.
 7. Hạ tầng thật qua container, cùng loại và phiên bản với production.

Độ tin cậy
 8. TZ=UTC, tiêm Clock/Random, ORDER BY tường minh, shuffle thứ tự test.
 9. Mỗi test tự dựng dữ liệu duy nhất của nó; chạy song song được.
10. Không dung thứ flaky: sửa, hoặc cách ly có thời hạn. Đo tỉ lệ retry.
```

## Kim tự tháp cho một backend điển hình

```text
              ╱ E2E ╲            5–15 luồng: đăng nhập, mua hàng, thanh toán
            ╱─────────╲
          ╱  API test   ╲        ← PHẦN LỚN giá trị nằm ở đây
        ╱─────────────────╲        chuỗi HTTP thật, DB thật, không trình duyệt
      ╱   Integration      ╲      chỗ nối với hạ tầng
    ╱─────────────────────────╲
  ╱          Unit              ╲  logic thuần: ma trận điều kiện
╱───────────────────────────────╲

+ Smoke test sau deploy (3–5 kiểm tra, 60 giây, rollback tự động)
  ← thứ có tỉ lệ giá trị/chi phí cao nhất mà đa số đội ngũ chưa có
```

Tỉ lệ không phải quy tắc. Nguyên tắc là dòng số 5 ở trên.

## Bốn câu hỏi trước khi nói "đã test xong"

```text
① Nếu tôi viết lại phần triển khai này, test còn đúng không?
② Có test nào cho đường TỪ CHỐI không (ai không được làm gì)?
③ Nếu hai người gọi cùng lúc, có test nào mô tả điều đó không?
④ Nếu dependency ngoài trả lỗi hoặc timeout, có test nào không?
```

Câu ② và ③ là hai câu hay bị bỏ nhất, và chúng tương ứng với hai lớp bug nghiêm trọng nhất.

## Ngân sách thời gian

```text
unit + integration   < 5 phút    → chạy trước mỗi push
toàn bộ CI trên PR   < 10 phút   → vượt thì người ta né chạy hoặc merge bừa
E2E                  chạy song song, tách job
smoke sau deploy     < 60 giây

Vượt ngân sách → cắt E2E hoặc song song hoá, không phải nới ngân sách.
```

## Position

```text
MODEL → PREDICT/BUILD → BREAK → EXPLAIN → RECALL
                          ↑
        test là cách BREAK có hệ thống và LẶP LẠI ĐƯỢC

Code → [ unit ] → [ integration ] → [ API ] → [ E2E ] → [ smoke ] → production
                       ↑ container      ↑ contract giữa các service
```

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Testing NestJS](../../02-backend-api/02-nestjs/09-testing-nestjs.md) — cài đặt cụ thể
- [Access control](../security/04-access-control.md) — test đường từ chối
- [Shared state & races](../concurrency/02-shared-state-races.md) — khi flaky là bug thật
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — nơi test chạy và ngân sách thời gian
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — smoke test và rollback
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — thứ cần được test
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi thực hành

## Version / Context

Ví dụ dùng Jest/Vitest, Supertest, Playwright, Testcontainers, msw v2, Pact v12+ với NestJS 10/11, Prisma, PostgreSQL 16, Redis 7. Nguyên tắc không phụ thuộc công cụ; mỗi note ghi rõ phiên bản ở phần cuối.

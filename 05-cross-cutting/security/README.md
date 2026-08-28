---
level: intermediate
area: cross-cutting
---

# Security

Bảo mật không phải một tầng — nó là **một câu hỏi bạn hỏi ở mọi ranh giới**:

```text
Dữ liệu đi từ vùng ÍT TIN CẬY sang vùng TIN CẬY HƠN.
Ở mỗi ranh giới đó: cái gì có thể sai?
```

Toàn bộ folder này là câu trả lời cho câu hỏi trên ở các ranh giới cụ thể.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Security basics](01-security-basics.md) | Bảo vệ cái gì, khỏi ai, qua đường nào? |
| 2 | [Injection](02-injection.md) | Vì sao dùng ORM khắp nơi vẫn bị SQL injection? |
| 3 | [XSS & CSRF](03-xss-csrf.md) | `HttpOnly` có chặn được XSS không? |
| 4 | [Access control](04-access-control.md) | Vì sao 61/63 endpoint đúng vẫn là bị chiếm dữ liệu? |
| 5 | [SSRF & supply chain](05-ssrf-supply-chain.md) | Vì sao firewall không chặn được request từ bên trong? |
| 6 | [Secrets management](06-secrets-management.md) | API key lộ ở đâu nếu không nằm trong git? |
| 7 | [Secure headers & TLS](07-secure-headers-tls.md) | HTTPS đã bật — vì sao request đầu tiên vẫn là HTTP? |

Note 1 và 4 là hai note quan trọng nhất. Note 1 cho bạn cách suy nghĩ; note 4 là lớp lỗi bạn thực sự sẽ gặp.

Xác thực và uỷ quyền nằm ở [02-backend-api/03-auth/](../../02-backend-api/03-auth/README.md) — cùng chủ đề, nhưng ở đó là **cơ chế**, ở đây là **lớp lỗi**.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Đổi ID trong URL xem được dữ liệu người khác | ownership không nằm trong query | [4](04-access-control.md) |
| Danh sách hiện nhiều hơn chi tiết cho phép | scope tách rời giữa list và check | [4](04-access-control.md) |
| Dữ liệu khách hàng khác lọt vào | thiếu `tenant_id`, hoặc khoá cache thiếu tenant | [4](04-access-control.md) |
| Gán body vào entity, trường lạ bị ghi | mass assignment | [4](04-access-control.md) |
| 500 khi nhập dấu nháy vào ô tìm kiếm | ghép chuỗi vào SQL | [2](02-injection.md) |
| `ORDER BY` nhận tên cột từ người dùng | phần không tham số hoá được | [2](02-injection.md) |
| Script chạy khi mở nội dung người dùng tạo | `dangerouslySetInnerHTML` / `innerHTML` | [3](03-xss-csrf.md) |
| Hành động xảy ra khi người dùng mở trang lạ | CSRF — thiếu `SameSite` / kiểm tra origin | [3](03-xss-csrf.md) |
| Bất kỳ site nào đọc được API của bạn | CORS phản chiếu origin + credentials | [3](03-xss-csrf.md) |
| Tính năng "nhập từ URL" gọi được địa chỉ nội bộ | SSRF | [5](05-ssrf-supply-chain.md) |
| Credential cloud bị lộ mà không có ai đăng nhập | SSRF tới metadata endpoint | [5](05-ssrf-supply-chain.md) |
| Build khác nhau giữa hai lần chạy cùng commit | ghim theo tag thay vì digest | [5](05-ssrf-supply-chain.md) |
| API key trong log build | `set -x`, hoặc thiếu redact | [6](06-secrets-management.md) |
| Bí mật trong image dù đã `rm` | layer trước vẫn giữ | [6](06-secrets-management.md) |
| Không xoay được credential vì sợ downtime | thiếu cơ chế hai-giá-trị | [6](06-secrets-management.md) |
| Cookie `secure` không được đặt trong production | thiếu `trust proxy` | [7](07-secure-headers-tls.md) |
| Browser OK, `curl` báo lỗi cert | thiếu intermediate | [7](07-secure-headers-tls.md) |
| Cert đã gia hạn mà vẫn hết hạn | thiếu reload | [7](07-secure-headers-tls.md) |
| Rate limit theo IP bị vượt qua | tin `X-Forwarded-For` từ mọi nguồn | [7](07-secure-headers-tls.md) |

## Mười hai quyết định mặc định

```text
Ranh giới dữ liệu
 1. Tham số hoá mọi giá trị; allowlist ánh xạ sang HẰNG SỐ cho tên cột/hướng sắp xếp.
 2. DTO tường minh cho input — không bao giờ gán cả body vào entity.
 3. Escape mặc định của framework; mọi lối thoát khỏi nó là ngoại lệ cần review.

Kiểm soát truy cập
 4. Guard mặc định ĐÓNG; @Public() để mở từng chỗ.
 5. tenant_id + owner_id trong WHERE, một hàm scope dùng cho cả check và list.
 6. 404 thay vì 403 khi sự tồn tại là thông tin.

Trình duyệt
 7. Cookie: HttpOnly + Secure + SameSite=Lax (+ __Host- khi được).
 8. CSP với nonce, không unsafe-inline; frame-ancestors 'none'.
 9. CORS: danh sách origin cụ thể, không bao giờ phản chiếu.

Ra ngoài và vào trong
10. Không cho người dùng chọn đích lời gọi ra ngoài; nếu buộc phải, qua egress proxy.
11. npm ci với lockfile; ghim base image theo digest, Action theo SHA.
12. Bí mật không bao giờ vào git; redact ở tầng logger; cơ chế hai-giá-trị để xoay được.
```

## Ba điều mà công cụ không làm hộ được

```text
① KIỂM SOÁT TRUY CẬP
   Scanner không biết Alice có được xem hoá đơn 8422 hay không.
   → chỉ test đường TỪ CHỐI mới bắt được.

② THIẾT KẾ
   "Tính năng này có nên tồn tại ở dạng này không?"
   → mô hình đe doạ, mười phút, trước khi code.

③ ĐƯỜNG VÒNG
   export · webhook · preview link · endpoint cũ · job nền · hỗ trợ khách hàng
   → chúng không nằm trong tài liệu API mà scanner đọc.
```

Đây cũng là ba nơi các sự cố thực tế trong folder này xảy ra.

## Kiểm tra nhanh trước khi merge

```text
□ Input mới: validate ở BIÊN với kiểu chặt (enum, number), không phải string tự do?
□ Query mới: có tenant_id? điều kiện ownership nằm trong WHERE?
□ Endpoint mới: ẩn danh gọi được không? người dùng khác? tenant khác?
□ Có test cho đường TỪ CHỐI?
□ Hiển thị nội dung người dùng: có escape? nếu dùng HTML thô, đã sanitize ở server?
□ Gọi ra ngoài: URL có do người dùng chọn không? có timeout và giới hạn kích thước?
□ Bí mật mới: có cơ chế xoay? có bị log không?
□ Response: Cache-Control có đúng cho dữ liệu người dùng?
```

## Position

```text
Browser ══║══ API ══║══ Database
        (3,7)     (2,4)
                  ══║══ dịch vụ bên ngoài (5)
CI/CD   ══║══ image ══║══ runtime   (5,6)
```

Mỗi `║` là một ranh giới tin cậy, và số trong ngoặc là note nói về nó.

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Auth](../../02-backend-api/03-auth/README.md) — cơ chế xác thực và uỷ quyền
- [Testing](../testing/README.md) — nơi test authz thuộc về
- [Observability](../observability/README.md) — không phát hiện được nếu không quan sát được
- [Reliability](../reliability/README.md) — DoS và giới hạn tài nguyên
- [04-infrastructure/](../../04-infrastructure/README.md) — tách mạng, TLS, secret ở tầng hạ tầng
- [System design](../../06-system-design/README.md) — bảo mật là yêu cầu phi chức năng

## Version / Context

Khung tham chiếu: OWASP Top 10 (2021), OWASP API Security Top 10 (2023), STRIDE, NIST SP 800-63B. Ví dụ dùng NestJS 10/11, React 18/19, PostgreSQL 16, Docker 24+/BuildKit, Kubernetes 1.29+, Node.js 20+. Toàn bộ nội dung tập trung vào **phòng thủ và mental model**; không có hướng dẫn khai thác.

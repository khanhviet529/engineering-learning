# Web Foundations

Web như một **runtime**, không như một tập API. Mọi thứ trong repo này chạy trên nền tảng mô tả ở đây.

Đọc folder này trước React và Next.js. Lý do: hydration mismatch, CORS error, stale cache và layout shift đều là behavior của **browser**, không của framework. Nếu học framework trước, bạn sẽ đi tìm nguyên nhân trong tài liệu React cho một vấn đề thuộc HTTP.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Browser: từ request tới render](01-browser-request-render.md) | Giữa Enter và pixel có bao nhiêu bước, bước nào chặn bước nào? |
| 2 | [URL → DNS → TCP → TLS](03-url-dns-tcp-tls.md) | `ECONNREFUSED` khác `ETIMEDOUT` ở đâu? |
| 3 | [Rendering pipeline](04-rendering-pipeline.md) | Vì sao `transform` mượt mà `left` thì giật? |
| 4 | [HTTP & browser cache](02-http-browser-cache.md) | Vì sao sửa server mà không thấy gì đổi? |
| 5 | [Cookies & storage](05-cookies-storage.md) | Lưu token ở đâu, và vì sao đó là câu hỏi bảo mật? |
| 6 | [CORS](06-cors.md) | Vì sao `curl` được mà browser bị chặn? |
| 7 | [CSP & browser security](07-csp-browser-security.md) | Khi XSS xảy ra, làm sao giới hạn thiệt hại? |
| 8 | [WebSocket & SSE](08-websocket-sse.md) | Server đẩy dữ liệu xuống client bằng cách nào? |

Note 1–4 là nền cho hiệu năng. Note 5–7 là nền cho bảo mật. Note 8 đọc khi bạn thật sự cần realtime.

## Bốn hiểu nhầm đắt nhất ở tầng này

1. **"Lỗi CORS là lỗi server."** Server chạy đúng; browser chặn việc JS đọc response, sau khi request đã tới server. → [CORS](06-cors.md)
2. **"localStorage an toàn hơn cookie."** Ngược lại với XSS, và XSS nghiêm trọng hơn CSRF. → [Cookies & storage](05-cookies-storage.md)
3. **"`no-cache` nghĩa là không cache."** Nó vẫn lưu, chỉ là phải validate. → [HTTP cache](02-http-browser-cache.md)
4. **"CSS chặn parse HTML."** CSS chặn *render*; `<script>` mới chặn parse. → [Browser request → render](01-browser-request-render.md)

## Position trong xương sống

```text
User → Browser → [DNS → TCP → TLS → HTTP] → Server
          ↑
     toàn bộ folder này
```

## Related

- [01-javascript-typescript/](../01-javascript-typescript/README.md) — ngôn ngữ chạy trong runtime này
- [02-react/](../02-react/README.md) — thư viện UI trên nền này
- [02-backend-api/00-http-api/](../../02-backend-api/00-http-api/README.md) — phía server của cùng giao thức
- [04-infrastructure/01-networking/](../../04-infrastructure/01-networking/README.md) — góc nhìn infrastructure của DNS/TCP/TLS
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md) — đo và tối ưu

# Authentication vs Authorization

**Position:** Browser → HTTP → Backend → Data

Authentication trả lời "ai?"; authorization trả lời "được phép làm gì?". Authorization phải được enforce phía server, không dựa vào việc UI có ẩn nút hay không.

Break: gọi API trực tiếp không qua UI; đổi resource ID; token hết hạn; user khác tenant.

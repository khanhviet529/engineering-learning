# Validation & errors

**Position:** Untrusted input → Backend domain

Validate tại boundary. Tách lỗi input/client, lỗi business và lỗi system. Không leak stack trace/secret ra client.

Experiment: payload thiếu field, sai type, giá trị ngoài business rule, DB unavailable.

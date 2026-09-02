# Delivery Roadmap

Mỗi phase tạo ra một lát cắt sản phẩm chạy được và một failure experiment tương ứng.

| Phase | Product increment | Engineering focus | Done when |
|---|---|---|---|
| 01 | Board local | React state, keys | reorder không làm mất state |
| 02 | Mock async data | race/error/loading | request cũ không ghi đè data mới |
| 03 | API CRUD | HTTP, NestJS, validation | payload sai trả lỗi đúng |
| 04 | Persistent data | PostgreSQL, relations | FK và transaction được kiểm chứng |
| 05 | Real accounts | auth, authorization | user không đọc được project ngoài quyền |
| 06 | Safe collaboration | concurrency, locks | lost update được tái hiện và xử lý |
| 07 | Large project | indexes, pagination | query plan được đo bằng dữ liệu lớn |
| 08 | Reliable async work | Redis, queue, retry | job chạy lại không tạo duplicate effect |
| 09 | Reproducible runtime | Docker Compose | container giao tiếp bằng service name |
| 10 | Operable product | CI, telemetry, K8s | deploy, failure và recovery có bằng chứng |

## Definition of done

Một phase chỉ hoàn thành khi có:

1. feature chạy được;
2. test cho behavior chính;
3. failure experiment có cách tái hiện;
4. note giải thích nguyên nhân và trade-off;
5. screenshot hoặc command output đủ để người đọc kiểm chứng.

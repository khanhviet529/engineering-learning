# Readiness vs liveness

**Position:** Kubernetes ↔ Application health

Readiness: instance có sẵn sàng nhận traffic không? Liveness: process/app có mắc kẹt đến mức nên restart không?

Break: DB unavailable, app khởi động chậm, endpoint deadlock; thiết kế probe sai có thể tạo restart loop hoặc gửi traffic quá sớm.

# Modules & Dependency Injection

**Position:** Application architecture

DI tách việc "cần dependency gì" khỏi "khởi tạo dependency thế nào", giúp test/thay implementation và quản lý lifecycle.

Break: circular dependency, provider không export/import đúng, hidden global state.

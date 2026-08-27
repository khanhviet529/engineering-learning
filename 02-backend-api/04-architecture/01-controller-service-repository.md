# Boundaries trong backend

**Position:** Controller → Service → Data access

Không coi layer là nghi thức. Dùng boundary để cô lập trách nhiệm: transport, business rules, persistence/integration.

Tự hỏi: nếu đổi HTTP thành queue consumer hoặc đổi PostgreSQL implementation, phần business nào cần đổi?

# CI/CD pipeline

**Position:** Git change → build/test → artifact → deploy

Pipeline tối thiểu: install reproducibly, lint, test, build, package, deploy, verify. Mục tiêu là feedback tự động và artifact có thể tái tạo.

Break: dependency không lock, test phụ thuộc thứ tự, secret thiếu, migration fail, deploy thành công nhưng health check fail.

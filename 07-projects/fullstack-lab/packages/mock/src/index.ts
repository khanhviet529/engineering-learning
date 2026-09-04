/**
 * `@flowboard/mock` — mock HTTP dựng từ `@flowboard/contracts`.
 *
 * Mục đích duy nhất: cho frontend chạy và dựng đủ trạng thái UI trước khi
 * backend có endpoint, theo mốc M0.3 của kế hoạch triển khai. Xem
 * [ADR-0012](../../../docs/decisions/ADR-0012-contract-mock-package.md).
 *
 * Ba giới hạn phải nhớ, vì hiểu nhầm chúng là cách nhanh nhất để tin sai:
 *
 * 1. Mock **không** cưỡng chế phân quyền, concurrency hay idempotency. Một
 *    tính năng chỉ chạy đúng trên mock thì chưa chứng minh được gì.
 * 2. Mock **không** giữ trạng thái giữa các request. Nó trả fixture tất định
 *    theo kịch bản được chọn.
 * 3. Mock **không** được deploy và không phải môi trường staging.
 */

export * from "./fixtures.js";
export * from "./responses.js";
export * from "./handlers.js";

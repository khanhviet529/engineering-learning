import type { Permission } from "@flowboard/contracts";

/**
 * `can(action, resource)` — primitive **duy nhất** mà frontend dùng để quyết
 * định affordance.
 *
 * Quy tắc từ [mô hình phân quyền](../../../../../docs/security/authorization-model.md#capabilities-cho-frontend):
 *
 * - Capability do **server tính** cho đúng actor trên đúng resource đó.
 * - Frontend chỉ dùng nó để ẩn hoặc disable control, và để optimistic UI không
 *   thử một action đã biết chắc bị từ chối.
 * - Nó **không bao giờ** thay quyết định của server: mutation vẫn phải xử lý
 *   `403`, `404`, `409`, phiên hết hạn và lỗi mạng.
 *
 * Vì sao nó nằm ở `features/authorization/` chứ không ở `lib/`:
 * [chính sách shared helper](../../../../../docs/engineering/shared-helper-policy.md)
 * ghi rõ `apps/web/src/lib` **không** được chứa capability. Đây là một quyết
 * định sản phẩm có chủ sở hữu, nên nó sống trong feature sở hữu nó và mọi
 * feature khác import từ đây — một canonical owner, không phải một bản sao ở
 * mỗi màn hình.
 */

/**
 * Bất kỳ projection nào server đính capability lên.
 *
 * Ở Phase 1.3 một số resource mang `capabilities` **theo từng record** (ví dụ
 * WorkLog, nơi quyền phụ thuộc status, ngày và tác giả của chính record đó).
 * Hình dạng ở đây cố tình đủ chung để nhận cả hai.
 */
export interface CapabilityHolder {
  capabilities?: readonly Permission[] | undefined;
}

/**
 * Thứ tự resolve, đúng như authorization model quy định:
 *
 * 1. `capabilities` **trên chính projection của resource** khi có — đây là
 *    quyền ở mức record.
 * 2. Nếu không có thì dùng danh sách ở **mức project**.
 *
 * Client **không bao giờ** tự suy lại giá trị này từ role, status, ngày hay
 * tác giả. Làm vậy là nhân bản policy xuống client, điều mà tài liệu cấm.
 */
export function can(
  action: Permission,
  resource: CapabilityHolder | null | undefined,
  projectFallback?: CapabilityHolder | null | undefined,
): boolean {
  const own = resource?.capabilities;
  if (own !== undefined) return own.includes(action);

  const fallback = projectFallback?.capabilities;
  return fallback !== undefined && fallback.includes(action);
}

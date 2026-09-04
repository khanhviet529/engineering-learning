"use client";

import type { ReactNode } from "react";
import { FbSkeleton } from "@flowboard/ui";
import type { ApiFailure } from "../../lib/transport.ts";
import { FailureState } from "./failure-state.tsx";

/**
 * Một vùng dữ liệu với **đủ** ngữ nghĩa trạng thái.
 *
 * [Kiến trúc thông tin](../../../../../docs/design/information-architecture.md)
 * quy định mọi vùng dữ liệu có cùng bộ trạng thái: `Loading`, `Empty`,
 * `Error`, `Forbidden`, `Conflict`. Gom vào một chỗ để không màn hình nào
 * "quên" một nhánh — quên là cách các nhánh lỗi biến mất khỏi sản phẩm.
 *
 * `Empty` cố ý **không** nằm ở đây: chỉ chỗ gọi mới biết rỗng nghĩa là gì
 * ("chưa có gì" khác "không khớp bộ lọc") và CTA nào hợp lệ với capability
 * hiện tại. Trả một Empty chung sẽ nói sai việc cần làm tiếp theo.
 */
export function AsyncSection<T>({
  loading,
  failure,
  data,
  onRetry,
  skeletonLines,
  children,
}: {
  loading: boolean;
  failure: ApiFailure | undefined;
  data: T | undefined;
  onRetry?: (() => void) | undefined;
  skeletonLines?: number;
  children: (data: T) => ReactNode;
}) {
  // Thứ tự quan trọng: trạng thái lỗi **thắng** dữ liệu cũ còn trong cache.
  // Đặc tả tương tác nói rõ — Error, Forbidden, Session expired và Conflict
  // luôn ưu tiên hơn dữ liệu lạc quan hoặc cached của resource liên quan.
  if (failure !== undefined) return <FailureState failure={failure} onRetry={onRetry} />;
  if (loading || data === undefined) return <FbSkeleton lines={skeletonLines ?? 3} />;
  return <>{children(data)}</>;
}

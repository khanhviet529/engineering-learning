"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ApiFailure, ApiResult } from "./transport.ts";

/**
 * Thiết lập TanStack Query cho `apps/web`.
 *
 * Đây là **primitive kỹ thuật** theo
 * [chính sách shared helper](../../../../docs/engineering/shared-helper-policy.md):
 * nó dựng QueryClient và Provider, và không biết Task, Project hay capability
 * nào. Query key, mutation và mapping response thuộc về từng feature.
 */

/**
 * Không tự retry.
 *
 * [Quy ước API](../../../../docs/api/api-conventions.md) cấm client tự retry
 * sau `429` và `409`; và với `403`/`404` thì retry chỉ lặp lại cùng một câu trả
 * lời. Mặc định retry 3 lần của thư viện sẽ biến một lần từ chối thành bốn lần
 * gọi và làm trạng thái lỗi hiện ra chậm gấp mấy lần. Việc thử lại là **hành
 * động của người dùng**, qua nút `Thử lại`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // QueryClient dựng trong state để mỗi cây React có đúng một client, và để
  // client không bị tạo lại ở mỗi lần render.
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Lỗi ném ra từ một `queryFn`, mang nguyên `ApiFailure` đã chuẩn hoá.
 *
 * TanStack Query phân biệt thành công và thất bại bằng việc `queryFn` có ném
 * hay không, còn transport của Flowboard trả `ApiResult` chứ không ném. Lớp
 * mỏng này nối hai quy ước lại **một chỗ**, thay vì mỗi feature tự nghĩ ra
 * cách riêng và rồi mỗi màn hình lại đọc lỗi một kiểu.
 */
export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = "ApiError";
    this.failure = failure;
  }
}

/** Mở `ApiResult` thành giá trị, hoặc ném `ApiError` để Query bắt được. */
export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data;
  throw new ApiError(result);
}

/** Lấy lại `ApiFailure` từ một lỗi bất kỳ mà Query đưa ra. */
export function toFailure(error: unknown): ApiFailure | undefined {
  return error instanceof ApiError ? error.failure : undefined;
}

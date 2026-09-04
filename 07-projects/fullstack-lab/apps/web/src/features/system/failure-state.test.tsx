import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { errorFor, type Scenario } from "@flowboard/mock";
import type { ErrorCode } from "@flowboard/contracts";
import { FailureState, screenForFailure, SystemState } from "./failure-state.tsx";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * Phép ánh xạ lỗi → màn hình là **quyết định bảo mật**, nên nó có test riêng
 * chứ không chỉ được kiểm gián tiếp qua từng màn hình.
 *
 * Điều phải chứng minh, và là điều dễ làm sai nhất: `403` và `404` ra **hai**
 * màn hình khác nhau. Gộp chúng lại sẽ biến câu trả lời cố tình mơ hồ của
 * server thành lời xác nhận rằng resource kia có tồn tại.
 */

function failureWith(code: ErrorCode, status: number): ApiFailure {
  return {
    ok: false,
    status,
    code,
    message: "…",
    requestId: "req-1",
    fieldErrors: [],
  };
}

describe("403 và 404 là hai màn hình khác nhau", () => {
  it("FORBIDDEN ra SYS-01", () => {
    expect(screenForFailure(failureWith("FORBIDDEN", 403))).toBe("SYS-01");
  });

  it("NOT_FOUND ra SYS-05, KHÔNG phải SYS-01", () => {
    const mapped = screenForFailure(failureWith("NOT_FOUND", 404));
    expect(mapped).toBe("SYS-05");
    expect(mapped).not.toBe("SYS-01");
  });

  it("SYS-05 render ra DOM là SYS-05 chứ không phải trang cấm truy cập", () => {
    render(<FailureState failure={failureWith("NOT_FOUND", 404)} />);

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.queryByText("403")).not.toBeInTheDocument();
    // Câu chữ phải nói rõ trang này KHÔNG suy ra thiếu quyền.
    expect(screen.getByText(/không cho biết bạn thiếu quyền/i)).toBeInTheDocument();
  });

  it("SYS-01 nói đúng việc cần làm cho một thành viên thiếu action", () => {
    render(<FailureState failure={failureWith("FORBIDDEN", 403)} />);

    expect(screen.getByText("403")).toBeInTheDocument();
    expect(screen.getByText(/Owner của dự án có thể đổi vai trò cho bạn/i)).toBeInTheDocument();
  });
});

describe("mọi kịch bản lỗi của mock đều có một màn hình xác định", () => {
  const scenarios: Exclude<Scenario, "success">[] = [
    "unauthenticated",
    "forbidden",
    "not-found",
    "validation-failed",
    "version-conflict",
    "idempotency-reused",
    "idempotency-in-progress",
    "column-not-empty",
    "rate-limited",
    "email-verification-required",
    "internal-error",
  ];

  const expected: Record<string, string> = {
    unauthenticated: "SYS-02",
    forbidden: "SYS-01",
    "not-found": "SYS-05",
    "validation-failed": "SYS-03",
    "version-conflict": "SYS-03",
    "idempotency-reused": "SYS-03",
    "idempotency-in-progress": "SYS-03",
    "column-not-empty": "SYS-03",
    "rate-limited": "SYS-03",
    "email-verification-required": "SYS-02",
    "internal-error": "SYS-03",
  };

  for (const scenario of scenarios) {
    it(`${scenario} ra ${expected[scenario] ?? "?"}`, () => {
      const response = errorFor(scenario);
      const body = response.body as { error: { code: ErrorCode } };
      const mapped = screenForFailure(failureWith(body.error.code, response.status));
      expect(mapped).toBe(expected[scenario]);
    });
  }
});

describe("màn hình hệ thống không rò rỉ và nói được việc tiếp theo", () => {
  it("SYS-02 dẫn tới đăng nhập lại, không hứa gửi lại thay đổi", () => {
    render(<SystemState screen="SYS-02" />);

    expect(screen.getByRole("button", { name: "Đăng nhập lại" })).toBeInTheDocument();
    expect(screen.getByText(/sẽ không được tự động gửi lại/i)).toBeInTheDocument();
  });

  it("SYS-03 có nút thử lại khi hành động thử lại được", () => {
    render(<SystemState screen="SYS-03" onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("SYS-01 KHÔNG có nút thử lại — thử lại cùng request cho cùng câu trả lời", () => {
    render(<SystemState screen="SYS-01" onRetry={() => {}} />);
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("requestId hiện ra để người dùng báo lại được", () => {
    render(<SystemState screen="SYS-03" requestId="01JABC" />);
    expect(screen.getByText(/01JABC/)).toBeInTheDocument();
  });

  it("requestId không xác định thì không hiện một dòng vô nghĩa", () => {
    render(<SystemState screen="SYS-03" requestId="unknown" />);
    expect(screen.queryByText(/Mã tra cứu/)).not.toBeInTheDocument();
  });
});

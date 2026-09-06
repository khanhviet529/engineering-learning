import { describe, expect, it } from "vitest";
import { SmtpMailer, type SmtpMailerOptions } from "./mailer.ts";

/**
 * Chỗ cắm provider thật — và ràng buộc đắt hơn "cắm được".
 *
 * Ràng buộc đắt là: **không cắm thì không đổi gì**. Mailpit ở local và CI phải
 * nhận đúng hình dạng transport như trước khi có chỗ cắm này; bằng không, cái
 * giá của việc mở đường cho production là làm hỏng đường của mọi người khác.
 *
 * Test đọc hình dạng transport thay vì gửi thư thật: thứ cần kiểm là **quyết
 * định cấu hình**, và một lần gửi thật sẽ kiểm nodemailer chứ không kiểm quyết
 * định đó.
 */

const base: SmtpMailerOptions = {
  host: "mailpit",
  port: 1025,
  webOrigin: "http://localhost:3000",
  from: "Flowboard <no-reply@flowboard.test>",
};

const shapeOf = (options: SmtpMailerOptions) => new SmtpMailer(options).describeTransport();

describe("không có credential: y hệt hôm nay", () => {
  it("không TLS, không xác thực — đúng hình dạng Mailpit", () => {
    expect(shapeOf(base)).toEqual({ tls: "none", authenticated: false });
  });

  it("`auth: undefined` tường minh cũng là không có credential", () => {
    expect(shapeOf({ ...base, auth: undefined })).toEqual({ tls: "none", authenticated: false });
  });

  it("cổng nào cũng vậy khi chưa có credential — kể cả 465", () => {
    for (const port of [25, 465, 587, 1025, 2525]) {
      expect(shapeOf({ ...base, port }), `cổng ${String(port)}`).toEqual({
        tls: "none",
        authenticated: false,
      });
    }
  });
});

describe("có credential: bật TLS", () => {
  const auth = { user: "apikey", password: "s3cret" };

  /**
   * Cổng submission (587/25/2525) dùng STARTTLS, và nó phải là **bắt buộc**.
   *
   * `requireTLS` chứ không phải "nâng cấp nếu server mời": một server không
   * mời STARTTLS sẽ nhận credential trên kết nối plaintext. Đó là đúng thứ
   * phải chặn, và cách chặn là huỷ kết nối chứ không phải gửi tiếp.
   */
  it("cổng submission → STARTTLS bắt buộc", () => {
    for (const port of [25, 587, 2525]) {
      expect(shapeOf({ ...base, port, auth }), `cổng ${String(port)}`).toEqual({
        tls: "starttls",
        authenticated: true,
      });
    }
  });

  it("cổng 465 → TLS ngầm định", () => {
    expect(shapeOf({ ...base, port: 465, auth })).toEqual({
      tls: "implicit",
      authenticated: true,
    });
  });

  /** Không có cổng nào để credential đi ra mà không được mã hoá. */
  it("không cổng nào cho `tls: none` khi đã có credential", () => {
    for (const port of [25, 465, 587, 1025, 2525]) {
      expect(shapeOf({ ...base, port, auth }).tls, `cổng ${String(port)}`).not.toBe("none");
    }
  });

  /** Cửa đọc dùng để log **không** được mang credential ra ngoài. */
  it("mô tả transport không chứa user hay password", () => {
    const described = JSON.stringify(shapeOf({ ...base, port: 587, auth }));
    expect(described).not.toContain("apikey");
    expect(described).not.toContain("s3cret");
  });
});

describe("From cấu hình được", () => {
  /**
   * `.test` là TLD dành riêng (RFC 2606) — provider thật từ chối nó. Mặc định
   * vẫn là địa chỉ `.test` cũ để local không đổi, nên thứ phải kiểm là **đổi
   * được**, không phải mặc định là gì.
   */
  it("mailer dùng đúng địa chỉ được truyền vào", () => {
    const mailer = new SmtpMailer({ ...base, from: "Flowboard <no-reply@flowboard.example>" });
    expect(mailer.fromAddress).toBe("Flowboard <no-reply@flowboard.example>");
  });

  it("mặc định của hôm nay vẫn dựng được nguyên vẹn", () => {
    expect(new SmtpMailer(base).fromAddress).toBe("Flowboard <no-reply@flowboard.test>");
  });
});

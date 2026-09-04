import { createTransport, type Transporter } from "nodemailer";
import type { Mailer } from "../../modules/auth/application/auth-use-cases.ts";

/**
 * Gửi mail qua SMTP.
 *
 * Ở local và CI, đích là Mailpit: nó bắt thư lại để kiểm tra và **không relay
 * ra Internet**, nên một test chạy sai không gửi thư thật cho ai.
 *
 * Nội dung thư chứa token thô — đó là mục đích của nó. Nhưng token **không**
 * được xuất hiện ở bất kỳ chỗ nào khác: không log, không response, không audit.
 */
export class SmtpMailer implements Mailer {
  readonly #transport: Transporter;
  readonly #webOrigin: string;

  constructor(options: { host: string; port: number; webOrigin: string }) {
    this.#transport = createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      // Mailpit không yêu cầu xác thực; production dùng credential từ secret
      // store, không phải từ code.
      ignoreTLS: true,
    });
    this.#webOrigin = options.webOrigin;
  }

  async sendVerificationEmail(input: { to: string; token: string }): Promise<void> {
    const link = `${this.#webOrigin}/xac-minh-email?token=${encodeURIComponent(input.token)}`;
    await this.#transport.sendMail({
      from: "Flowboard <no-reply@flowboard.test>",
      to: input.to,
      subject: "Xác minh email cho tài khoản Flowboard",
      text: [
        "Chào bạn,",
        "",
        "Nhấn vào liên kết dưới đây để xác minh email và kích hoạt tài khoản Flowboard:",
        link,
        "",
        "Liên kết có hiệu lực trong 24 giờ và chỉ dùng được một lần.",
        "Nếu bạn không tạo tài khoản này, hãy bỏ qua thư.",
      ].join("\n"),
    });
  }

  async sendPasswordResetEmail(input: { to: string; token: string }): Promise<void> {
    const link = `${this.#webOrigin}/dat-lai-mat-khau?token=${encodeURIComponent(input.token)}`;
    await this.#transport.sendMail({
      from: "Flowboard <no-reply@flowboard.test>",
      to: input.to,
      subject: "Đặt lại mật khẩu Flowboard",
      text: [
        "Chào bạn,",
        "",
        "Nhấn vào liên kết dưới đây để đặt lại mật khẩu:",
        link,
        "",
        "Liên kết có hiệu lực trong 1 giờ và chỉ dùng được một lần.",
        "Đặt lại mật khẩu sẽ đăng xuất mọi thiết bị đang đăng nhập.",
        "Nếu bạn không yêu cầu việc này, hãy bỏ qua thư — mật khẩu hiện tại không đổi.",
      ].join("\n"),
    });
  }

  async close(): Promise<void> {
    this.#transport.close();
  }
}

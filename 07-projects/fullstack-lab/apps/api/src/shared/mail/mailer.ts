import { createTransport, type Transporter } from "nodemailer";
import { webRouteWithToken } from "@flowboard/contracts";
import type { Mailer } from "./mailer.port.ts";

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
    const link = webRouteWithToken(this.#webOrigin, "emailVerify", input.token);
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
    const link = webRouteWithToken(this.#webOrigin, "passwordReset", input.token);
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

  /**
   * Thư mời vào workspace.
   *
   * Khác hai thư kia ở một điểm quyết định nội dung: người nhận **có thể chưa
   * từng nghe về Flowboard**. Với họ, một thư chỉ có link là một thư đáng ngờ —
   * và đáng ngờ là phản ứng đúng. Nên thư này nói đủ ba thứ để họ tự quyết:
   * ai mời, mời vào đâu, và họ có thể bỏ qua.
   *
   * Không có gì trong thư tiết lộ rằng địa chỉ này đã có account hay chưa: cùng
   * một nội dung đi tới cả hai loại người nhận. Việc phân biệt sẽ làm hỏng
   * chính điều mà ADR-0013 dựng ra để bảo vệ.
   */
  async sendWorkspaceInvitationEmail(input: {
    to: string;
    token: string;
    workspaceName: string;
    invitedByName: string;
  }): Promise<void> {
    const link = webRouteWithToken(this.#webOrigin, "invitationAccept", input.token);
    await this.#transport.sendMail({
      from: "Flowboard <no-reply@flowboard.test>",
      to: input.to,
      subject: `${input.invitedByName} mời bạn vào không gian làm việc ${input.workspaceName}`,
      text: [
        "Chào bạn,",
        "",
        `${input.invitedByName} đã mời bạn tham gia không gian làm việc "${input.workspaceName}" trên Flowboard.`,
        "",
        "Nhấn vào liên kết dưới đây để xem và chấp nhận lời mời:",
        link,
        "",
        "Bạn cần đăng nhập bằng chính địa chỉ email này để chấp nhận.",
        "Nếu bạn chưa có tài khoản Flowboard: hãy đăng ký, xác minh email,",
        "rồi quay lại thư này và nhấn lại liên kết trên — nó vẫn còn hiệu lực.",
        "",
        "Liên kết có hiệu lực trong 7 ngày và chỉ dùng được một lần.",
        "Nếu bạn không mong đợi lời mời này, hãy bỏ qua thư — không có gì thay đổi.",
      ].join("\n"),
    });
  }

  async close(): Promise<void> {
    this.#transport.close();
  }
}

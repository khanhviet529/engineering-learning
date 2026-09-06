import { createTransport, type Transporter } from "nodemailer";
import { webRouteWithToken } from "@flowboard/contracts";
import type { Mailer } from "./mailer.port.ts";

/** Cổng SMTP dùng TLS ngầm định (SMTPS). Mọi cổng khác dùng STARTTLS. */
const IMPLICIT_TLS_PORT = 465;

export interface SmtpMailerOptions {
  host: string;
  port: number;
  webOrigin: string;
  /** Địa chỉ `From`. Người gọi luôn truyền; mặc định nằm ở `env.ts`. */
  from: string;
  /**
   * Credential. **Không có** thì transport giữ nguyên hình dạng Mailpit:
   * không TLS, không xác thực.
   */
  auth?: { user: string; password: string } | undefined;
}

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
  readonly #from: string;

  /**
   * Hai hình dạng transport, và ranh giới giữa chúng là **có credential hay
   * không** — không phải `NODE_ENV`.
   *
   * | | Không credential | Có credential |
   * |---|---|---|
   * | `secure` | `false` | `true` ở cổng 465, `false` ở cổng khác |
   * | TLS | `ignoreTLS: true` | `requireTLS: true` khi không phải 465 |
   * | `auth` | không đặt | user + pass |
   *
   * `requireTLS` chứ không phải "thử STARTTLS nếu server mời": một server
   * không mời STARTTLS sẽ nhận credential trên kết nối **plaintext**, và đó là
   * đúng thứ cần chặn. Với `requireTLS`, nodemailer **huỷ** kết nối thay vì
   * hạ cấp im lặng.
   *
   * Vì sao ranh giới không phải `NODE_ENV`: một môi trường staging đặt
   * `NODE_ENV=production` nhưng vẫn trỏ Mailpit sẽ không kết nối được, và một
   * môi trường quên đặt `NODE_ENV` sẽ gửi credential không mã hoá. Điều kiện
   * đúng là thứ đang thực sự có mặt.
   */
  constructor(options: SmtpMailerOptions) {
    const auth = options.auth;
    const implicitTls = options.port === IMPLICIT_TLS_PORT;

    this.#transport = createTransport(
      auth === undefined
        ? {
            host: options.host,
            port: options.port,
            secure: false,
            // Mailpit không yêu cầu xác thực và không nói STARTTLS.
            ignoreTLS: true,
          }
        : {
            host: options.host,
            port: options.port,
            secure: implicitTls,
            ...(implicitTls ? {} : { requireTLS: true }),
            auth: { user: auth.user, pass: auth.password },
          },
    );
    this.#webOrigin = options.webOrigin;
    this.#from = options.from;
  }

  /**
   * Mô tả transport để log và để kiểm — **không bao giờ** mang credential.
   *
   * Trả về hình dạng đã quyết định (`tls`, `authenticated`) chứ không trả cả
   * object options: một cửa đọc trả `options` sẽ trả luôn `auth.pass`, và một
   * dòng log tiện tay in nó ra là một lần rò secret. Cùng quy tắc với
   * `ConfigError`: nói **tên** và **hình dạng**, không nói giá trị.
   */
  describeTransport(): { tls: "none" | "starttls" | "implicit"; authenticated: boolean } {
    const options = this.#transport.options as {
      secure?: boolean;
      requireTLS?: boolean;
      auth?: unknown;
    };
    const tls =
      options.secure === true ? "implicit" : options.requireTLS === true ? "starttls" : "none";
    return { tls, authenticated: options.auth !== undefined };
  }

  /** Địa chỉ `From` đang dùng. Không phải secret; nó nằm trong mọi lá thư gửi đi. */
  get fromAddress(): string {
    return this.#from;
  }

  async sendVerificationEmail(input: { to: string; token: string }): Promise<void> {
    const link = webRouteWithToken(this.#webOrigin, "emailVerify", input.token);
    await this.#transport.sendMail({
      from: this.#from,
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
      from: this.#from,
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
      from: this.#from,
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

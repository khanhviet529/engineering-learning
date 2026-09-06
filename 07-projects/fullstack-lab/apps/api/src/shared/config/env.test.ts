import { describe, expect, it } from "vitest";
import { ConfigError, ENV_KEYS, loadEnv, RENAMED_KEYS } from "./env.ts";

const valid = {
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://flowboard:local@localhost:5432/flowboard",
  CURSOR_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
};

describe("cấu hình fail fast", () => {
  it("nhận môi trường hợp lệ và áp default", () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("dừng khi thiếu biến bắt buộc, và nêu tên biến", () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    try {
      loadEnv(rest);
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).invalidKeys).toContain("DATABASE_URL");
    }
  });

  it("thông báo lỗi KHÔNG chứa giá trị của biến", () => {
    const secret = "gia-tri-bi-mat-khong-duoc-lo-ra-log";
    try {
      loadEnv({ ...valid, CURSOR_SECRET: "qua-ngan", DATABASE_URL: secret });
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CURSOR_SECRET");
      expect(message).not.toContain(secret);
      expect(message).not.toContain("qua-ngan");
    }
  });

  it("từ chối secret quá ngắn", () => {
    expect(() => loadEnv({ ...valid, CSRF_SECRET: "ngan" })).toThrow(ConfigError);
  });

  it("bỏ qua biến môi trường lạ thay vì nạp bừa", () => {
    const env = loadEnv({ ...valid, SOMETHING_ELSE: "x" });
    expect(Object.keys(env)).not.toContain("SOMETHING_ELSE");
  });
});

/**
 * Biến rỗng là **không có**, không phải "có, giá trị rỗng".
 *
 * Không phải chuyện thẩm mỹ: `compose.yaml` viết `${SMTP_USER:-}` để Compose
 * khỏi cảnh báo biến chưa đặt, và `.env.example` viết `SMTP_USER=` để nói
 * "chưa dùng". Cả hai vào process là `""`. Nếu `""` được coi là một giá trị,
 * mọi môi trường local sẽ chết ở `ConfigError` ngay lần dựng đầu.
 */
describe("chuỗi rỗng được coi là chưa đặt", () => {
  it("biến optional bỏ trống không làm hỏng khởi động", () => {
    const env = loadEnv({
      ...valid,
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      CURSOR_SECRET_PREVIOUS: "",
      CSRF_SECRET_PREVIOUS: "",
      RATE_LIMIT_OVERRIDES: "",
    });
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.CURSOR_SECRET_PREVIOUS).toBeUndefined();
  });

  it("biến có default bỏ trống vẫn nhận default", () => {
    expect(loadEnv({ ...valid, MAIL_FROM: "", LOG_LEVEL: "" }).MAIL_FROM).toBe(
      "Flowboard <no-reply@flowboard.test>",
    );
  });

  /** Tên cũ để rỗng **không** được tính là "đang dùng tên cũ". */
  it("tên cũ rỗng không sinh cảnh báo và không ghi đè tên mới", () => {
    const warnings: string[] = [];
    const env = loadEnv({ ...valid, SESSION_SECRET: "" }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(env.CURSOR_SECRET).toBe(valid.CURSOR_SECRET);
  });

  it("biến bắt buộc để rỗng vẫn là thiếu, và nêu đúng tên", () => {
    try {
      loadEnv({ ...valid, CURSOR_SECRET: "" });
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      expect((error as ConfigError).invalidKeys).toContain("CURSOR_SECRET");
    }
  });
});

/**
 * Đổi tên `SESSION_SECRET` → `CURSOR_SECRET`, và đường tương thích ngược.
 *
 * Đây là một thay đổi **vận hành**: mọi môi trường đang chạy đều đặt tên cũ.
 * Bộ test này canh đúng một điều — trong khoảng chuyển tiếp, một môi trường
 * chưa kịp đổi vẫn khởi động được, và nó **được nói cho biết** phải đổi sang
 * gì. Bỏ mất một trong hai nửa đó là bỏ mất cả lý do có khoảng chuyển tiếp.
 */
describe("tên biến cũ vẫn nhận, kèm cảnh báo", () => {
  /** `valid` đã dùng tên mới; bản này chỉ có tên cũ, đúng hình dạng môi trường chưa đổi. */
  const legacyOnly = (() => {
    const { CURSOR_SECRET, ...rest } = valid;
    return { ...rest, SESSION_SECRET: CURSOR_SECRET };
  })();

  it("chỉ có tên cũ: vẫn khởi động được, và giá trị đi đúng chỗ", () => {
    const warnings: string[] = [];
    const env = loadEnv(legacyOnly, { warn: (m) => warnings.push(m) });

    expect(env.CURSOR_SECRET).toBe(valid.CURSOR_SECRET);
    expect(warnings).toHaveLength(1);
    // Cảnh báo phải nói **đổi sang tên gì**, không chỉ "biến này cũ".
    expect(warnings[0]).toContain("SESSION_SECRET → CURSOR_SECRET");
    // Và không bao giờ mang giá trị.
    expect(warnings[0]).not.toContain(valid.CURSOR_SECRET);
  });

  it("`_PREVIOUS` của tên cũ cũng đi theo, và vẫn chỉ **một** cảnh báo", () => {
    const warnings: string[] = [];
    const env = loadEnv(
      { ...legacyOnly, SESSION_SECRET_PREVIOUS: "z".repeat(32) },
      { warn: (m) => warnings.push(m) },
    );

    expect(env.CURSOR_SECRET_PREVIOUS).toBe("z".repeat(32));
    expect(warnings, "hai dòng cho cùng một việc là hai dòng bị bỏ qua").toHaveLength(1);
    expect(warnings[0]).toContain("SESSION_SECRET_PREVIOUS → CURSOR_SECRET_PREVIOUS");
  });

  it("có cả hai: tên mới thắng", () => {
    const env = loadEnv({ ...valid, SESSION_SECRET: "cu".repeat(16) }, { warn: () => undefined });
    expect(env.CURSOR_SECRET).toBe(valid.CURSOR_SECRET);
  });

  /**
   * Có cả hai **với giá trị khác nhau** thì tên cũ bị bỏ — nhưng không im lặng.
   * Người vận hành đặt một giá trị và server dùng giá trị khác là đúng loại
   * chênh lệch làm người ta tin mình đã xoay key trong khi chưa.
   */
  it("có cả hai và khác giá trị: nói ra rằng tên cũ bị bỏ qua", () => {
    const warnings: string[] = [];
    loadEnv({ ...valid, SESSION_SECRET: "cu".repeat(16) }, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SESSION_SECRET");
    expect(warnings[0]).toContain("CURSOR_SECRET");
    expect(warnings[0]).not.toContain("cu".repeat(16));
  });

  it("chỉ tên mới: không cảnh báo gì", () => {
    const warnings: string[] = [];
    loadEnv(valid, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  /** Tên cũ **không** được là một key của schema — nếu còn, việc đổi tên chưa xong. */
  it("tên cũ không còn nằm trong schema", () => {
    for (const { from, to } of RENAMED_KEYS) {
      expect(ENV_KEYS, from).not.toContain(from);
      expect(ENV_KEYS, to).toContain(to);
    }
  });
});

/**
 * Ba chỗ cắm cho email provider thật.
 *
 * Điều kiện đắt nhất ở đây không phải "cắm được", mà là **không cắm thì không
 * đổi gì**: Mailpit ở local và CI phải chạy y hệt hôm nay.
 */
describe("chỗ cắm SMTP provider", () => {
  it("không có credential thì cấu hình y như trước", () => {
    const env = loadEnv(valid);
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SMTP_PASSWORD).toBeUndefined();
    expect(env.MAIL_FROM).toBe("Flowboard <no-reply@flowboard.test>");
  });

  it("có đủ cặp credential thì nhận", () => {
    const env = loadEnv({ ...valid, SMTP_USER: "apikey", SMTP_PASSWORD: "s3cret" });
    expect(env.SMTP_USER).toBe("apikey");
    expect(env.SMTP_PASSWORD).toBe("s3cret");
  });

  it("nửa cặp credential là ConfigError, không phải gửi không xác thực", () => {
    for (const [half, missing] of [
      [{ SMTP_USER: "apikey" }, "SMTP_PASSWORD"],
      [{ SMTP_PASSWORD: "s3cret" }, "SMTP_USER"],
    ] as const) {
      try {
        loadEnv({ ...valid, ...half });
        expect.unreachable(`phải ném ConfigError khi thiếu ${missing}`);
      } catch (error) {
        expect(error, missing).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).invalidKeys).toContain(missing);
      }
    }
  });

  it("thông báo lỗi cặp credential không mang giá trị", () => {
    try {
      loadEnv({ ...valid, SMTP_PASSWORD: "mat-khau-that-cua-provider" });
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      expect((error as Error).message).not.toContain("mat-khau-that-cua-provider");
    }
  });

  it("MAIL_FROM đổi được để rời khỏi TLD `.test`", () => {
    const env = loadEnv({ ...valid, MAIL_FROM: "Flowboard <no-reply@flowboard.example>" });
    expect(env.MAIL_FROM).toBe("Flowboard <no-reply@flowboard.example>");
  });
});

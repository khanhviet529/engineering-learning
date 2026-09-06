import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_KEYS, REQUIRED_ENV_KEYS, RENAMED_KEYS } from "../shared/config/env.ts";

/**
 * `.env.production.example` phải nói đúng thứ `envSchema` đòi.
 *
 * ## Vì sao đây là một test chứ không phải một mục trong tài liệu
 *
 * Câu hỏi mà việc 3 đặt ra là: *cần gì để một người deploy làm đúng mà không
 * phải đọc bốn tài liệu?* Câu trả lời rẻ nhất là một danh sách tên biến. Nhưng
 * một danh sách chép tay sẽ trôi khỏi schema, và dự án này đã bị đúng kiểu
 * trôi đó cắn: `tokens.css` là file **được sinh ra** và ship màu cũ qua hai
 * commit vì không ai chạy lại bộ sinh.
 *
 * Nên danh sách này được **so với schema**, không được tin. Thêm một biến vào
 * `envSchema` mà quên file kia thì test đỏ, và thông điệp nói đúng tên biến.
 *
 * Cùng lối `check-config-boundary.mjs` đọc `package.json` trên đĩa: kiểm
 * **thực tại**, không kiểm một hằng số song song.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const templatePath = join(repoRoot, ".env.production.example");
const template = readFileSync(templatePath, "utf8");

/** Dòng khai biến: `TÊN=` và **không có gì** sau dấu bằng. */
const ASSIGNMENT = /^([A-Z0-9_]+)=(.*)$/;

const lines = template.split(/\r?\n/);
const assignments = lines
  .map((line, index) => ({ line, index }))
  .filter(({ line }) => line.trim().length > 0 && !line.trimStart().startsWith("#"))
  .map(({ line, index }) => ({ match: ASSIGNMENT.exec(line), line, index }));

describe(".env.production.example khớp envSchema", () => {
  it("mọi dòng không phải chú thích đều là một khai báo biến hợp lệ", () => {
    const bad = assignments.filter((entry) => entry.match === null);
    expect(
      bad.map((entry) => `dòng ${String(entry.index + 1)}: ${entry.line}`),
      "file chỉ được chứa chú thích và dòng dạng TÊN=",
    ).toEqual([]);
  });

  /**
   * **Không giá trị nào**, kể cả placeholder.
   *
   * Đây là ràng buộc bảo mật, không phải hình thức: một template có chỗ điền là
   * một template người ta điền tại chỗ, rồi `git add -A` một hôm nào đó. Giữ nó
   * rỗng bằng một phép kiểm nghĩa là không có đường để giá trị bò vào.
   */
  it("không dòng nào mang giá trị", () => {
    const withValue = assignments
      .filter((entry) => entry.match !== null && entry.match[2] !== "")
      .map((entry) => `dòng ${String(entry.index + 1)}: ${entry.line}`);
    expect(withValue, "template chỉ chứa TÊN, không chứa giá trị").toEqual([]);
  });

  it("liệt kê đúng tập biến mà schema biết — không thiếu, không thừa", () => {
    const listed = assignments
      .map((entry) => entry.match?.[1])
      .filter((name): name is string => name !== undefined)
      .sort();

    expect(listed, "thiếu trong template").toEqual([...ENV_KEYS].sort());
  });

  it("không có tên trùng", () => {
    const listed = assignments
      .map((entry) => entry.match?.[1])
      .filter((name): name is string => name !== undefined);
    expect(listed.length).toBe(new Set(listed).size);
  });

  /**
   * Tên **cũ** không được xuất hiện.
   *
   * Khoảng chuyển tiếp tồn tại cho môi trường **đang chạy**, không cho môi
   * trường mới. Một người dựng production hôm nay mà chép tên cũ từ template
   * sẽ nhận cảnh báo suốt đời môi trường đó, vì lý do do chính chúng ta gieo.
   */
  it("template không dạy tên biến đã bỏ", () => {
    for (const { from } of RENAMED_KEYS) {
      expect(template, `${from} là tên cũ, không được có trong template`).not.toContain(
        `\n${from}=`,
      );
    }
  });

  /** Biến bắt buộc phải được đánh dấu, nếu không danh sách này không giúp được ai. */
  it("mọi biến bắt buộc nằm dưới mục “Bắt buộc”", () => {
    const requiredSection = template.slice(
      template.indexOf("# --- Bắt buộc"),
      template.indexOf("# --- Tuỳ chọn"),
    );
    expect(requiredSection.length, "không tìm thấy mục Bắt buộc").toBeGreaterThan(0);
    for (const key of REQUIRED_ENV_KEYS) {
      expect(requiredSection, key).toContain(`\n${key}=`);
    }
  });
});

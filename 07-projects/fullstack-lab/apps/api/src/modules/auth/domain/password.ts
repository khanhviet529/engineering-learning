import { hash, verify } from "@node-rs/argon2";
import { BLOCKLIST_VERSION, isBlockedPassword } from "./password-blocklist.ts";

/**
 * Chính sách mật khẩu — [ADR-0007](../../../../../docs/decisions/ADR-0007-password-policy.md),
 * bám NIST SP 800-63B.
 *
 * Điều quan trọng nhất ở đây là thứ **không** có: không yêu cầu composition,
 * không rotation định kỳ, không password hint, không câu hỏi bảo mật. Những
 * quy tắc đó đẩy người dùng về phía mật khẩu dễ đoán theo khuôn mẫu, và bằng
 * chứng đã đủ để bỏ chúng.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * NFKC được áp **giống hệt nhau** ở sign-up, reset và sign-in.
 *
 * Nếu hai đầu normalize khác nhau, một mật khẩu chứa ký tự dựng sẵn — rất
 * thường gặp với tiếng Việt gõ bằng bộ gõ — sẽ đăng nhập được lúc này và không
 * được lúc khác, mà không ai giải thích nổi tại sao. Vì vậy đây là **một** hàm,
 * và mọi đường đi credential đều gọi nó.
 */
export function normalizePassword(raw: string): string {
  return raw.normalize("NFKC");
}

/** Lý do từ chối, đủ để dựng field error mà không tiết lộ đã khớp danh sách nào. */
export type PasswordRejection =
  | { kind: "too_short" }
  | { kind: "too_long" }
  | { kind: "contains_identity" }
  | { kind: "blocked" };

export interface PasswordIdentity {
  email: string;
  displayName: string;
}

/** Chuỗi con từ bốn ký tự trở lên mới tính là "chứa" — ba ký tự thì trùng ngẫu nhiên quá dễ. */
const MIN_IDENTITY_FRAGMENT = 4;

/**
 * Mật khẩu không được chứa local-part của email hay display name của chính
 * account đó, không phân biệt hoa thường.
 *
 * Kiểm cả hai chiều: mật khẩu chứa danh tính, và danh tính chứa mật khẩu. Chiều
 * thứ hai bắt trường hợp display name ngắn nằm gọn trong một mật khẩu dài.
 */
function containsIdentity(normalizedLower: string, identity: PasswordIdentity): boolean {
  const localPart = identity.email.split("@")[0] ?? "";
  const fragments = [localPart, identity.displayName]
    .flatMap((value) =>
      value
        .normalize("NFKC")
        .toLowerCase()
        .split(/[\s._-]+/),
    )
    .filter((fragment) => fragment.length >= MIN_IDENTITY_FRAGMENT);

  return fragments.some((fragment) => normalizedLower.includes(fragment));
}

/**
 * Đánh giá mật khẩu theo chính sách.
 *
 * Trả về **danh sách** lý do chứ không phải lý do đầu tiên, để UI hiển thị được
 * đủ vấn đề trong một lần submit thay vì bắt người dùng sửa từng cái một.
 */
export function evaluatePassword(raw: string, identity: PasswordIdentity): PasswordRejection[] {
  const normalized = normalizePassword(raw);
  const rejections: PasswordRejection[] = [];

  // Đếm theo **code point**, không theo UTF-16 code unit: một emoji hay một ký
  // tự ngoài BMP là một ký tự với người dùng nhưng là hai đơn vị với `.length`.
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) rejections.push({ kind: "too_short" });
  if (length > PASSWORD_MAX_LENGTH) rejections.push({ kind: "too_long" });

  const lower = normalized.toLowerCase();
  if (containsIdentity(lower, identity)) rejections.push({ kind: "contains_identity" });
  if (isBlockedPassword(lower)) rejections.push({ kind: "blocked" });

  return rejections;
}

/**
 * Tham số Argon2id.
 *
 * `memoryCost` 19 MiB và `timeCost` 2 là cấu hình tối thiểu mà OWASP khuyến
 * nghị cho Argon2id. Tăng chúng làm chậm chính đường đăng nhập của người dùng
 * thật, nên đây là đánh đổi cần đo trước khi đổi, không phải con số để nâng cho
 * yên tâm.
 */
/**
 * `@node-rs/argon2` khai `Algorithm` là **ambient const enum**, mà cờ
 * `verbatimModuleSyntax` không cho phép đọc: TypeScript sẽ phải nội suy giá trị
 * lúc biên dịch, điều mà chế độ biên dịch từng file không làm được.
 *
 * Giá trị `2` là `Argon2id`, lấy từ chính khai báo của thư viện. Đây là số
 * trần nên nó được kiểm bằng test: hash sinh ra phải bắt đầu bằng `$argon2id$`.
 * Nếu thư viện đổi ánh xạ, test đổ ngay thay vì âm thầm hạ xuống argon2i.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Băm mật khẩu.
 *
 * Giá trị **không bao giờ bị truncate** trước khi băm: cắt bớt sẽ làm hai mật
 * khẩu khác nhau trở thành một, và người dùng không hề biết.
 */
export async function hashPassword(raw: string): Promise<string> {
  return hash(normalizePassword(raw), ARGON2_OPTIONS);
}

/**
 * Kiểm mật khẩu.
 *
 * Trả `false` khi hash hỏng thay vì ném lỗi: một bản ghi hỏng không được biến
 * thành `500` để lộ rằng account đó tồn tại và có gì đó bất thường.
 */
export async function verifyPassword(storedHash: string, raw: string): Promise<boolean> {
  try {
    return await verify(storedHash, normalizePassword(raw));
  } catch {
    return false;
  }
}

/** Ghi kèm audit khi từ chối, để tra được vì sao một mật khẩu bị chặn. */
export const PASSWORD_POLICY_VERSION = BLOCKLIST_VERSION;

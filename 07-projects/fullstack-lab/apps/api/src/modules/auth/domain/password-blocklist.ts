/**
 * Blocklist mật khẩu — ADR-0007.
 *
 * Hai ràng buộc đến từ hợp đồng, và cả hai đều có lý do cụ thể:
 *
 * 1. **Bundle có version.** Khi danh sách đổi, `BLOCKLIST_VERSION` đổi theo, nên
 *    một mật khẩu bị từ chối hôm nay mà chấp nhận hôm qua là chuyện tra được,
 *    không phải chuyện bí ẩn.
 * 2. **Không có lượt tra nào đi ra khỏi process.** Gửi mật khẩu người dùng —
 *    kể cả một phần hash của nó — sang dịch vụ ngoài trên đường sign-up là thêm
 *    một bên thứ ba vào đường đi của credential. Đổi lại, danh sách nhỏ hơn
 *    danh sách online.
 *
 * Danh sách dưới đây là hạt giống có chủ đích: những mật khẩu đứng đầu mọi bảng
 * xếp hạng rò rỉ, cộng các biến thể mà người Việt hay dùng. Nó **không** thay
 * được một bundle rò rỉ đầy đủ; mở rộng nó là việc vận hành, và điều kiện xem
 * lại nằm trong ADR-0007.
 */

export const BLOCKLIST_VERSION = "2026-09-04.seed";

/**
 * So khớp sau khi normalize NFKC và hạ chữ thường, nên không cần liệt kê biến
 * thể hoa thường.
 */
const ENTRIES: readonly string[] = [
  // Phổ biến toàn cầu
  "password",
  "password1",
  "password123",
  "passw0rd",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "abc123",
  "iloveyou",
  "admin",
  "administrator",
  "welcome",
  "welcome1",
  "letmein",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "trustno1",
  "changeme",
  "secret",
  "master",
  "shadow",
  "michael",
  "jennifer",
  "starwars",
  "whatever",
  "zaq12wsx",
  "1qaz2wsx",
  "asdfghjkl",
  "11111111",
  "00000000",

  // Hay gặp trong ngữ cảnh Việt Nam
  "matkhau",
  "matkhau123",
  "vietnam",
  "vietnam123",
  "hanoi123",
  "saigon123",
  "khongbiet",
  "toiyeuban",
  "anhyeuem",
  "emyeuanh",
  "chaobanminh",

  // Liên quan tới chính sản phẩm — dễ bị chọn vì tiện tay
  "flowboard",
  "flowboard1",
  "flowboard123",
];

const BLOCKED = new Set(ENTRIES);

/**
 * Mật khẩu bị chặn khi trùng một mục trong danh sách, **hoặc** khi bỏ hết chữ
 * số ở cuối rồi vẫn trùng.
 *
 * Lý do có nhánh thứ hai: `password2026` và `qwerty99` không nằm trong danh
 * sách nhưng mạnh ngang `password`, và thêm số ở cuối là cách né phổ biến nhất.
 */
export function isBlockedPassword(normalizedLowercase: string): boolean {
  if (BLOCKED.has(normalizedLowercase)) return true;
  const withoutTrailingDigits = normalizedLowercase.replace(/\d+$/, "");
  return withoutTrailingDigits.length >= 4 && BLOCKED.has(withoutTrailingDigits);
}

export const BLOCKLIST_SIZE = BLOCKED.size;

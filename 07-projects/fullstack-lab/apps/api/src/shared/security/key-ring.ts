/**
 * Xoay secret **mà không đá ai ra** — HMAC key có thời hạn chồng nhau.
 *
 * ## Vấn đề thật, sau khi đo lại thay vì tin phát biểu ban đầu
 *
 * Câu hỏi đặt ra là "đổi `SESSION_SECRET` thì mọi session chết". Đọc code cho
 * thấy **không phải vậy**, và khác biệt đó đổi cả thiết kế:
 *
 * | Secret | Ký cái gì | Đổi key thì sao |
 * |---|---|---|
 * | `SESSION_SECRET` | **Cursor phân trang** (`shared/http/cursor.ts`) | Cursor đang mở chết → `400`, client về trang đầu |
 * | `CSRF_SECRET` | CSRF token, là HMAC của session token | **Mọi mutation từ tab đang mở hỏng** `403` cho tới khi client đọc lại token |
 * | (không có) | **Session token** | Không ký gì cả: token là 32 byte ngẫu nhiên, database giữ SHA-256 của nó |
 *
 * Session sống sót qua mọi lần xoay key, vì nó không được ký bằng key nào. Thứ
 * thật sự đau là `CSRF_SECRET`: người dùng đang mở tab bấm Lưu và nhận `403`.
 *
 * ## Hình dạng: **một biến `*_PREVIOUS` cho mỗi secret**
 *
 * Ký bằng key hiện hành, verify bằng **cả hai** trong suốt cửa sổ xoay. Ba
 * phương án đã cân nhắc:
 *
 * | Phương án | Ưu | Vì sao không chọn |
 * |---|---|---|
 * | `*_PREVIOUS` (chọn) | Nhỏ nhất; không đổi hình dạng token; hai biến optional, mất chúng thì hành vi y như trước | Verify tốn gấp đôi ở trường hợp xấu nhất; không phân biệt được token ký bằng key nào nếu chỉ nhìn nó |
 * | Danh sách `CSRF_SECRETS="new,old,older"` | N key cùng lúc | Dấu phẩy là ký tự hợp lệ trong secret; và N key cùng hiệu lực nghĩa là N key cùng phải bị coi là còn sống |
 * | `kid` trong token | Verify O(1); biết ngay token thuộc thế hệ nào | Đổi **hình dạng token** mà client đang lưu và gửi lại — một thay đổi hợp đồng cho một tiện ích vận hành. Với đúng hai key, O(2) là hai phép HMAC |
 *
 * ## Đánh đổi phải nói ra
 *
 * 1. **Key cũ còn hiệu lực đúng bằng khoảng thời gian người vận hành để biến đó
 *    lại.** Không cơ chế nào đóng cửa sổ hộ; đó là một bước con người, và quên
 *    nó nghĩa là key cũ sống mãi. Đây là cái giá của việc không có `kid`.
 * 2. **Verify tốn tối đa hai phép HMAC** thay vì một. Với SHA-256 trên vài chục
 *    byte, đó là chi phí không đo được so với một lượt đi database.
 * 3. Một token giả sẽ luôn tốn **cả hai** phép thử. Chấp nhận được: chi phí đó
 *    có biên và không phụ thuộc dữ liệu người gửi.
 *
 * ## Bù lại điều mà `kid` sẽ cho: **một bộ đếm**
 *
 * Không có `kid` thì không nhìn một token mà biết nó thuộc thế hệ nào — nhưng
 * **server** biết, ngay lúc verify. `previousKeyHits` đếm số lần key cũ là thứ
 * cứu một request. Người vận hành đọc nó để trả lời đúng câu hỏi khiến họ do
 * dự: *"đóng cửa sổ được chưa?"*. Bằng không trong vài giờ nghĩa là được.
 */

export interface KeyRingSource {
  /** Key hiện hành: **mọi** giá trị mới được ký bằng nó. */
  current: string;
  /** Key của thế hệ trước, còn được chấp nhận trong cửa sổ xoay. */
  previous?: string | undefined;
}

/**
 * Một bộ key cho **một** mục đích ký.
 *
 * Mỗi mục đích có bộ riêng: dùng chung một bộ cho cursor và CSRF sẽ làm một
 * lần xoay vì lý do của bên này kéo theo cửa sổ xoay của bên kia.
 */
export class KeyRing {
  readonly #keys: readonly string[];
  readonly #label: string;
  #previousHits = 0;

  constructor(label: string, source: KeyRingSource) {
    if (source.current.length < 32) {
      throw new Error(`${label}: key hiện hành quá ngắn.`);
    }
    if (source.previous !== undefined && source.previous.length < 32) {
      throw new Error(`${label}: key trước đó quá ngắn.`);
    }
    /**
     * Key cũ **trùng** key mới không phải lỗi, nhưng cũng không có nghĩa gì:
     * gộp lại để bộ đếm không báo động giả suốt một cửa sổ xoay không tồn tại.
     */
    this.#keys =
      source.previous === undefined || source.previous === source.current
        ? [source.current]
        : [source.current, source.previous];
    this.#label = label;
  }

  /** Key dùng để **ký**. Luôn là key hiện hành, không bao giờ là key cũ. */
  get signingKey(): string {
    return this.#keys[0] as string;
  }

  /** Có đang ở trong một cửa sổ xoay không? */
  get rotating(): boolean {
    return this.#keys.length > 1;
  }

  get label(): string {
    return this.#label;
  }

  /**
   * Số lần key **cũ** là thứ khiến một phép verify thành công.
   *
   * Đây là câu trả lời cho "đóng cửa sổ xoay được chưa": bằng không trong một
   * khoảng đủ dài nghĩa là không còn ai cầm giá trị ký bằng key cũ.
   */
  get previousKeyHits(): number {
    return this.#previousHits;
  }

  /**
   * Thử từng key cho tới khi một cái nói `true`.
   *
   * Người gọi truyền một hàm verify **theo thời gian hằng định**; lớp này không
   * tự so sánh gì, nó chỉ quyết định thử key nào và theo thứ tự nào. Nhờ vậy
   * `cursor` và `csrf` giữ nguyên phép so sánh riêng của chúng.
   */
  verify(attempt: (key: string) => boolean): boolean {
    for (const [index, key] of this.#keys.entries()) {
      if (!attempt(key)) continue;
      if (index > 0) this.#previousHits += 1;
      return true;
    }
    return false;
  }

  /** Dựng một bộ chỉ có một key — dùng ở test và ở chỗ chưa xoay bao giờ. */
  static single(label: string, key: string): KeyRing {
    return new KeyRing(label, { current: key });
  }
}

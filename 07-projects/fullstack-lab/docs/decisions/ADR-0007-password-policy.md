# ADR-0007: Password policy — độ dài và blocklist thay cho composition rules

- Status: Accepted
- Date: 2026-09-03
- Accepted: 2026-09-03
- Related docs: [authentication](../security/authentication.md), [endpoint contracts](../api/endpoint-contracts.md) (`/auth/sign-up`, `/auth/password/reset`), [interaction specifications](../design/interaction-specifications.md), [design system](../design/design-system.md) (`AUTH-02`/`AUTH-04`)

## Context

`security/authentication.md` chốt Argon2id, token một lần, opaque session — nhưng **không có password policy**. Đây là gap thật, không phải chi tiết bỏ qua được: `interaction-specifications.md` cấm client tự đặt giới hạn độ dài/ký tự chưa có hợp đồng, nên khi không có policy thì form đăng ký/đặt lại mật khẩu **không có gì để validate**, và server validator cũng không có chuẩn.

Đợt design 03/09 phát hiện đúng gap này và đã thêm trực tiếp vào `authentication.md` một policy dạng composition: tối thiểu 8 ký tự + chữ hoa + chữ thường + số + ký tự đặc biệt, kèm checklist sống ở `AUTH-02`/`AUTH-04`. Hai vấn đề với cách đó:

1. **Quy trình:** `decisions/README.md` liệt kê "thay đổi vòng đời credential" là quyết định **bắt buộc có ADR**. Policy áp dụng ở sign-up và password reset chính là vòng đời credential; nó không được sửa thẳng vào contract đã phê duyệt mà không có ADR.
2. **Nội dung:** composition rules là hướng dẫn đã lỗi thời. Khuyến nghị chủ đạo hiện nay (NIST SP 800-63B) là **verifier không nên áp đặt composition rules**, mà nên kiểm tra mật khẩu với danh sách đã bị lộ/phổ biến. Composition rules đẩy người dùng tới các mẫu như `Password1!` — thoả mọi ô checklist nhưng nằm sẵn trong mọi wordlist tấn công. Ngoài ra bản policy đó thiếu bốn điều sẽ thành bug thật khi implement: không nêu **độ dài tối đa** (người implement sẽ cắt ở 20–72 ký tự hoặc âm thầm truncate), không nói **space/Unicode có được phép**, không có **normalization** (cùng một passphrase gõ trên hai bàn phím/IME có thể hash khác nhau ⇒ khoá tài khoản), và không định nghĩa **tập "ký tự đặc biệt"** (client checklist và server validator sẽ lệch nhau).

MVP hiện **không có MFA**, nên chất lượng mật khẩu là lớp phòng thủ duy nhất trước credential stuffing.

## Decision

Policy áp dụng cho sign-up và password reset (không có authenticated password-change trong MVP — giữ nguyên):

1. **Độ dài tối thiểu 12 ký tự.** Không có yêu cầu composition nào (không bắt hoa/thường/số/ký tự đặc biệt).
2. **Độ dài tối đa 200 ký tự**, và **không bao giờ truncate** trước khi hash. Mọi giá trị trong `12..200` phải hash được nguyên vẹn.
3. **Cho phép mọi ký tự in được, gồm space và Unicode.** Passphrase có dấu cách là hợp lệ.
4. **Normalize NFKC trước khi hash**, và áp dụng **giống nhau** ở sign-up, reset và sign-in. Lệch normalization giữa các đường là lỗi khoá tài khoản, không phải chi tiết nhỏ.
5. **Blocklist bắt buộc:** từ chối mật khẩu nằm trong danh sách tĩnh các mật khẩu phổ biến/đã bị lộ (bundle trong auth module, có version và được review khi cập nhật), và từ chối mật khẩu chứa local-part của email hoặc display name của chính user (so sánh case-insensitive, chuỗi con ≥ 4 ký tự). Từ chối blocklist trả `400 VALIDATION_FAILED` với field error an toàn, **không tiết lộ** vì sao nằm trong danh sách nào.
6. **Không kiểm tra blocklist qua network ở đường sign-up.** Nếu về sau dùng dịch vụ dạng breach-API, bắt buộc k-anonymity (chỉ gửi prefix hash) và phải có ADR riêng quyết định fail-open/fail-closed.
7. **Không rotation định kỳ, không password hint, không câu hỏi bảo mật.** Mật khẩu chỉ bị buộc đổi khi có dấu hiệu compromise, và đường duy nhất là reset qua token (đã revoke mọi session trong cùng transaction).
8. **Client checklist** ở `AUTH-02`/`AUTH-04` biểu diễn đúng những gì client kiểm được: độ dài ≥ 12 (live), và "không được chứa email/tên của bạn" (live). Kết quả blocklist là **server-decided**, hiển thị dạng field error sau submit — client không nhúng danh sách lộ để tự đánh dấu live. Server validator là điểm quyết định cuối cùng.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Độ dài ≥ 12 + blocklist, không composition (chọn) | Chặn đúng lớp tấn công thực tế (stuffing/wordlist); UX một tiêu chí dễ hiểu; khớp hướng dẫn hiện hành; không có tranh chấp "ký tự đặc biệt là gì". | Cần một artifact blocklist có version và quy trình cập nhật; một số người dùng quen composition sẽ thấy lạ. |
| Composition rules ≥ 8 + hoa/thường/số/đặc biệt (bản design đề xuất) | Quen mắt, checklist live đẹp, client kiểm được 100%. | Khuyến khích `Password1!`; entropy tăng không đáng kể; verifier không nên áp đặt theo hướng dẫn hiện hành; phải định nghĩa tập ký tự đặc biệt và giữ client/server đồng bộ mãi. |
| Độ dài ≥ 8 + blocklist | Rào cản thấp nhất cho người dùng. | 8 ký tự do người tự chọn là vùng ngọt của brute-force/stuffing, trong khi MVP chưa có MFA để bù. |
| Độ dài ≥ 15, bắt buộc passphrase | An toàn nhất. | Ma sát cao cho công cụ team nhỏ; không có MFA để đánh đổi lại; dễ khiến người dùng ghi mật khẩu ra ngoài. |

## Consequences

- `security/authentication.md` có một dòng policy trỏ về ADR này; khi ADR còn `Proposed` thì dòng đó ghi rõ trạng thái, không được đọc như contract đã duyệt.
- Auth module cần một **blocklist artifact có version** (danh sách tĩnh) cùng test chứng minh: mật khẩu trong danh sách bị từ chối, mật khẩu chứa email local-part bị từ chối, passphrase 20 ký tự có dấu cách được chấp nhận, và giá trị 200 ký tự hash được không truncate.
- Test bắt buộc thêm: cùng một passphrase Unicode gõ ở hai dạng chuẩn hoá khác nhau vẫn sign-in được (chứng minh NFKC áp dụng đồng nhất) — đây là bug khoá tài khoản khó phát hiện nhất của quyết định này.
- Thiết kế phải sửa: checklist ở `AUTH-02`/`AUTH-04` đổi từ 5 ô composition sang độ dài + "không chứa email/tên", cộng một field error trạng thái blocklist sau submit. Đây là thay đổi bắt buộc, không phải tuỳ chọn thẩm mỹ.
- Không đổi rate limit, error envelope, session/CSRF hay bất kỳ endpoint nào.

## Revisit When

- MFA/TOTP được thêm vào sản phẩm: khi đó có thể hạ tối thiểu về 8–10 vì đã có lớp bù.
- Telemetry cho thấy tỷ lệ từ chối do blocklist cao bất thường (dấu hiệu danh sách quá rộng hoặc thông báo không hướng dẫn được người dùng).
- Có yêu cầu SSO/OIDC: policy chuyển về identity provider và ADR này thu hẹp phạm vi.
- Có non-browser client/public API: đánh giá lại normalization và giới hạn độ dài ở boundary mới.

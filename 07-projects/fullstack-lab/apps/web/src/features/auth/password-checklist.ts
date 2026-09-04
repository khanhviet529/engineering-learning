/**
 * Checklist mật khẩu phía client — [ADR-0007](../../../../../docs/decisions/ADR-0007-password-policy.md).
 *
 * Client chỉ kiểm **những gì kiểm được**: độ dài, và quy tắc không chứa email
 * hay tên hiển thị. Blocklist là quyết định của server và hiện thành field
 * error **sau khi submit** — client không mang theo danh sách đó, vì làm vậy là
 * gửi nội dung blocklist tới mọi trình duyệt.
 *
 * Đây là lý do checklist có **hai** dòng live chứ không phải ba: dòng thứ ba
 * sẽ là một lời hứa mà client không giữ được.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export interface ChecklistItem {
  id: string;
  label: string;
  met: boolean;
}

export interface ChecklistInput {
  password: string;
  email: string;
  displayName: string;
}

/** Chuỗi con từ bốn ký tự trở lên mới tính là "chứa" — khớp đúng quy tắc server. */
const MIN_IDENTITY_FRAGMENT = 4;

function containsIdentity(password: string, email: string, displayName: string): boolean {
  if (password.length === 0) return false;
  const lower = password.normalize("NFKC").toLowerCase();
  const localPart = email.split("@")[0] ?? "";
  return [localPart, displayName]
    .flatMap((value) =>
      value
        .normalize("NFKC")
        .toLowerCase()
        .split(/[\s._-]+/),
    )
    .filter((fragment) => fragment.length >= MIN_IDENTITY_FRAGMENT)
    .some((fragment) => lower.includes(fragment));
}

export function passwordChecklist(input: ChecklistInput): ChecklistItem[] {
  const length = [...input.password.normalize("NFKC")].length;

  return [
    {
      id: "length",
      label: `Ít nhất ${String(PASSWORD_MIN_LENGTH)} ký tự`,
      met: length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH,
    },
    {
      id: "identity",
      label: "Không chứa email hoặc tên hiển thị của bạn",
      met:
        input.password.length > 0 &&
        !containsIdentity(input.password, input.email, input.displayName),
    },
  ];
}

/** Nút submit chỉ mở khi mọi dòng live đã đạt — server vẫn là nơi quyết định cuối. */
export function checklistSatisfied(items: ChecklistItem[]): boolean {
  return items.every((item) => item.met);
}

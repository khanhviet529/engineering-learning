"use client";

import { FbAlert, FbBadge, FbLink, FbPageSection, FbSkeleton } from "@flowboard/ui";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState } from "../system/failure-state.tsx";
import { initialsOf, useSession } from "../session/session.tsx";
import { useThemePreference, type ThemePreference } from "./theme-preference.tsx";

/**
 * `USR-01` — hồ sơ và tùy chọn.
 *
 * Màn này **không có mutation phía server**, và đó là điểm dễ hiểu sai nhất.
 * Nó chỉ làm ba việc:
 *
 * 1. Hiển thị actor của phiên — tên và email, **chỉ đọc**.
 * 2. Cho chọn theme `light | dark | system`, lưu **cục bộ**.
 * 3. Cho thấy múi giờ dữ liệu đang dùng, **chỉ đọc** — nó là dữ liệu của
 *    workspace, vì due state phải nhất quán cho cả dự án.
 *
 * Entry point là **khối người dùng trên topbar** (quyết định của chủ dự án
 * 03/09/2026). Footer sidebar chỉ còn control thu gọn: hai đường vào cùng một
 * route là cùng loại lỗi với việc nhân đôi control theme.
 *
 * Đổi mật khẩu đi qua `AUTH-03`; quản lý phiên và thiết bị không thuộc MVP.
 */

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
  { value: "system", label: "Theo hệ thống" },
];

export function AccountSettingsScreen() {
  const { actor, loading, failure } = useSession();
  const { preference, setPreference, storageFailed } = useThemePreference();

  const shell = (children: React.ReactNode) => (
    <AppShell title="Hồ sơ và tùy chọn">{children}</AppShell>
  );

  if (failure !== undefined) return shell(<FailureState failure={failure} />);
  if (loading || actor === undefined) return shell(<FbSkeleton lines={3} />);

  return shell(
    <>
      <FbPageSection heading="Tài khoản của bạn">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--fb-space-4)",
            padding: "var(--fb-space-5)",
            borderRadius: "var(--fb-radius-lg)",
            background: "var(--fb-color-surface-subtle)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--fb-radius-pill)",
              background: "var(--fb-color-brand-subtle)",
              color: "var(--fb-color-brand-text)",
              fontSize: "var(--fb-font-size-body-lg)",
              fontWeight: "var(--fb-font-weight-semibold)",
            }}
          >
            {initialsOf(actor.displayName)}
          </span>
          <div style={{ display: "grid", gap: 4 }}>
            <span
              style={{
                fontSize: "var(--fb-font-size-body-lg)",
                fontWeight: "var(--fb-font-weight-bold)",
              }}
            >
              {actor.displayName}
            </span>
            <span
              style={{
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              {`${actor.email} · chỉ đọc`}
            </span>
          </div>
        </div>
      </FbPageSection>

      <FbPageSection
        heading="Giao diện và thời gian"
        description="Tuỳ chọn giao diện được lưu trên thiết bị này, không gửi lên máy chủ."
      >
        {/* `radiogroup` thay vì ba nút: ba giá trị loại trừ nhau, và radio cho
            sẵn điều hướng bằng mũi tên cùng thông báo "1 trong 3" cho screen
            reader. Ba nút rời sẽ phải dựng lại cả hai thứ đó. */}
        <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          <legend
            style={{
              padding: 0,
              fontSize: "var(--fb-font-size-body-sm)",
              fontWeight: "var(--fb-font-weight-semibold)",
              color: "var(--fb-color-text-strong)",
            }}
          >
            Giao diện mặc định
          </legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {THEME_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <label
                  key={option.value}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: "var(--fb-radius-md)",
                    cursor: "pointer",
                    fontSize: "var(--fb-font-size-body-sm)",
                    fontWeight: "var(--fb-font-weight-semibold)",
                    border: `1px solid ${
                      selected ? "var(--fb-color-brand-border)" : "var(--fb-color-border-default)"
                    }`,
                    background: selected
                      ? "var(--fb-color-brand-subtle)"
                      : "var(--fb-color-surface-raised)",
                    color: selected ? "var(--fb-color-brand-text)" : "var(--fb-color-text-strong)",
                  }}
                >
                  <input
                    type="radio"
                    name="theme-preference"
                    value={option.value}
                    checked={selected}
                    onChange={() => setPreference(option.value)}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        {storageFailed && (
          <FbAlert
            intent="warning"
            title="Không lưu được tuỳ chọn giao diện trên thiết bị này"
            description="Lựa chọn vẫn có hiệu lực trong phiên hiện tại. Trình duyệt có thể đang chặn bộ nhớ cục bộ."
          />
        )}

        <dl style={{ display: "grid", gap: "var(--fb-space-3)", margin: 0 }}>
          <div style={{ display: "flex", gap: "var(--fb-space-4)", flexWrap: "wrap" }}>
            <dt style={{ minWidth: 160, color: "var(--fb-color-text-muted)" }}>Múi giờ dữ liệu</dt>
            <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {/* Hợp đồng chưa công bố múi giờ của workspace trong projection
                  nào, nên UI nói rõ nó theo workspace và **không** bịa ra một
                  giá trị. Xem ghi chú hợp đồng còn thiếu trong báo cáo M2. */}
              <FbBadge tone="neutral">Theo không gian làm việc</FbBadge>
            </dd>
          </div>
        </dl>
      </FbPageSection>

      <FbPageSection
        heading="Bảo mật tài khoản"
        description="Quản lý phiên và thiết bị không thuộc phiên bản này."
      >
        <p style={{ margin: 0, fontSize: "var(--fb-font-size-body)" }}>
          {"Đổi mật khẩu qua luồng đặt lại: "}
          <FbLink href="/quen-mat-khau">Gửi liên kết đặt lại mật khẩu</FbLink>
          {". Đặt lại mật khẩu sẽ kết thúc mọi phiên đang mở."}
        </p>
      </FbPageSection>
    </>,
  );
}

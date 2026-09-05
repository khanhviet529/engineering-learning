"use client";

import type { ReactNode } from "react";
import { Alert, Button, ConfigProvider, Input, Result, Typography } from "antd";
import { flowboardTheme } from "./theme.ts";

/**
 * Chín wrapper `Fb*` đầu tiên — đúng những component mà màn hình `AUTH-01`…
 * `AUTH-05` của M1 cần.
 *
 * Quy tắc không đổi, theo [quy ước frontend](../../../docs/engineering/frontend-conventions.md):
 * wrapper **không** fetch data, **không** kiểm tra role, **không** gọi API.
 * Component cần capability hoặc mutation thì thuộc về feature trong `apps/web`.
 *
 * Wrapper tồn tại để token, trạng thái accessibility, copy và variant giữ ổn
 * định — chứ không phải để đổi tên component của Ant Design.
 */

export interface FbBrandMarkProps {
  /** Kích thước chữ; mặc định dùng cho màn hình xác thực. */
  size?: "md" | "lg";
}

export function FbBrandMark({ size = "lg" }: FbBrandMarkProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--fb-space-2)",
        fontFamily: "var(--fb-font-family-base), system-ui, sans-serif",
        fontSize: size === "lg" ? "var(--fb-font-size-heading-md)" : "var(--fb-font-size-body-lg)",
        fontWeight: "var(--fb-font-weight-bold)",
        color: "var(--fb-color-text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "var(--fb-size-icon-md)",
          height: "var(--fb-size-icon-md)",
          borderRadius: "var(--fb-radius-sm)",
          background: "var(--fb-color-brand-surface)",
        }}
      />
      Flowboard
    </span>
  );
}

export interface FbButtonProps {
  children: ReactNode;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  onClick?: () => void;
  /**
   * `id` của form mà nút này submit, khi nút nằm **ngoài** thẻ `form` — ví dụ
   * ở footer của một modal.
   *
   * Đây là thuộc tính HTML chuẩn, và nó là cách đúng để giữ một form thật:
   * `Enter` trong input vẫn submit, và không cần đi tìm form bằng selector rồi
   * gọi `requestSubmit` bằng tay.
   */
  form?: string;
}

/**
 * `FbButtonPrimary` và `FbButtonSecondary` là **hai component tách biệt**, không
 * phải một `FbButton` với prop `variant`.
 *
 * Đây là quyết định của thiết kế, không phải sở thích: hai nút mang hai mức cam
 * kết khác nhau, và một prop `variant` khiến chỗ gọi dễ đổi mức cam kết bằng
 * một ký tự.
 */
export function FbButtonPrimary({
  children,
  type = "button",
  loading = false,
  disabled = false,
  block = false,
  onClick,
  form,
}: FbButtonProps) {
  return (
    <Button
      type="primary"
      htmlType={type}
      loading={loading}
      disabled={disabled}
      block={block}
      onClick={onClick}
      {...(form === undefined ? {} : { form })}
    >
      {children}
    </Button>
  );
}

export function FbButtonSecondary({
  children,
  type = "button",
  loading = false,
  disabled = false,
  block = false,
  onClick,
  form,
}: FbButtonProps) {
  return (
    <Button
      htmlType={type}
      loading={loading}
      disabled={disabled}
      block={block}
      onClick={onClick}
      {...(form === undefined ? {} : { form })}
    >
      {children}
    </Button>
  );
}

export interface FbFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Thông báo lỗi ở cấp field; hiện dưới input và được screen reader đọc. */
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  autoComplete?: string | undefined;
  disabled?: boolean | undefined;
}

/** Khung chung: nhãn, input, hint và lỗi được nối với nhau bằng `aria-describedby`. */
function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  // Khai `| undefined` tường minh: với `exactOptionalPropertyTypes`, một prop
  // optional không tự động nhận `undefined`, và chỗ gọi không nên phải né tránh
  // bằng biểu thức điều kiện cho một component của chính mình.
  required?: boolean | undefined;
  children: ReactNode;
}) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-1)" }}>
      <label
        htmlFor={id}
        style={{
          fontSize: "var(--fb-font-size-body-sm)",
          fontWeight: "var(--fb-font-weight-medium)",
          color: "var(--fb-color-text-primary)",
        }}
      >
        {label}
        {required === true && (
          <span aria-hidden="true" style={{ color: "var(--fb-color-intent-danger-text)" }}>
            {" *"}
          </span>
        )}
      </label>
      {children}
      {hint !== undefined && (
        <span
          id={hintId}
          style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
        >
          {hint}
        </span>
      )}
      {error !== undefined && (
        // `role="alert"` để lỗi được đọc ngay khi xuất hiện, không phải chờ
        // người dùng tự điều hướng tới nó.
        <span
          id={errorId}
          role="alert"
          style={{
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-intent-danger-text)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Gom các prop tuỳ chọn thành một object để **spread**.
 *
 * Với `exactOptionalPropertyTypes`, truyền `undefined` và không truyền là hai
 * việc khác nhau, mà primitive của Ant Design chỉ chấp nhận việc thứ hai. Gom
 * lại một chỗ thay vì viết ba biểu thức điều kiện ở mỗi field.
 */
function optionalInputProps(props: FbFieldProps) {
  const described = describedBy(props.id, props.hint, props.error);
  return {
    ...(props.error === undefined ? {} : { status: "error" as const }),
    ...(described === undefined ? {} : { "aria-describedby": described }),
    ...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete }),
  };
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const parts = [
    hint === undefined ? undefined : `${id}-hint`,
    error === undefined ? undefined : `${id}-error`,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function FbTextField(props: FbFieldProps) {
  const { id, label, value, onChange, error, hint, required } = props;
  // `disabled` có default để không truyền `undefined` xuống primitive: với
  // `exactOptionalPropertyTypes`, `undefined` và "không truyền" là hai thứ khác nhau.
  const disabled = props.disabled ?? false;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        disabled={disabled}
        {...optionalInputProps(props)}
      />
    </Field>
  );
}

export function FbPasswordField(props: FbFieldProps) {
  const { id, label, value, onChange, error, hint, required } = props;
  // `disabled` có default để không truyền `undefined` xuống primitive: với
  // `exactOptionalPropertyTypes`, `undefined` và "không truyền" là hai thứ khác nhau.
  const disabled = props.disabled ?? false;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <Input.Password
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        disabled={disabled}
        {...optionalInputProps(props)}
      />
    </Field>
  );
}

export interface FbTextAreaProps extends FbFieldProps {
  rows?: number;
  placeholder?: string | undefined;
  /** Giới hạn ký tự của hợp đồng; hiện số đã dùng để người viết biết trước khi bị từ chối. */
  maxLength?: number | undefined;
}

/**
 * Ô nhập nhiều dòng cho mô tả task và ô soạn bình luận.
 *
 * Nó dùng `Input.TextArea` của Ant Design chứ không tự vẽ, vì đó cùng một họ
 * primitive với `FbTextField` — cùng seed màu đã khai trong `theme.ts`, nên
 * không mở thêm bề mặt token nào chưa được đo.
 */
export function FbTextArea(props: FbTextAreaProps) {
  const { id, label, value, onChange, error, hint, required, rows = 4, placeholder } = props;
  const disabled = props.disabled ?? false;
  const maxLength = props.maxLength;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <Input.TextArea
        id={id}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        disabled={disabled}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...optionalInputProps(props)}
      />
    </Field>
  );
}

/**
 * Ngày theo lịch, **không có giờ**.
 *
 * Nó là `<input type="date">` gốc, không phải `DatePicker` của Ant Design. Ba
 * lý do, theo thứ tự quan trọng: hợp đồng chỉ có `YYYY-MM-DD` nên một picker
 * mang theo giờ và múi giờ là thừa và dễ sai; `DatePicker` kéo theo một lớp
 * popup với hàng chục token dẫn xuất mà `theme.test.ts` **không** canh được —
 * nó chỉ canh những seed ta khai; và input gốc đã có sẵn bàn phím, định dạng
 * theo locale của máy và bộ chọn của từng nền tảng.
 */
export function FbDateField(props: FbFieldProps) {
  const { id, label, value, onChange, error, hint, required } = props;
  const disabled = props.disabled ?? false;
  const described = describedBy(id, hint, error);

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error !== undefined}
        {...(described === undefined ? {} : { "aria-describedby": described })}
        style={{
          width: "100%",
          minHeight: 40,
          padding: "0 var(--fb-space-3)",
          borderRadius: "var(--fb-radius-md)",
          border: `1px solid ${
            error === undefined
              ? "var(--fb-color-border-default)"
              : "var(--fb-color-intent-danger-text)"
          }`,
          background: disabled
            ? "var(--fb-color-state-disabled-surface)"
            : "var(--fb-color-surface-raised)",
          color: disabled ? "var(--fb-color-state-disabled-text)" : "var(--fb-color-text-primary)",
          fontSize: "var(--fb-font-size-body)",
          fontFamily: "inherit",
        }}
      />
    </Field>
  );
}

export interface FbSelectOption {
  value: string;
  label: string;
}

export interface FbSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FbSelectOption[];
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}

/**
 * Select cho tập giá trị **hữu hạn đã biết trước**: vai trò project, vai trò
 * workspace, và các enum khác của hợp đồng.
 *
 * Nó dùng `<select>` gốc thay vì dropdown tự dựng. Lý do là accessibility chứ
 * không phải lười: `<select>` gốc có sẵn điều hướng bàn phím, tìm theo ký tự
 * và giao diện chọn của từng nền tảng — ba thứ mà một dropdown tự dựng phải
 * làm lại đúng, và thường làm sai. Hệ thống thiết kế cấm "text giả làm
 * dropdown", và một `<select>` thật đáp ứng yêu cầu đó chặt hơn một div.
 */
export function FbSelect(props: FbSelectProps) {
  const { id, label, value, onChange, options, error, hint, required } = props;
  const disabled = props.disabled ?? false;
  const described = describedBy(id, hint, error);

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error !== undefined}
        {...(described === undefined ? {} : { "aria-describedby": described })}
        style={{
          width: "100%",
          minHeight: 40,
          padding: "0 var(--fb-space-3)",
          borderRadius: "var(--fb-radius-md)",
          border: `1px solid ${
            error === undefined
              ? "var(--fb-color-border-default)"
              : "var(--fb-color-intent-danger-text)"
          }`,
          background: disabled
            ? "var(--fb-color-state-disabled-surface)"
            : "var(--fb-color-surface-raised)",
          color: disabled ? "var(--fb-color-state-disabled-text)" : "var(--fb-color-text-primary)",
          fontSize: "var(--fb-font-size-body)",
          fontFamily: "inherit",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface FbLinkProps {
  href: string;
  children: ReactNode;
  /** Link ra ngoài luôn có `rel` an toàn; không có ngoại lệ. */
  external?: boolean;
}

export function FbLink({ href, children, external = false }: FbLinkProps) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      style={{ color: "var(--fb-color-brand-text)", textDecoration: "underline" }}
    >
      {children}
    </a>
  );
}

export interface FbAlertProps {
  intent: "info" | "success" | "warning" | "error";
  title: string;
  description?: ReactNode;
}

export function FbAlert({ intent, title, description }: FbAlertProps) {
  return (
    <Alert
      type={intent}
      message={title}
      {...(description === undefined ? {} : { description })}
      showIcon
      // Lỗi và cảnh báo phải được thông báo ngay; thông tin thì không cắt ngang.
      role={intent === "error" ? "alert" : "status"}
    />
  );
}

export interface FbChecklistRowProps {
  /** Đã đạt hay chưa. Đây là **chỉ báo trạng thái** do client tính. */
  met: boolean;
  children: ReactNode;
}

/**
 * Hàng checklist **không nhận tương tác**: nó phản ánh trạng thái, không phải
 * một control để bấm. Vì vậy nó không có `hover`, `focus` hay `disabled` — chỉ
 * có "đạt" và "chưa đạt".
 */
export function FbChecklistRow({ met, children }: FbChecklistRowProps) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--fb-space-2)",
        fontSize: "var(--fb-font-size-caption)",
        color: met ? "var(--fb-color-intent-success-text)" : "var(--fb-color-text-muted)",
        listStyle: "none",
      }}
    >
      <span aria-hidden="true">{met ? "✓" : "•"}</span>
      <span>{children}</span>
      {/* Trạng thái được nói thành lời cho screen reader, không chỉ bằng màu và ký hiệu. */}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        {met ? " (đã đạt)" : " (chưa đạt)"}
      </span>
    </li>
  );
}

export interface FbStatePanelProps {
  state: "loading" | "empty" | "error" | "forbidden" | "session-expired" | "conflict" | "success";
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

const RESULT_STATUS = {
  loading: "info",
  empty: "info",
  error: "error",
  forbidden: "403",
  "session-expired": "warning",
  conflict: "warning",
  success: "success",
} as const;

/**
 * `FbStatePanel` gánh cả Empty, Forbidden, Conflict và các trạng thái hệ thống
 * khác, thay cho `FbEmptyState` và `FbPermissionState` riêng lẻ.
 *
 * Nội dung chữ và hành động là quyết định của Flowboard, không để primitive tự
 * chọn: một trang lỗi nói sai việc cần làm tiếp thì tệ hơn là không nói gì.
 */
export function FbStatePanel({ state, title, description, action }: FbStatePanelProps) {
  return (
    <Result
      status={RESULT_STATUS[state]}
      title={<Typography.Title level={3}>{title}</Typography.Title>}
      {...(description === undefined ? {} : { subTitle: description })}
      {...(action === undefined ? {} : { extra: action })}
    />
  );
}

export interface FbThemeProviderProps {
  children: ReactNode;
}

/**
 * Cầu nối theme, và là **lý do `apps/web` không cần import Ant Design**.
 *
 * Quy ước frontend nói Flowboard bọc Ant Design trước khi dùng rộng rãi. Nếu
 * mỗi màn hình tự dựng `ConfigProvider`, thì antd trở thành dependency trực
 * tiếp của app và mỗi chỗ có thể truyền một theme khác — đúng thứ mà việc bọc
 * sinh ra để tránh.
 */
export function FbThemeProvider({ children }: FbThemeProviderProps) {
  return <ConfigProvider theme={flowboardTheme}>{children}</ConfigProvider>;
}

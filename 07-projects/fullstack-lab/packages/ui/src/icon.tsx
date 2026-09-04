"use client";

import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Columns3,
  Folders,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldAlert,
  SunMoon,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";

/**
 * Lucide là thư viện icon **duy nhất** của Flowboard, theo
 * [hệ thống thiết kế](../../../docs/design/design-system.md). Không trộn bộ
 * khác vào: hai bộ khác nhau về stroke weight và quy ước tên, trộn vào thì vừa
 * lệch thị giác vừa không map được sang một package duy nhất khi build.
 *
 * Danh sách ở đây là **allowlist**: mỗi khái niệm dùng đúng một icon, đúng
 * bảng "Khái niệm → Icon chốt" của tài liệu. Khai báo tường minh thay vì cho
 * chỗ gọi truyền tên tự do, vì tên tự do là cách `calendar` và `calendar-days`
 * cùng xuất hiện trong một sản phẩm.
 *
 * Nó chỉ chứa icon **đang được dùng ở mốc này**, không phải cả bảng của tài
 * liệu. Bảng trong hệ thống thiết kế vẫn là contract về việc khái niệm nào đi
 * với icon nào; danh sách này lớn lên khi một màn hình thật cần thêm. Giữ sẵn
 * icon "để dành" là cách một thư viện tích lũy thứ không ai dùng — đúng vết
 * mà `FbActivityItem` với 0 instance đã để lại trên canvas.
 */
const ICONS = {
  "building-2": Building2,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-user-round": CircleUserRound,
  // Nav `Bảng công việc` (`BRD-01`); icon lấy đúng từ `FbSidebar` trên artifact.
  "columns-3": Columns3,
  folders: Folders,
  "layout-dashboard": LayoutDashboard,
  "log-out": LogOut,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  settings: Settings,
  "shield-alert": ShieldAlert,
  "sun-moon": SunMoon,
  "triangle-alert": TriangleAlert,
  users: Users,
  x: X,
} as const;

export type FbIconName = keyof typeof ICONS;

export interface FbIconProps {
  name: FbIconName;
  /** Cỡ theo token: `sm` 16, `md` 20, `lg` 24. Artifact dùng 18 cho nav nên có thêm `nav`. */
  size?: "sm" | "nav" | "md" | "lg";
  /** Màu; mặc định kế thừa `currentColor` của chỗ đặt. */
  color?: string;
}

const SIZE: Record<NonNullable<FbIconProps["size"]>, string> = {
  sm: "var(--fb-size-icon-sm)",
  nav: "18px",
  md: "var(--fb-size-icon-md)",
  lg: "var(--fb-size-icon-lg)",
};

/**
 * Icon luôn `aria-hidden`.
 *
 * Một icon không bao giờ là kênh truyền nghĩa duy nhất — tài liệu thiết kế nói
 * rõ điều đó. Chỗ nào cần nghĩa thì đặt nhãn văn bản hoặc `aria-label` trên
 * chính control, không phải trên hình vẽ bên trong nó.
 */
export function FbIcon({ name, size = "md", color }: FbIconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      width={SIZE[size]}
      height={SIZE[size]}
      color={color ?? "currentColor"}
      strokeWidth={2}
    />
  );
}

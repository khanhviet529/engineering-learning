"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  FbAccountButton,
  FbAccountMenu,
  FbMobileHeader,
  FbSidebar,
  FbSidebarCollapsed,
  FbThemeProvider,
  FbTopbar,
} from "@flowboard/ui";
import { useThemePreference } from "../account/theme-preference.tsx";
import { initialsOf, useSession } from "../session/session.tsx";
import { signOut } from "../../lib/workspace-api.ts";
import { navItemsFor, type NavContext } from "./nav-items.ts";

/**
 * Khung ứng dụng cho mọi màn hình **đã đăng nhập**.
 *
 * Nó xuất hiện lần đầu ở M2 chứ không sớm hơn: `AUTH-01`…`AUTH-05` không có
 * sidebar, vì chưa có workspace nào để điều hướng.
 *
 * Nó thuộc `features/` chứ không thuộc `packages/ui` vì nó **đọc capability**
 * và **gọi mutation** (đăng xuất) — hai việc mà quy ước frontend cấm wrapper
 * làm. Phần trình bày thuần nằm ở `FbSidebar`, `FbTopbar`, `FbAccountMenu`.
 */

const COLLAPSE_KEY = "flowboard.sidebar.collapsed";
/** Dưới ngưỡng này, sidebar trở thành lớp phủ thay vì một cột cố định. */
const COMPACT_MAX_WIDTH = 1024;

export interface AppShellProps extends Omit<NavContext, "pathname"> {
  /** Tiêu đề `h1` của trang, do topbar render. */
  title: string;
  breadcrumb?: string | undefined;
  workspaceName?: string | undefined;
  children: ReactNode;
}

export function AppShell({
  title,
  breadcrumb,
  workspaceName,
  workspaceId,
  project,
  workspaceCapabilities,
  children,
}: AppShellProps) {
  // `pathname` **không** là prop: nó đọc được ngay ở đây, và trước đây 8 màn
  // hình mỗi màn tự gọi `usePathname()` rồi truyền vào kèm một giá trị dự phòng
  // tự chọn — ba giá trị khác nhau (`""`, `"/tai-khoan"`, `"/khong-gian-lam-viec"`).
  // Dự phòng sai không gây lỗi thấy được; nó chỉ làm nav highlight sai mục, tức
  // là loại lỗi không ai báo. Một nguồn, một giá trị dự phòng.
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { actor } = useSession();
  const { toggle: toggleTheme } = useThemePreference();

  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Storage bị chặn chỉ làm mất một tiện ích, không làm hỏng điều hướng.
    }
  }, []);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${String(COMPACT_MAX_WIDTH)}px)`);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Xem trên.
      }
      return next;
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    // Trả focus **về chính khối người dùng** — hợp đồng ở đặc tả tương tác.
    // Dùng ref tới đúng nút đó, không đi tìm bằng selector: `querySelector`
    // trên cả topbar sẽ trả về nút đầu tiên, tức là nút đổi theme.
    userButtonRef.current?.focus();
  }, []);

  const items = navItemsFor({
    pathname,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(project === undefined ? {} : { project }),
    ...(workspaceCapabilities === undefined ? {} : { workspaceCapabilities }),
  });

  const accountMenu =
    actor === undefined ? undefined : (
      <FbAccountMenu
        displayName={actor.displayName}
        email={actor.email}
        onDismiss={closeMenu}
        items={[
          {
            id: "profile",
            label: "Hồ sơ và tùy chọn",
            icon: "circle-user-round",
            onSelect: () => {
              setMenuOpen(false);
              router.push("/tai-khoan");
            },
          },
          {
            id: "sign-out",
            label: "Đăng xuất",
            icon: "log-out",
            tone: "danger",
            onSelect: () => {
              setMenuOpen(false);
              void signOut().then(() => {
                // Xoá cache trước khi rời đi: dữ liệu private của phiên cũ
                // không được sống sót qua lần đăng nhập sau.
                queryClient.clear();
                router.push("/dang-nhap");
              });
            },
          },
        ]}
      />
    );

  const accountBlock = ({ compact: narrow }: { compact: boolean }) =>
    actor === undefined ? null : (
      <FbAccountButton
        displayName={actor.displayName}
        initials={initialsOf(actor.displayName)}
        open={menuOpen}
        onOpen={() => setMenuOpen((open) => !open)}
        compact={narrow}
        buttonRef={userButtonRef}
        {...(accountMenu === undefined ? {} : { menu: accountMenu })}
      />
    );

  const sidebar = collapsed ? (
    <FbSidebarCollapsed items={items} onToggleCollapse={toggleCollapsed} />
  ) : (
    <FbSidebar workspaceName={workspaceName} items={items} onToggleCollapse={toggleCollapsed} />
  );

  return (
    <FbThemeProvider>
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          background: "var(--fb-color-surface-canvas)",
          color: "var(--fb-color-text-primary)",
          fontFamily: "var(--fb-font-family-base), system-ui, sans-serif",
        }}
      >
        {/* Ở màn hình hẹp, sidebar là lớp phủ mở theo yêu cầu. Giữ nó cố định
            sẽ ăn hết bề ngang mà nội dung cần. */}
        {!compact && sidebar}

        {compact && navOpen && (
          <div
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setNavOpen(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 300,
              display: "flex",
              background: "var(--fb-color-overlay-dim)",
            }}
          >
            <FbSidebar workspaceName={workspaceName} items={items} />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {compact ? (
            // Trên màn hình hẹp, header mobile **thay** topbar theo đúng bộ
            // frame mobile của artifact. Khối người dùng đi cùng nó trong slot
            // `trailing`: artifact vẽ header mobile không có khối này, nhưng
            // topbar là entry point duy nhất của `USR-01`, nên bỏ nó đi là bỏ
            // mất một màn hình trên điện thoại. Xem ghi chú lệch artifact.
            <FbMobileHeader
              title={title}
              onOpenNavigation={() => setNavOpen(true)}
              trailing={accountBlock({ compact: true })}
            />
          ) : (
            <FbTopbar
              userButtonRef={userButtonRef}
              title={title}
              breadcrumb={breadcrumb}
              user={{
                displayName: actor?.displayName ?? "Đang tải…",
                initials: actor === undefined ? "…" : initialsOf(actor.displayName),
              }}
              accountMenuOpen={menuOpen}
              onOpenAccountMenu={() => setMenuOpen((open) => !open)}
              onToggleTheme={toggleTheme}
              accountMenu={accountMenu}
            />
          )}

          <main
            style={{
              flex: 1,
              display: "grid",
              gap: "var(--fb-space-6)",
              alignContent: "start",
              padding: "var(--fb-space-8)",
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </FbThemeProvider>
  );
}

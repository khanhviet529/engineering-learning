"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Tuỳ chọn giao diện của `USR-01`.
 *
 * Ba điều mà [đặc tả tương tác](../../../../../docs/design/interaction-specifications.md)
 * chốt, và cả ba đều dễ làm sai theo hướng "tiện hơn":
 *
 * 1. Đây là preference **cục bộ**, **không** có mutation API. Nó không đi qua
 *    transport, không có `Idempotency-Key`, và mất preference không phải lỗi
 *    dữ liệu.
 * 2. Có **ba** giá trị `light | dark | system`. Quick toggle trên topbar chỉ
 *    đảo qua lại `light` ↔ `dark`; giá trị `system` chỉ chọn được ở `USR-01`,
 *    vì một toggle hai trạng thái không biểu diễn được ba giá trị.
 * 3. Theme có **một** nguồn quyết định. `system` được biểu diễn bằng việc
 *    **gỡ** `data-theme` khỏi thẻ gốc để `tokens.css` tự đi theo
 *    `prefers-color-scheme`. Đọc `matchMedia` ở component là tạo nguồn thứ hai.
 */

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "flowboard.theme";

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** Đảo `light` ↔ `dark` cho quick toggle trên topbar. */
  toggle: () => void;
  /** Đúng khi lần ghi preference gần nhất **thất bại** ở local storage. */
  storageFailed: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readStored(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(raw) ? raw : "system";
  } catch {
    // Trình duyệt chặn storage (chế độ riêng tư, cấu hình doanh nghiệp) không
    // được làm hỏng ứng dụng — nó chỉ làm mất một tiện ích.
    return "system";
  }
}

function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  // Bắt đầu ở `system` để server render và client render lần đầu khớp nhau.
  // Giá trị đã lưu được đọc trong effect, sau khi đã có DOM thật.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setPreferenceState(stored);
    apply(stored);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    // Áp dụng **ngay**, rồi mới ghi. Thứ tự này quan trọng: ghi thất bại không
    // được ngăn người dùng thấy lựa chọn của mình có hiệu lực trong phiên này.
    setPreferenceState(next);
    apply(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, []);

  const toggle = useCallback(() => {
    // Quick toggle chỉ có hai trạng thái. Khi đang ở `system`, lần bấm đầu
    // tiên chuyển sang giá trị **ngược với** thứ đang hiển thị, để một lần bấm
    // luôn tạo ra một thay đổi nhìn thấy được.
    setPreferenceState((current) => {
      const resolved =
        current === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : current;
      const next: ThemePreference = resolved === "dark" ? "light" : "dark";
      apply(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
        setStorageFailed(false);
      } catch {
        setStorageFailed(true);
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, setPreference, toggle, storageFailed }),
    [preference, setPreference, toggle, storageFailed],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) {
    throw new Error("useThemePreference phải nằm trong ThemePreferenceProvider.");
  }
  return value;
}

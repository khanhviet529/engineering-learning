import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library chỉ tự dọn DOM khi `globals: true`, vì nó cần một `afterEach`
// toàn cục để móc vào. Ở đây `globals: false`, nên phải đăng ký tường minh —
// thiếu bước này thì DOM của test trước còn sót lại và test sau tìm thấy hai
// phần tử cùng vai trò. Đây là lỗi số 3 đã ghi ở cổng ra M1; giữ nguyên cách sửa.
afterEach(cleanup);

// `localStorage` và `data-theme` **sống qua** ranh giới test trong cùng một
// file, vì jsdom chỉ dựng một lần cho cả file. Không dọn thì một test thu gọn
// sidebar sẽ làm test sau khởi động ở trạng thái thu gọn và không tìm thấy
// control mà nó cần — một thất bại chỉ xuất hiện khi chạy cả bộ, và biến mất
// khi chạy riêng, tức là loại khó tìm nhất.
afterEach(() => {
  try {
    globalThis.window.localStorage.clear();
  } catch {
    // Không có storage thì cũng không có gì để dọn.
  }
  globalThis.document.documentElement.removeAttribute("data-theme");
});

// jsdom không hiện thực `matchMedia`, mà `FbThemeProvider` và tuỳ chọn theme
// của `USR-01` đều đọc nó. Stub một bản tối thiểu, mặc định là **không** khớp
// `prefers-color-scheme: dark`, để test chạy trong theme sáng tất định.
// Kiểm bằng `typeof`, không bằng `in`: jsdom **có khai** thuộc tính
// `matchMedia` nhưng để giá trị `undefined`, nên `"matchMedia" in window` trả
// `true` trong khi gọi nó thì ném "is not a function".
if (typeof globalThis.window.matchMedia !== "function") {
  Object.defineProperty(globalThis.window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

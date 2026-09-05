import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Cây component của M2 gồm cả app shell và `ConfigProvider` của Ant Design, nên
// một lượt render mất hàng trăm mili-giây; khi cả bộ chạy song song thì con số
// đó cộng thêm nữa. Mặc định 1s của `findBy*` vì vậy hết hạn vì **máy chậm**,
// không vì giao diện sai — đúng loại thất bại chỉ xuất hiện khi chạy cả bộ và
// biến mất khi chạy riêng. Nới ngưỡng chờ, không nới điều kiện phải đúng.
configure({ asyncUtilTimeout: 5000 });

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

// jsdom không hiện thực `ResizeObserver`, mà `Input.TextArea` của Ant Design —
// dùng ở mô tả công việc và ô soạn bình luận — quan sát kích thước để tự giãn.
// Thiếu nó thì mọi test có `TSK-01` hay tab Bình luận đều ném ngay lúc mount,
// và thông báo lỗi không hề nhắc tới component nào gây ra.
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

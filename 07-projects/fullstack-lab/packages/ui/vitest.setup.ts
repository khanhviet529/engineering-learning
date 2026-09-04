import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library chỉ tự dọn DOM khi `globals: true`, vì nó cần một `afterEach`
// toàn cục để móc vào. Ở đây `globals: false`, nên phải đăng ký tường minh —
// thiếu bước này thì DOM của test trước còn sót lại và test sau tìm thấy hai
// phần tử cùng vai trò, hoặc thao tác nhầm vào phần tử cũ.
afterEach(cleanup);

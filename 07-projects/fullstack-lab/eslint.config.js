import base from "@flowboard/config/eslint";

/**
 * Preset dùng chung, cộng đúng một thứ: bỏ qua artefact của Playwright.
 *
 * `playwright-report/` và `test-results/` chứa bundle đã build của trình xem
 * trace — vài nghìn lỗi lint cho code không ai viết và không ai sửa. Chúng đã
 * nằm trong `.gitignore` và `.prettierignore`; đây là chỗ thứ ba, và là chỗ
 * cuối, vì mỗi công cụ đọc danh sách của riêng nó.
 */
export default [{ ignores: ["**/playwright-report/**", "**/test-results/**"] }, ...base];

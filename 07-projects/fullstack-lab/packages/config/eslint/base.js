// Preset ESLint dùng chung cho mọi workspace của Flowboard.
//
// Ngoài các quy tắc chất lượng thông thường, preset này cưỡng chế bằng máy hai
// ranh giới mà [cấu trúc repository](../../../docs/engineering/repository-structure.md)
// đặt ra dưới dạng văn bản:
//
//   1. App và package chỉ import **public entry point** của package khác, không
//      deep-import source hay test fixture nội bộ.
//   2. Không app nào import source nội bộ của app khác.
//
// Ranh giới nào chỉ tồn tại trong tài liệu thì sớm muộn cũng bị vi phạm; ở đây
// nó là lỗi lint chặn merge.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/** Import bị cấm ở mọi workspace. */
const forbiddenImports = [
  {
    group: ["@flowboard/*/src/*", "@flowboard/*/dist/*"],
    message:
      "Chỉ import public entry point của package (@flowboard/<name>), không deep-import vào src hay dist.",
  },
  {
    group: ["**/apps/*/src/**"],
    message: "Không app nào được import source nội bộ của app khác.",
  },
  {
    group: ["../../../*"],
    message:
      "Import leo ra ngoài package là dấu hiệu ranh giới sai. Dùng public entry point của package đích.",
  },
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: forbiddenImports }],

      // Hợp đồng nói rõ error envelope và log không được lộ nội bộ; `console`
      // không phải kênh log của sản phẩm (backend dùng Pino).
      "no-console": ["warn", { allow: ["warn", "error"] }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // File cấu hình ở gốc mỗi package chạy trong ngữ cảnh Node.
    files: ["**/*.config.{js,ts,mjs}", "**/eslint.config.js"],
    rules: { "no-console": "off" },
  },
);

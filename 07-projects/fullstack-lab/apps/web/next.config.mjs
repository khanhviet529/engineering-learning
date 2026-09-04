/**
 * Cấu hình Next.js của Flowboard.
 *
 * `@flowboard/ui` và `@flowboard/contracts` là workspace package phát ra
 * TypeScript, nên Next phải transpile chúng thay vì coi là thư viện đã build.
 *
 * Lint **không** cấu hình ở đây: nó chạy ở gốc workspace bằng một preset duy
 * nhất, và để Next chạy lint riêng sẽ tạo ra hai nguồn quy tắc cho cùng một
 * codebase.
 */

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@flowboard/ui", "@flowboard/contracts"],
};

export default nextConfig;

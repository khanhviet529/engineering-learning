// Gốc workspace dùng lại preset ở @flowboard/config để không có hai nguồn định dạng.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default require("@flowboard/config/prettier");

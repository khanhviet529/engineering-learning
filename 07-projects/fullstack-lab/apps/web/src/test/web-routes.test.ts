import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WEB_ROUTES } from "@flowboard/contracts";
import { INVITATION_ACCEPT_PATH } from "../features/invitations/accept-invitation.tsx";

/**
 * Mỗi path mà server dựng link tới **phải** là một route App Router có thật.
 *
 * Test này tồn tại vì một lỗi cụ thể đã xảy ra và không bên nào bắt được: thư
 * mời trỏ `/loi-moi` trong khi route thật là `/loi-moi/chap-nhan`, nên mọi
 * người được mời nhận `404`. Cả hai bộ test đều xanh — 543 ở `apps/api`, 242 ở
 * đây — vì test backend đọc token **ra khỏi** Mailpit rồi tự gọi API, còn test
 * frontend render component với `token` truyền vào và tự đặt `window.location`.
 * Không bên nào nhìn vào chính cái path trong thư.
 *
 * Đó là hình dạng chung của lỗi ở đường nối: mỗi bên đúng theo hợp đồng mà bên
 * đó đọc, và không ai sở hữu chỗ hai hợp đồng gặp nhau. Nên guard phải đọc
 * **đĩa**, không đọc một hằng số khác — một test so hằng số với hằng số chỉ
 * chứng minh hai chuỗi giống nhau, không chứng minh route tồn tại.
 */
describe("WEB_ROUTES ↔ App Router", () => {
  const appDir = join(process.cwd(), "src", "app");

  it.each(Object.entries(WEB_ROUTES))("%s → %s là route có thật", (_key, route) => {
    // `/loi-moi/chap-nhan` → `src/app/loi-moi/chap-nhan/page.tsx`
    const segments = route.split("/").filter((s) => s.length > 0);
    const pageFile = join(appDir, ...segments, "page.tsx");

    expect(
      existsSync(pageFile),
      `${route} không có route: thiếu ${pageFile}. Server dựng link tới path này trong thư, nên nó phải tồn tại — hoặc sửa WEB_ROUTES, hoặc dựng route.`,
    ).toBe(true);
  });

  it("hằng số của màn chấp nhận lời mời trùng với hằng số dùng chung", () => {
    // `accept-invitation.tsx` cần path này để dựng `?next=` khi chưa có phiên.
    // Hai chỗ khai cùng một path là hai chỗ để lệch; test này giữ chúng bằng
    // nhau cho tới khi có lý do gộp lại.
    expect(INVITATION_ACCEPT_PATH).toBe(WEB_ROUTES.invitationAccept);
  });
});

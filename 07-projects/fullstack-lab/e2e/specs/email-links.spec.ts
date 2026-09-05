import { expect, test, type Page } from "@playwright/test";
import {
  createWorkspace,
  fillField,
  inviteToWorkspace,
  newAccount,
  register,
  visit,
} from "../src/app.ts";
import { WEB_BASE_URL } from "../src/env.ts";
import { allMessages, disposeMailpit, linksIn, readMessage } from "../src/mailpit.ts";

/**
 * Mọi liên kết trong mọi thư sinh ra ở lượt chạy này đều phải **mở được**.
 *
 * Bài kiểm rẻ nhất trong cả bộ, và nó bắt đúng loại bug đắt nhất: ở M2, thư mời
 * trỏ tới `/loi-moi` trong khi route thật là `/loi-moi/chap-nhan`. 954 bài kiểm
 * xanh, và không bài nào chạm được vào chữ trong thư — vì chữ đó do server
 * dựng, còn frontend thì chỉ thấy route của mình.
 *
 * Hai quyết định về phạm vi:
 *
 * 1. **Tự sinh cả ba loại thư.** Sản phẩm có đúng ba liên kết đi từ server về
 *    web — xác minh email, đặt lại mật khẩu, lời mời — và bài kiểm khẳng định
 *    nó thấy đủ ba. Một lần quét không thấy gì cũng xanh là một lần quét vô ích.
 * 2. **Chỉ xét thư sinh ra sau khi spec bắt đầu.** Mailpit giữ thư qua nhiều
 *    lần build; một thư từ bản cũ có route sai sẽ làm bài kiểm đỏ mãi mãi cho
 *    tới khi ai đó xoá hộp thư, và đỏ vì lý do không còn đúng nữa.
 */

test.afterAll(async () => {
  await disposeMailpit();
});

/** Ba route mà `WEB_ROUTES` của `@flowboard/contracts` công bố. */
const EXPECTED_ROUTES = ["/xac-minh-email", "/dat-lai-mat-khau", "/loi-moi/chap-nhan"];

test("mọi liên kết trong thư đều dẫn tới một route có thật", async ({ page }) => {
  const since = Date.now();
  const owner = newAccount("thulink");
  const invitee = newAccount("nguoiduocmoi");

  // 1) Thư xác minh + 2) thư mời, sinh ra bằng chính sản phẩm.
  await register(page, owner);
  const workspaceId = await createWorkspace(page, `Thu ${Date.now().toString(36)}`);
  await inviteToWorkspace(page, workspaceId, invitee.email);

  // 3) Thư đặt lại mật khẩu.
  await visit(page, "/quen-mat-khau");
  await fillField(page, "Email", owner.email);
  await page.getByRole("button", { name: "Gửi hướng dẫn đặt lại" }).click();

  const seenRoutes = new Set<string>();
  const broken: string[] = [];

  await expect
    .poll(
      async () => {
        for (const summary of await allMessages()) {
          if (Date.parse(summary.Created) < since - 1000) continue;
          const message = await readMessage(summary.ID);
          for (const link of linksIn(message)) {
            if (!link.startsWith(WEB_BASE_URL)) continue;
            const route = new URL(link).pathname;
            if (seenRoutes.has(route)) continue;
            seenRoutes.add(route);
            if ((await open(page, link)) === 404) {
              broken.push(`${summary.Subject} → ${route} (404)`);
            }
          }
        }
        return EXPECTED_ROUTES.every((route) => seenRoutes.has(route));
      },
      {
        message: `chưa thấy đủ ba loại thư; mới có ${[...seenRoutes].join(", ") || "(chưa có)"}`,
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      },
    )
    .toBe(true);

  expect(broken, `liên kết trong thư dẫn tới route không tồn tại:\n${broken.join("\n")}`).toEqual(
    [],
  );
});

async function open(page: Page, link: string): Promise<number> {
  const response = await page.goto(link, { waitUntil: "domcontentloaded" });
  // `page.goto` trả `null` khi điều hướng không tạo response mới; ở đây mọi
  // liên kết đều là điều hướng đầy đủ, nên `null` là một bất thường đáng đỏ.
  expect(response, `không mở được ${link}`).not.toBeNull();
  return response?.status() ?? 0;
}

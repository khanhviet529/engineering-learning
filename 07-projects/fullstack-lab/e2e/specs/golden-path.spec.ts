import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInvitation,
  addColumn,
  apiCall,
  createProject,
  createWorkspace,
  inviteToWorkspace,
  newAccount,
  register,
  visit,
  type Account,
} from "../src/app.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * Vòng đời từ đầu tới cuối, **qua trình duyệt, trên stack thật**.
 *
 * Đây không phải bài kiểm tính năng: từng tính năng đã có bộ kiểm riêng ở
 * `apps/web` và `apps/api`. Bài này kiểm thứ mà cả hai bộ kia **không thể**
 * kiểm — rằng các bước **nối được với nhau**: cookie phiên đi qua trình duyệt,
 * liên kết trong thư mở được, và một tài khoản thứ hai vào được đúng chỗ mà
 * tài khoản thứ nhất vừa dựng.
 *
 * Bốn mốc trước đó không mốc nào chạy thử đường này.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await disposeMailpit();
});

/**
 * Tra `userId` của một thành viên workspace.
 *
 * **Đây là một lối tắt, và nó là một phát hiện chứ không phải một tiện ích.**
 * `PRM-01` yêu cầu dán UUID vào ô "Mã người dùng", nhưng không màn hình nào
 * trong sản phẩm hiển thị UUID của bất kỳ ai: bảng thành viên chỉ đưa `userId`
 * vào `key` của React, `USR-01` chỉ hiện tên và email. Nghĩa là chặng "thêm
 * người thứ hai vào dự án" **không đi hết được bằng giao diện**.
 *
 * Bộ kiểm đi vòng qua API để phần còn lại của vòng đời vẫn chạy được, và ghi
 * lại đúng chỗ đứt ở đây thay vì giả vờ rằng nó liền.
 */
async function lookupUserId(page: Page, workspaceId: string, email: string): Promise<string> {
  const result = await apiCall(page, "GET", `/workspaces/${workspaceId}/members`);
  expect(result.status, "không đọc được danh sách thành viên workspace").toBe(200);
  const items = (result.body as { data?: { items?: { userId: string; email: string }[] } }).data
    ?.items;
  const match = items?.find((item) => item.email === email);
  if (match === undefined) {
    throw new Error(`${email} chưa có trong danh sách thành viên của workspace ${workspaceId}`);
  }
  return match.userId;
}

async function newSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("vòng đời Owner → Editor → Viewer đi hết qua giao diện", async ({ browser }) => {
  const owner: Account = newAccount("chuso");
  const partner: Account = newAccount("bandong");

  const ownerPage = await newSession(browser);
  const partnerPage = await newSession(browser);

  let workspaceId = "";
  let projectId = "";
  let partnerUserId = "";
  const projectName = `Du an ${Date.now().toString(36)}`;
  const taskTitle = `Viec dau tien ${Date.now().toString(36)}`;

  await test.step("1 · đăng ký, xác minh qua thư thật, đăng nhập", async () => {
    await register(ownerPage, owner);
  });

  await test.step("2 · tạo không gian, mời người thứ hai, người đó tự vào", async () => {
    workspaceId = await createWorkspace(ownerPage, `Khong gian ${Date.now().toString(36)}`);
    await inviteToWorkspace(ownerPage, workspaceId, partner.email);

    // Lời mời hiện ở bảng "đang chờ" — chưa phải thành viên. Ô đầu mỗi hàng là
    // `th scope=row`, nên nó là `rowheader` chứ không phải `cell`.
    await expect(ownerPage.getByRole("rowheader", { name: partner.email })).toBeVisible();

    // Người được mời tự đăng ký bằng đúng địa chỉ đó, rồi mở liên kết trong thư.
    await register(partnerPage, partner);
    await acceptInvitation(partnerPage, partner.email);

    // Sau khi chấp nhận, họ xuất hiện ở bảng thành viên của Owner.
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("rowheader", { name: new RegExp(partner.displayName) }),
    ).toBeVisible();
  });

  await test.step("3 · tạo dự án, thêm Editor, tạo cột, đổi thứ tự cột", async () => {
    projectId = await createProject(ownerPage, workspaceId, projectName);

    partnerUserId = await lookupUserId(ownerPage, workspaceId, partner.email);

    await ownerPage.getByRole("button", { name: "Thêm thành viên" }).click();
    await ownerPage.getByLabel("Mã người dùng").fill(partnerUserId);
    await ownerPage.getByLabel("Vai trò trong dự án").selectOption("editor");
    await ownerPage.getByRole("button", { name: "Thêm vào dự án" }).click();
    await expect(
      ownerPage.getByRole("rowheader", { name: new RegExp(partner.displayName) }),
    ).toBeVisible();

    // Cột: dự án mới không có cột nào, nên bảng phải nói đúng điều đó trước.
    await visit(ownerPage, `/du-an/${projectId}/bang-cong-viec`);
    await expect(ownerPage.getByText("Bảng công việc chưa có cột nào")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Thêm cột đầu tiên" }).click();

    await addColumn(ownerPage, "Chờ làm");
    await addColumn(ownerPage, "Đang làm");
    await addColumn(ownerPage, "Xong");

    // Đổi thứ tự bằng bàn phím: nhấc cột 3, đưa lên vị trí 2, rồi lưu **một** lần.
    const panel = ownerPage.getByRole("dialog", { name: "Quản lý cột" });
    const grip = panel.getByRole("button", { name: /^Sắp xếp cột Xong, vị trí 3 trên 3$/ });
    await grip.click();
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await ownerPage.keyboard.press("ArrowUp");
    const lifted = panel.getByRole("button", { name: /^Sắp xếp cột Xong, vị trí 2 trên 3$/ });
    await expect(lifted).toBeVisible();
    await lifted.click();
    await panel.getByRole("button", { name: "Lưu thứ tự cột" }).click();
    await expect(panel.getByText("Đã lưu thứ tự cột.")).toBeVisible();

    await panel.getByRole("button", { name: "Hủy" }).click();
    await expect(panel).toHaveCount(0);
    // Thứ tự trên board phản ánh thứ tự vừa lưu.
    const columnNames = await ownerPage
      .getByRole("group", { name: "Cột của bảng công việc" })
      .getByRole("heading", { level: 3 })
      .allInnerTexts();
    expect(columnNames).toEqual(["Chờ làm", "Xong", "Đang làm"]);
  });

  await test.step("4 · tạo việc, giao việc, kéo sang cột khác, bình luận", async () => {
    await ownerPage.getByRole("button", { name: "Tạo công việc" }).click();
    // Form nằm trong lớp phủ, và board phía sau cũng có một bộ lọc mang đúng
    // nhãn "Người thực hiện". Mọi thao tác trên form đều phải neo vào lớp phủ.
    const form = ownerPage.getByRole("dialog", { name: "Tạo công việc" });
    await form.getByLabel("Tiêu đề").fill(taskTitle);
    await form.getByLabel("Trạng thái ban đầu").selectOption({ label: "Chờ làm" });
    await form.getByLabel("Người thực hiện").selectOption({ label: partner.displayName });
    await form.getByRole("button", { name: "Tạo công việc" }).click();

    const board = ownerPage.getByRole("region", { name: "Chờ làm" });
    await expect(board.getByRole("button", { name: taskTitle, exact: true })).toBeVisible();

    // Kéo bằng bàn phím: Space nhấc, mũi tên phải sang cột kế, Space thả.
    const handle = ownerPage.getByRole("button", {
      name: new RegExp(`^Di chuyển ${taskTitle}\\.`),
    });
    await handle.click();
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    // Gửi phím **vào chính tay kéo**, không vào `page.keyboard`: sau mỗi lần
    // đổi cột React gỡ nút ra khỏi cây rồi chèn lại, và trong khoảnh khắc đó
    // focus có thể rơi xuống `body` — phím thứ hai sẽ đi lạc.
    await handle.press("ArrowRight");
    await handle.press("Space");
    await expect(ownerPage.getByText(`Đã chuyển ${taskTitle} sang cột Xong.`)).toBeVisible();
    await expect(
      ownerPage
        .getByRole("region", { name: "Xong" })
        .getByRole("button", { name: taskTitle, exact: true }),
    ).toBeVisible();

    // Bình luận: mở chi tiết, sang tab bình luận, gửi.
    await ownerPage
      .getByRole("region", { name: "Xong" })
      .getByRole("button", { name: taskTitle, exact: true })
      .click();
    await ownerPage.getByRole("tab", { name: "Bình luận" }).click();
    // `getByLabel` khớp cả tabpanel cùng tên; ô soạn là một `textbox`.
    await ownerPage.getByRole("textbox", { name: "Bình luận" }).fill("Da xong buoc dau tien.");
    await ownerPage.getByRole("button", { name: "Gửi bình luận" }).click();
    await expect(ownerPage.getByText("Da xong buoc dau tien.")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Đóng chi tiết công việc" }).click();
  });

  await test.step("5 · Editor thấy đúng ma trận vai trò, không hơn", async () => {
    await visit(partnerPage, `/du-an/${projectId}/bang-cong-viec`);
    await expect(partnerPage.getByRole("region", { name: "Chờ làm" })).toBeVisible();

    // Có: tạo việc, kéo việc.
    await expect(partnerPage.getByRole("button", { name: "Tạo công việc" })).toBeVisible();
    await expect(
      partnerPage.getByRole("button", { name: new RegExp(`^Di chuyển ${taskTitle}\\.`) }),
    ).toBeVisible();

    // Không có: quản lý cột, và không có mục điều hướng tới thành viên dự án.
    await expect(partnerPage.getByRole("button", { name: "Quản lý cột" })).toHaveCount(0);
    await expect(partnerPage.getByRole("link", { name: "Thành viên dự án" })).toHaveCount(0);

    // Vào thẳng URL của bề mặt Owner-only phải ra `SYS-01`, không phải trang trắng.
    await visit(partnerPage, `/du-an/${projectId}/thanh-vien`);
    await expect(partnerPage.locator('[data-screen="SYS-01"]')).toBeVisible();

    // Và lớp phủ cột mở bằng deep link cũng nói `403` chứ không lộ cấu hình.
    await visit(partnerPage, `/du-an/${projectId}/bang-cong-viec?panel=columns`);
    await expect(
      partnerPage.getByText("Vai trò hiện tại của bạn không cấu hình được cột"),
    ).toBeVisible();
  });

  await test.step("6 · sửa nội dung và đổi vai trò — toàn bộ bề mặt ghi qua PATCH", async () => {
    // Hai thao tác cuối của vòng đời đều là `PATCH`, nên chúng đứng cạnh nhau:
    // `PATCH /tasks/:taskId` để sửa nội dung, `PATCH /projects/:id/members/:userId`
    // để hạ vai trò. Gom lại không phải để né lỗi — nó để một lần đỏ chỉ đúng
    // vào **một** bề mặt, thay vì làm năm chặng trước không bao giờ được chạy.
    await visit(ownerPage, `/du-an/${projectId}/bang-cong-viec`);
    await ownerPage
      .getByRole("region", { name: "Xong" })
      .getByRole("button", { name: taskTitle, exact: true })
      .click();
    await ownerPage.getByRole("button", { name: "Sửa công việc" }).click();
    const editForm = ownerPage.getByRole("dialog", { name: "Sửa công việc" });
    await editForm.getByLabel("Độ ưu tiên").selectOption("high");
    await editForm.getByRole("button", { name: "Lưu công việc" }).click();
    // Lưu xong thì form phải **đóng**. Không neo vào chữ công bố: cùng một câu
    // được phát cho cả lần tạo lẫn lần sửa, nên một câu còn sót lại từ lần tạo
    // sẽ làm bài kiểm xanh trong khi lần sửa vừa thất bại.
    await expect(editForm).toHaveCount(0);
    // Neo vào **lớp phủ chi tiết**, không vào cả trang: sau khi lưu, cùng một
    // huy hiệu xuất hiện ở hai chỗ — thẻ trên board và lớp phủ vừa mở lại.
    // Máy chậm thường chỉ kịp vẽ một chỗ, nên một locator không neo sẽ xanh ở
    // máy này và đỏ ở máy nhanh hơn. CI là máy nhanh hơn.
    await expect(
      ownerPage.getByRole("dialog", { name: taskTitle }).getByText("Ưu tiên cao"),
    ).toBeVisible();

    await visit(ownerPage, `/du-an/${projectId}/thanh-vien`);
    await ownerPage
      .getByRole("row", { name: new RegExp(partner.displayName) })
      .getByRole("button", { name: "Quản lý" })
      .click();
    await ownerPage.getByLabel("Vai trò trong dự án").selectOption("viewer");
    await ownerPage.getByRole("button", { name: "Lưu vai trò" }).click();
    await expect(
      ownerPage.getByRole("row", { name: new RegExp(partner.displayName) }).getByText("Viewer"),
    ).toBeVisible();
  });

  await test.step("7 · Viewer đọc được mọi thứ và không ghi được gì", async () => {
    await visit(partnerPage, `/du-an/${projectId}/bang-cong-viec`);
    await expect(partnerPage.getByRole("region", { name: "Chờ làm" })).toBeVisible();

    // Đọc được: bảng, cột, việc.
    await expect(
      partnerPage
        .getByRole("region", { name: "Xong" })
        .getByRole("button", { name: taskTitle, exact: true }),
    ).toBeVisible();

    // Không ghi được: không CTA tạo việc, không tay kéo, không nút sửa.
    await expect(partnerPage.getByRole("button", { name: "Tạo công việc" })).toHaveCount(0);
    await expect(
      partnerPage.getByRole("button", { name: new RegExp(`^Di chuyển ${taskTitle}\\.`) }),
    ).toHaveCount(0);

    await partnerPage
      .getByRole("region", { name: "Xong" })
      .getByRole("button", { name: taskTitle, exact: true })
      .click();
    await expect(partnerPage.getByRole("dialog", { name: taskTitle })).toBeVisible();
    await expect(partnerPage.getByRole("button", { name: "Sửa công việc" })).toHaveCount(0);
    // Đọc bình luận thì được; soạn thì không.
    await partnerPage.getByRole("tab", { name: "Bình luận" }).click();
    await expect(partnerPage.getByText("Da xong buoc dau tien.")).toBeVisible();
    await expect(partnerPage.getByRole("textbox", { name: "Bình luận" })).toHaveCount(0);
  });
});

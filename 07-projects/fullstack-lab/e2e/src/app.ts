import { expect, type Page } from "@playwright/test";
import { API_BASE_URL, SIGN_UP_BUDGET, SIGN_UP_WINDOW_MS } from "./env.ts";
import { waitForMailWithLink } from "./mailpit.ts";

/**
 * Đường đi qua sản phẩm, viết một lần.
 *
 * Mọi hàm ở đây bấm đúng những nút mà người dùng bấm. Chỗ nào **không** đi qua
 * giao diện được thì hàm đó nói ra trong chú thích của chính nó, kèm lý do —
 * một lối tắt không ghi chú sẽ thành một lối tắt không ai nhớ, và bộ E2E sẽ
 * chứng minh một sản phẩm mà không ai dùng được.
 */

export interface Account {
  email: string;
  displayName: string;
  password: string;
}

/**
 * Mật khẩu chung cho mọi tài khoản của bộ kiểm.
 *
 * Nó phải qua được ADR-0007: từ 12 ký tự, và **không chứa** mảnh nào từ 4 ký
 * tự trở lên của email hay tên hiển thị. Vì vậy nó cố ý không có chữ nào dính
 * tới `e2e`, `owner`, `editor` hay `flowboard`.
 */
const PASSWORD = "Tr#i-Xanh-9182-Vjp";

let counter = 0;

/**
 * Một tài khoản chưa từng tồn tại.
 *
 * Không seed, và cũng không dọn database giữa các lần chạy: bộ này phải chạy
 * được nhiều lần trên cùng một stack đang sống, nên định danh phải mới thật.
 */
export function newAccount(role: string): Account {
  counter += 1;
  const stamp = `${Date.now().toString(36)}${counter.toString(36)}`;
  return {
    email: `e2e-${role}-${stamp}@flowboard.test`,
    displayName: `Nguoi ${role} ${stamp}`,
    password: PASSWORD,
  };
}

/**
 * Điền một ô nhập rồi **xác nhận giá trị đã dính**.
 *
 * Cần thiết ngay sau một lần `goto`: Next.js trả HTML trước, React hydrate sau.
 * Gõ vào một ô đã hiện nhưng chưa hydrate thì `input` event không có ai nghe,
 * và khi React gắn vào nó ghi lại `value=""` từ state rỗng — ô trông như bị xoá
 * và nút submit không bao giờ mở.
 *
 * `toPass` thử lại **cả khối**, nên nó dừng ngay khi hydrate xong. Đây là chờ
 * theo điều kiện, không phải `waitForTimeout`.
 */
export async function fillField(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 20_000, intervals: [100, 250, 500] });
}

/**
 * Mở một trang, **thử lại khi kết nối rớt**.
 *
 * Chỉ áp cho điều hướng — một `GET` idempotent, không có tác dụng phụ. Không
 * hàm nào ở đây thử lại một mutation: gửi lại một lệnh ghi mà không biết server
 * đã nhận hay chưa là đúng thứ `Idempotency-Key` sinh ra để xử lý, và giấu nó
 * sau một vòng lặp là bỏ mất chính thứ cần kiểm.
 *
 * Vì sao cần: `next start` sau cổng publish của Docker Desktop trên Windows
 * thỉnh thoảng reset kết nối mới. Đo được ở M5.5 — 40 kết nối mới đồng thời tới
 * `:3000` có vài cái rớt, trong khi `:3001` không rớt cái nào. Đó là bất ổn của
 * môi trường chạy, không phải hành vi của sản phẩm; nhưng để nó rơi vào giữa
 * một spec thì bộ kiểm sẽ đỏ vì lý do không ai đọc được.
 */
export async function visit(page: Page, path: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransportHiccup(error)) throw error;
    }
  }
  throw lastError;
}

/**
 * Một lần rớt ở tầng vận chuyển, không phải một câu trả lời của sản phẩm.
 *
 * `chrome-error://chromewebdata` là những gì Chromium điều hướng tới khi kết
 * nối chết giữa chừng, nên nó thuộc cùng nhóm với `net::ERR_*` và `ECONNRESET`.
 */
export function isTransportHiccup(error: unknown): boolean {
  const text = String(error);
  // Chromium điều hướng tới `chrome-error://chromewebdata/` khi kết nối chết
  // giữa chừng, kể cả khi thông điệp gói nó trong "interrupted by another
  // navigation". Kiểm dấu hiệu đó **trước**.
  if (text.includes("chrome-error://") || text.includes("net::ERR_")) return true;
  // Còn lại, "interrupted by another navigation" tới một URL thật nghĩa là
  // trang đang đi tới đúng chỗ cần tới; thử lại chỉ tạo lần ngắt tiếp theo.
  if (text.includes("interrupted by another navigation")) return false;
  return text.includes("ECONNRESET") || text.includes("socket hang up");
}

/**
 * Nhịp cho `POST /auth/sign-up`.
 *
 * Server giới hạn **5 lần mỗi 60 giây mỗi IP** (`RATE_LIMIT_RULES` ở
 * `apps/api/src/shared/http/rate-limit.ts`), và cả bộ E2E đi ra từ một IP.
 * Giới hạn đó **đúng** — nó là một biện pháp chống lạm dụng thật — nên bộ kiểm
 * phải sống chung với nó thay vì đòi nới. Môi trường nào nới nó bằng
 * `RATE_LIMIT_OVERRIDES` thì nới cả `E2E_SIGN_UP_BUDGET` ở đây; xem `env.ts`.
 *
 * Cách sai là bấm lại rồi bấm lại: mỗi lần bấm tiêu thêm một token, nên vòng
 * lặp tự bỏ đói chính nó. Đã đo được điều đó ở M5.5 — một lượt chạy 17 phút
 * với ba spec chết vì hết giờ chờ.
 *
 * Cách đúng là **giữ nhịp trước khi gửi**: mô phỏng đúng cái xô token của
 * server và chỉ gửi khi chắc chắn còn chỗ. Đây không phải `waitForTimeout` chờ
 * một điều kiện giao diện — nó là phép chia thời gian theo một hạn mức đã
 * công bố, và không có tín hiệu nào để chờ thay cho nó.
 */
const signUpTimes: number[] = [];
let signUpQueue: Promise<void> = Promise.resolve();

async function paceSignUp(): Promise<void> {
  const turn = signUpQueue.then(async () => {
    const now = Date.now();
    while (signUpTimes.length > 0 && now - (signUpTimes[0] ?? 0) >= SIGN_UP_WINDOW_MS) {
      signUpTimes.shift();
    }
    if (signUpTimes.length >= SIGN_UP_BUDGET) {
      const oldest = signUpTimes[0] ?? now;
      const waitMs = SIGN_UP_WINDOW_MS - (now - oldest) + 500;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      signUpTimes.shift();
    }
    signUpTimes.push(Date.now());
  });
  signUpQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

/** Tạo tài khoản qua `AUTH-02`. Kết thúc ở màn “đã gửi thư xác minh”. */
export async function signUp(page: Page, account: Account): Promise<void> {
  await visit(page, "/dang-ky");
  await fillSignUpForm(page, account);

  const sent = page.getByText("Đã gửi thư xác minh");

  // Giữ nhịp **trước** khi bấm, không bấm rồi mới chờ: xem `paceSignUp`.
  await paceSignUp();
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();

  if (!(await settled(sent))) {
    // Xô token của server đếm cả những lần gọi ngoài bộ kiểm này, nên nhịp phía
    // client có thể lệch. Chờ **trọn** một cửa sổ rồi thử lại đúng **một** lần:
    // bấm dồn chỉ tiêu thêm token và làm vòng lặp tự bỏ đói chính nó.
    await waitOutRateLimitWindow();
    await page.reload();
    await fillSignUpForm(page, account);
    await page.getByRole("button", { name: "Tạo tài khoản" }).click();
    await expect(sent).toBeVisible({ timeout: 30_000 });
  }
}

/**
 * Điền form đăng ký cho tới khi **nút submit mở ra**.
 *
 * `fillField` chỉ khẳng định giá trị nằm trong DOM, và chừng đó chưa đủ: trước
 * khi React hydrate, `input` event không có ai nghe, nên ô có chữ mà state vẫn
 * rỗng — checklist mật khẩu không đạt và nút `Tạo tài khoản` ở lại `disabled`
 * vĩnh viễn. Tín hiệu đúng để chờ là **nút đã mở**, vì nó là hệ quả của state,
 * không phải của DOM.
 */
async function fillSignUpForm(page: Page, account: Account): Promise<void> {
  const submit = page.getByRole("button", { name: "Tạo tài khoản" });
  let attempt = 0;
  await expect(async () => {
    // Từ lần thử thứ hai trở đi thì nạp lại trang. Điền lại một trang **chưa
    // bao giờ hydrate** sẽ không bao giờ mở được nút: một chunk JavaScript rớt
    // giữa chừng để lại đúng cái trang đó — HTML đầy đủ, không có React. Chỉ
    // một lần tải lại mới sửa được, và nó chỉ là một `GET`.
    if (attempt > 0) await page.reload();
    attempt += 1;
    await fillField(page, "Email", account.email);
    await fillField(page, "Tên hiển thị", account.displayName);
    await fillField(page, "Mật khẩu", account.password);
    await expect(submit).toBeEnabled({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [250, 1_000, 3_000] });
}

/** Điều kiện đã đúng trong khoảng chờ, thay vì ném ra ngoài. */
async function settled(locator: ReturnType<Page["getByText"]>): Promise<boolean> {
  try {
    await expect(locator).toBeVisible({ timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** Một cửa sổ trọn vẹn của xô token, cộng một chút lề. */
function waitOutRateLimitWindow(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SIGN_UP_WINDOW_MS + 2_000));
}

/**
 * Lấy liên kết xác minh **từ API của Mailpit** rồi mở nó.
 *
 * Đây là chỗ hai lane gặp nhau lần đầu: liên kết do server dựng từ
 * `WEB_ORIGIN`, và nếu nó trỏ sai route thì không bộ kiểm mock nào bắt được —
 * đó đúng là lỗi `/loi-moi` của M2.
 */
export async function verifyEmail(page: Page, account: Account): Promise<void> {
  const { link } = await waitForMailWithLink(account.email, "/xac-minh-email");
  await page.goto(link);
  await expect(page.getByText("Email đã được xác minh")).toBeVisible();
}

/** Đăng nhập qua `AUTH-01` và chờ tới khi đã ở trong app. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await visit(page, "/dang-nhap");
  await fillField(page, "Email", account.email);
  await fillField(page, "Mật khẩu", account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  const landed = page.getByRole("heading", { name: "Chọn không gian làm việc" });
  if (!(await settled(landed))) {
    // `POST /auth/sign-in` có hạn mức riêng (10 lần mỗi phút mỗi IP). Cùng cách
    // xử lý như đăng ký: chờ trọn một cửa sổ, thử lại đúng một lần.
    await waitOutRateLimitWindow();
    await visit(page, "/dang-nhap");
    await fillField(page, "Email", account.email);
    await fillField(page, "Mật khẩu", account.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(landed).toBeVisible({ timeout: 30_000 });
  }
}

/** Đăng ký → xác minh → đăng nhập, ba chặng liền nhau. */
export async function register(page: Page, account: Account): Promise<void> {
  await signUp(page, account);
  await verifyEmail(page, account);
  await signIn(page, account);
}

/** Tạo workspace qua `WSP-02`; trả về id đọc từ URL sau khi điều hướng. */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  await visit(page, "/khong-gian-lam-viec");
  await page.getByRole("button", { name: "Tạo không gian" }).first().click();
  await page.getByLabel("Tên không gian").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo không gian" }).click();
  await page.waitForURL(/\/khong-gian-lam-viec\/[0-9a-f-]{36}$/);
  return idFromPath(page.url(), "khong-gian-lam-viec");
}

/** Gửi lời mời qua `WSP-03`. Response luôn giống nhau, nên không suy ra gì. */
export async function inviteToWorkspace(
  page: Page,
  workspaceId: string,
  email: string,
): Promise<void> {
  await visit(page, `/khong-gian-lam-viec/${workspaceId}/thanh-vien`);
  await page.getByRole("button", { name: "Mời thành viên" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  await expect(page.getByText(/Đã gửi lời mời nếu địa chỉ hợp lệ/)).toBeVisible();
}

/** Mở thư mời từ Mailpit và chấp nhận qua `WSP-05`. */
export async function acceptInvitation(page: Page, email: string): Promise<void> {
  // Hộp thư này thường có **hai** thư: thư xác minh tài khoản và thư mời, và
  // thư mới nhất không nhất thiết là thư mời. Hỏi đúng thư có liên kết cần tìm.
  const { link } = await waitForMailWithLink(email, "/loi-moi");
  await page.goto(link);
  await expect(page.getByText(/Bạn đã là thành viên của/)).toBeVisible();
}

/** Tạo dự án qua `PRJ-02`; trả về id đọc từ URL sau khi điều hướng. */
export async function createProject(
  page: Page,
  workspaceId: string,
  name: string,
): Promise<string> {
  await visit(page, `/khong-gian-lam-viec/${workspaceId}`);
  await page.getByRole("button", { name: "Tạo dự án" }).click();
  await page.getByLabel("Tên dự án").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Tạo dự án" }).click();
  await page.waitForURL(/\/du-an\/[0-9a-f-]{36}\/thanh-vien$/);
  return idFromPath(page.url(), "du-an");
}

/** Thêm cột qua `BRD-02`. Panel phải đang mở. */
export async function addColumn(page: Page, name: string): Promise<void> {
  const panel = page.getByRole("dialog", { name: "Quản lý cột" });
  await panel.getByLabel("Tên cột mới").fill(name);
  // Neo vào **form**, không vào nhãn nút: khi đang gửi, Ant Design chèn một icon
  // loading vào tên khả truy cập ("loading Thêm cột"), nên một locator khớp nhãn
  // sẽ đứng chờ tới hết giờ của cả spec thay vì đỏ ở giây thứ mười lăm.
  await panel.locator("#board-column-add-form").getByRole("button").click();
  await expect(panel.getByLabel(new RegExp(`^Sắp xếp cột ${escapeRegExp(name)},`))).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFromPath(url: string, segment: string): string {
  const parts = new URL(url).pathname.split("/");
  const index = parts.indexOf(segment);
  const id = parts[index + 1];
  if (id === undefined) throw new Error(`Không đọc được id sau “${segment}” trong ${url}`);
  return id;
}

export interface ApiCall {
  status: number;
  code: string | undefined;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Gọi API **từ chính trang đang mở**, bằng cookie thật của trình duyệt.
 *
 * Đây không phải một lối tắt để né giao diện: nó là dụng cụ của hai bài kiểm
 * mà giao diện cố tình không có nút — Viewer gọi thẳng một mutation, và một
 * `Idempotency-Key` được phát lại. "Ẩn nút" không phải phân quyền, nên phải có
 * một đường gọi **không** đi qua nút để chứng minh server tự đứng vững.
 *
 * CSRF token lấy từ `GET /auth/session` ngay trước lệnh gọi, đúng như
 * `apps/web` làm: nếu vòng đời token hỏng thì bài kiểm hỏng theo, và đó là kết
 * quả đúng.
 */
/**
 * CSRF token đã đọc, theo từng `Page`.
 *
 * `apiCall` từng hỏi `GET /auth/session` trước **mỗi** lệnh. Với spec dựng 60
 * công việc, đó là 60 request không kiểm gì cả — và chúng đủ để đẩy một spec
 * qua giới hạn thời gian. Token gắn với phiên, nên đọc một lần là đủ; xoá cache
 * khi một lệnh trả `403`, vì đó là lúc token có thể đã đổi.
 */
const csrfCache = new WeakMap<Page, string>();

export async function apiCall(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; csrfToken?: string | null } = {},
): Promise<ApiCall> {
  const cached = options.csrfToken === undefined ? csrfCache.get(page) : undefined;

  const result = await page.evaluate(
    async (input): Promise<ApiCall & { csrf: string | null }> => {
      const headers: Record<string, string> = {};

      let csrf: string | null;
      if (input.csrfToken === undefined) {
        const session = await fetch(`${input.apiBase}/auth/session`, { credentials: "include" });
        const payload: unknown = await session.json().catch(() => null);
        const data = (payload as { data?: { csrfToken?: string } } | null)?.data;
        csrf = data?.csrfToken ?? null;
      } else {
        csrf = input.csrfToken;
      }
      if (csrf !== null && input.method !== "GET") headers["x-csrf-token"] = csrf;
      if (input.body !== undefined) headers["content-type"] = "application/json";
      if (input.idempotencyKey !== undefined) headers["idempotency-key"] = input.idempotencyKey;

      let response: Response;
      try {
        response = await fetch(`${input.apiBase}${input.path}`, {
          method: input.method,
          headers,
          credentials: "include",
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        });
      } catch (error) {
        // Request **không rời được trình duyệt**: preflight CORS bị chặn, mạng
        // đứt, hoặc origin sai. Trả về một hình dạng đọc được thay vì ném một
        // `TypeError` trần, để chỗ khẳng định nói được điều gì đã xảy ra.
        return {
          status: 0,
          code: "TRANSPORT_BLOCKED",
          body: `${input.method} ${input.path} không rời được trình duyệt: ${String(error)}`,
          headers: {},
          csrf,
        };
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        parsed = text;
      }

      const collected: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        collected[key] = value;
      });

      return {
        status: response.status,
        code: (parsed as { error?: { code?: string } } | null)?.error?.code,
        body: parsed,
        headers: collected,
        csrf,
      };
    },
    {
      apiBase: API_BASE_URL,
      method,
      path,
      body: options.body,
      idempotencyKey: options.idempotencyKey,
      // `null` tường minh nghĩa là "gửi **không** kèm token", khác hẳn với
      // "chưa biết token" — nên không dùng `??` ở đây.
      csrfToken: options.csrfToken !== undefined ? options.csrfToken : cached,
    },
  );

  const { csrf, ...call } = result;
  if (options.csrfToken === undefined) {
    if (csrf !== null && call.status !== 403) csrfCache.set(page, csrf);
    else csrfCache.delete(page);
  }
  return call;
}

/**
 * Dựng sẵn một dự án có cột, **qua giao diện**.
 *
 * Ba bài kiểm hành vi runtime đều cần một board dùng được trước khi chúng bắt
 * đầu đo thứ chúng thật sự quan tâm. Dựng nó bằng cùng những cú bấm mà golden
 * path dùng, chứ không bằng một seed: một seed ghi thẳng database sẽ bỏ qua
 * đúng đoạn đường đang được kiểm ở chỗ khác.
 */
export async function setupBoard(
  page: Page,
  columns: readonly string[],
): Promise<{ workspaceId: string; projectId: string }> {
  const stamp = Date.now().toString(36);
  const workspaceId = await createWorkspace(page, `Khong gian ${stamp}`);
  const projectId = await createProject(page, workspaceId, `Du an ${stamp}`);

  await visit(page, `/du-an/${projectId}/bang-cong-viec`);
  await page.getByRole("button", { name: "Thêm cột đầu tiên" }).click();
  for (const column of columns) await addColumn(page, column);

  const panel = page.getByRole("dialog", { name: "Quản lý cột" });
  await panel.getByRole("button", { name: "Hủy" }).click();
  await expect(panel).toHaveCount(0);

  return { workspaceId, projectId };
}

/** Tạo một công việc qua `TSK-01`. Trang phải đang ở board. */
export async function createTask(
  page: Page,
  input: { title: string; column: string; assignee?: string },
): Promise<void> {
  await page.getByRole("button", { name: "Tạo công việc" }).click();
  // Board phía sau có một bộ lọc mang đúng nhãn "Người thực hiện", nên form
  // phải được neo vào lớp phủ chứ không tìm trên cả trang.
  const form = page.getByRole("dialog", { name: "Tạo công việc" });
  await form.getByLabel("Tiêu đề").fill(input.title);
  await form.getByLabel("Trạng thái ban đầu").selectOption({ label: input.column });
  if (input.assignee !== undefined) {
    await form.getByLabel("Người thực hiện").selectOption({ label: input.assignee });
  }
  await form.getByRole("button", { name: "Tạo công việc" }).click();
  await expect(
    page
      .getByRole("region", { name: input.column })
      .getByRole("button", { name: input.title, exact: true }),
  ).toBeVisible();
}

/**
 * Tạo nhiều công việc trong **một** lượt vào trình duyệt.
 *
 * `apiCall` là một `page.evaluate` cho mỗi lệnh, và sáu mươi lượt như vậy tốn
 * nhiều thời gian hơn chính sáu mươi request cộng lại. Bài kiểm cursor cần một
 * danh sách dài để có trang thứ ba; số lượng là **điều kiện**, không phải thứ
 * đang được đo, nên nó được dựng bằng một vòng lặp chạy trong trang.
 *
 * Vẫn là HTTP thật, cookie thật, `Idempotency-Key` thật, mỗi việc một key.
 */
export async function seedTasks(
  page: Page,
  input: { projectId: string; columnId: string; assigneeId: string; prefix: string; count: number },
): Promise<void> {
  const failures = await page.evaluate(
    async (job): Promise<string[]> => {
      const session = await fetch(`${job.apiBase}/auth/session`, { credentials: "include" });
      const payload: unknown = await session.json().catch(() => null);
      const csrf = (payload as { data?: { csrfToken?: string } } | null)?.data?.csrfToken ?? "";

      const problems: string[] = [];
      for (let index = 0; index < job.count; index += 1) {
        const response = await fetch(`${job.apiBase}/projects/${job.projectId}/tasks`, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            title: `${job.prefix} ${String(index).padStart(2, "0")}`,
            columnId: job.columnId,
            assigneeId: job.assigneeId,
          }),
        });
        if (response.status !== 201) {
          problems.push(
            `việc thứ ${String(index)}: ${String(response.status)} ${await response.text()}`,
          );
        }
      }
      return problems;
    },
    { apiBase: API_BASE_URL, ...input },
  );

  expect(failures, `không tạo đủ ${String(input.count)} việc`).toEqual([]);
}

/** Tên cookie phiên, đọc từ chính cookie jar sau khi đăng nhập. */
export const SESSION_COOKIE_CANDIDATES = ["fb_session", "session", "sid", "flowboard_session"];

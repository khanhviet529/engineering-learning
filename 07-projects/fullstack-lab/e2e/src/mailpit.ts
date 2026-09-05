import { expect, request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { MAILPIT_URL } from "./env.ts";

/**
 * Đọc hộp thư của Mailpit qua **API của chính nó**, không qua giao diện web.
 *
 * Vì sao không bấm vào UI của Mailpit: nó không phải sản phẩm đang được kiểm.
 * Một bài E2E lệ thuộc vào bố cục của một công cụ bên thứ ba sẽ đỏ vào ngày
 * công cụ đó đổi giao diện, và người đọc sẽ tưởng Flowboard hỏng.
 */

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

export interface MailMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

let context: APIRequestContext | undefined;

async function api(): Promise<APIRequestContext> {
  context ??= await request.newContext({ baseURL: MAILPIT_URL });
  return context;
}

export async function disposeMailpit(): Promise<void> {
  await context?.dispose();
  context = undefined;
}

/**
 * Đọc Mailpit, **thử lại khi kết nối rớt**.
 *
 * Chỉ `GET`, chỉ với một công cụ phụ trợ: Mailpit không phải sản phẩm đang được
 * kiểm, và một lần `ECONNRESET` khi hỏi hộp thư không nói gì về Flowboard.
 */
async function get(path: string): Promise<APIResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await (await api()).get(path);
    } catch (error) {
      lastError = error;
      context = undefined;
    }
  }
  throw lastError;
}

/** Mọi thư đang có trong hộp, mới nhất trước. */
export async function allMessages(limit = 200): Promise<MailSummary[]> {
  const response = await get(`/api/v1/messages?limit=${String(limit)}`);
  expect(response.ok(), `Mailpit không trả danh sách thư: ${String(response.status())}`).toBe(true);
  const body = (await response.json()) as { messages?: MailSummary[] };
  return body.messages ?? [];
}

/** Thư gửi tới một địa chỉ, mới nhất trước. */
export async function messagesTo(address: string): Promise<MailSummary[]> {
  const query = encodeURIComponent(`to:${address}`);
  const response = await get(`/api/v1/search?query=${query}&limit=50`);
  expect(response.ok(), `Mailpit không tìm được thư: ${String(response.status())}`).toBe(true);
  const body = (await response.json()) as { messages?: MailSummary[] };
  return body.messages ?? [];
}

export async function readMessage(id: string): Promise<MailMessage> {
  const response = await get(`/api/v1/message/${id}`);
  expect(response.ok(), `Mailpit không đọc được thư ${id}`).toBe(true);
  return (await response.json()) as MailMessage;
}

/**
 * Chờ tới khi có **ít nhất** `count` thư gửi tới địa chỉ này, rồi trả thư mới nhất.
 *
 * `expect.poll` chứ không phải `waitForTimeout`: nó dừng ngay khi điều kiện
 * đúng, và khi sai thì nó báo *điều kiện nào* sai chứ không chỉ báo hết giờ.
 */
export async function waitForMail(address: string, count = 1): Promise<MailMessage> {
  await expect
    .poll(async () => (await messagesTo(address)).length, {
      message: `không thấy ${String(count)} thư nào gửi tới ${address}`,
      timeout: 30_000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThanOrEqual(count);

  const [latest] = await messagesTo(address);
  if (latest === undefined) throw new Error(`Mailpit mất thư của ${address} giữa hai lần đọc`);
  return readMessage(latest.ID);
}

/**
 * Mọi liên kết trong một thư — cả phần HTML lẫn phần text thuần.
 *
 * Đọc cả hai phần là có chủ ý: một thư chỉ đúng ở bản HTML còn bản text trỏ
 * sai vẫn là một thư hỏng, và người đọc thư bằng client text-only là người
 * gặp nó.
 */
export function linksIn(message: Pick<MailMessage, "HTML" | "Text">): string[] {
  const found = new Set<string>();

  for (const match of (message.HTML ?? "").matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const href = match[1];
    if (href !== undefined) found.add(decodeEntities(href));
  }
  for (const match of (message.Text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    found.add(match[0]);
  }

  return [...found].filter((href) => href.startsWith("http://") || href.startsWith("https://"));
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

/**
 * Chờ tới khi hộp thư của địa chỉ này có một thư **chứa liên kết** khớp `fragment`.
 *
 * "Thư mới nhất" là một giả định sai ở đây: một người vừa được mời rồi mới
 * đăng ký sẽ có thư xác minh nằm **trên** thư mời. Bài kiểm phải hỏi đúng thứ
 * nó cần, không phải hỏi thứ đến sau cùng.
 */
export async function waitForMailWithLink(
  address: string,
  fragment: string,
): Promise<{ message: MailMessage; link: string }> {
  let found: { message: MailMessage; link: string } | undefined;

  await expect
    .poll(
      async () => {
        for (const summary of await messagesTo(address)) {
          const message = await readMessage(summary.ID);
          const link = linksIn(message).find((href) => href.includes(fragment));
          if (link !== undefined) {
            found = { message, link };
            return true;
          }
        }
        return false;
      },
      {
        message: `không thấy thư nào gửi tới ${address} chứa liên kết có "${fragment}"`,
        // 60 giây chứ không 30: chỉ mục tìm kiếm của Mailpit thỉnh thoảng chậm
        // hơn lúc nhận thư, và một lần chậm như vậy đã làm cả spec đỏ vì một lý
        // do không liên quan gì tới sản phẩm.
        timeout: 60_000,
        intervals: [250, 500, 1000],
      },
    )
    .toBe(true);

  if (found === undefined) throw new Error("không thể xảy ra: poll xanh mà không có kết quả");
  return found;
}

/** Liên kết đầu tiên trỏ về web app và khớp một đoạn đường dẫn. */
export function linkContaining(message: MailMessage, fragment: string): string {
  const link = linksIn(message).find((href) => href.includes(fragment));
  if (link === undefined) {
    throw new Error(
      `Thư “${message.Subject}” không chứa liên kết nào có “${fragment}”. Các liên kết thấy được: ${linksIn(message).join(", ") || "(không có)"}`,
    );
  }
  return link;
}

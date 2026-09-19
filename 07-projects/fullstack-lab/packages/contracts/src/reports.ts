import { z } from "zod";
import { instantSchema, uuidSchema } from "./fields.js";
import { taskFilterFields } from "./tasks.js";

/**
 * Export tiến độ — `docs/api/endpoint-contracts.md` mục Reports, Phase 1.1.
 *
 * Ba endpoint, và chúng cố ý **không** là một:
 *
 * | Endpoint | Trả gì | Vì sao tách |
 * |---|---|---|
 * | `POST /projects/:projectId/reports/progress-export` | `202` + record | Sinh file không nằm trong transaction |
 * | `GET /reports/:reportId` | metadata | Client hỏi "xong chưa" mà không tải |
 * | `GET /reports/:reportId/download` | stream XLSX | File **không** bọc trong JSON |
 *
 * Vì sao `202` chứ không `201`: request được nhận, file **chưa** tồn tại. Một
 * `201` nói rằng thứ vừa tạo đã có thể lấy được, và client sẽ tải ngay rồi
 * nhận `409`. Mã trạng thái là lời hứa với client, không phải một nhãn.
 *
 * **Chưa có queue, và đó là quyết định.** Owner chủ động bấm tải một file;
 * chưa có delivery bất đồng bộ nên chưa có lý do thêm Redis/BullMQ. Thêm sớm
 * là tăng thành phần vận hành mà không hoàn tất thêm một nhu cầu nào — xem
 * `docs/implementation-plan.md` mục "Sau M6".
 */

/**
 * Trạng thái server **ghi**. `expired` cố ý **không** nằm ở đây.
 *
 * Hết hạn là một quan hệ giữa `expiresAt` và đồng hồ, không phải một sự kiện
 * ai đó phải nhớ ghi lại. Nếu nó là một status thì phải có thứ gì chạy để lật
 * nó, và mọi report hết hạn trong khoảng chưa lật sẽ nói sai về chính mình.
 * Client suy ra `expired` bằng cách so `expiresAt` với hiện tại.
 *
 * `purged` thì **có** ghi, vì nó là một hành động thật: file đã bị xoá khỏi
 * storage. Một report `purged` và một report hết hạn khác nhau ở chỗ cái đầu
 * chắc chắn không lấy lại được.
 */
export const REPORT_STATUSES = ["requested", "ready", "failed", "purged"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const reportStatusSchema = z.enum(REPORT_STATUSES);

/**
 * Bộ lọc của một lần export: đúng bộ lọc task canonical, **trừ hai field**.
 *
 * `sort` bị loại vì thứ tự dòng trong file do server quyết. Để client chọn
 * `sort` nghĩa là hai lần export cùng dữ liệu cho ra hai file khác nhau, và
 * khi đó "cùng canonical payload → cùng record" của idempotency trở thành một
 * lời hứa về thứ tự dòng mà không ai muốn giữ.
 *
 * `columnId` bị loại vì một báo cáo **tiến độ** nói về cả bàn: lọc còn một cột
 * thì phần "tiến độ" không còn nghĩa gì. Muốn nhìn một cột thì dùng
 * `GET /projects/:projectId/tasks`.
 *
 * Hai chỗ loại này là **quyết định của tôi**, không phải điều tài liệu văn
 * xuôi đã nói rõ. Thấy sai thì nói, đừng lặng lẽ thêm lại.
 */
export const reportFilterSchema = z
  .object({
    assigneeId: taskFilterFields.assigneeId,
    createdById: taskFilterFields.createdById,
    reviewerId: taskFilterFields.reviewerId,
    category: taskFilterFields.category,
    priority: taskFilterFields.priority,
    dueState: taskFilterFields.dueState,
    dueFrom: taskFilterFields.dueFrom,
    dueTo: taskFilterFields.dueTo,
    search: taskFilterFields.search,
  })
  .strict()
  .refine((f) => !f.dueFrom || !f.dueTo || f.dueFrom <= f.dueTo, {
    message: "dueFrom phải nhỏ hơn hoặc bằng dueTo.",
    path: ["dueFrom"],
  });

export type ReportFilter = z.infer<typeof reportFilterSchema>;

/**
 * Body của request export. Đúng một field.
 *
 * `projectId` nằm trên path, không nằm trong body — cùng quy tắc với mọi
 * endpoint project-scoped khác. `expiresAt` do server tính; client gửi nó là
 * `400`, không phải một gợi ý được cân nhắc.
 */
export const requestProgressExportRequestSchema = z
  .object({ filters: reportFilterSchema })
  .strict();

export type RequestProgressExportRequest = z.infer<typeof requestProgressExportRequestSchema>;

/**
 * Metadata của một report. **Một** shape cho cả `202` và `GET`.
 *
 * Tài liệu văn xuôi trước đây mô tả hai shape: `202` trả năm field, `GET` trả
 * chín. Tôi gộp lại, và sửa tài liệu cho khớp thay vì để code đi một đường.
 * Hai shape cho cùng một tài nguyên là hai đường để client sai, và cái sai đó
 * chỉ lộ ra ở trạng thái `ready` — tức là muộn.
 *
 * Ba field mô tả file là `.nullable()` vì lúc `requested` **chưa có file**.
 * `null` nói đúng điều đó; một chuỗi rỗng thì không.
 *
 * `fileStorageKey` và snapshot bộ lọc **không bao giờ** xuất hiện ở đây. Khoá
 * storage là đường đi tới file; đưa nó ra ngoài là đưa ra một đường vòng qua
 * mọi lượt kiểm quyền mà `GET /reports/:reportId/download` đang làm.
 */
export const reportExportSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    status: reportStatusSchema,
    fileName: z.string().min(1).max(255).nullable(),
    contentType: z.string().min(1).max(255).nullable(),
    byteSize: z.int().nonnegative().nullable(),
    expiresAt: instantSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();

export type ReportExport = z.infer<typeof reportExportSchema>;

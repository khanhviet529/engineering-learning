/**
 * Cổng đọc board column của một project.
 *
 * ## Vì sao là port chứ không phải import chéo
 *
 * `GET /projects/:projectId` thuộc module `projects`, và từ M3 hợp đồng nói
 * response phải mang **active column** của project — `endpoint-contracts.md`
 * mục "GET /projects/:projectId": *"`columns` từ M3"*. Nhưng đồ thị phụ thuộc
 * của ADR-0005 chạy theo chiều `board-columns → projects`; `projects` import
 * `board-columns` sẽ đảo chiều đó và tạo cycle.
 *
 * Nên `projects` **định nghĩa** hình dạng nó cần, module `board-columns`
 * implement, và composition root nối. Đây đúng khuôn mẫu của
 * `ColumnEmptinessCheck` ở chiều ngược lại, và cả hai cùng tồn tại được chính
 * vì cả hai đều là port: chiều import ở source code vẫn chỉ có một.
 */

export interface ProjectColumnView {
  id: string;
  projectId: string;
  name: string;
  requiresReviewer: boolean;
  isTerminal: boolean;
  position: number;
  archivedAt: Date | null;
}

export interface ProjectColumnsQuery {
  /** Column **active** của project, theo thứ tự board. */
  activeColumnsOf(projectId: string): Promise<ProjectColumnView[]>;
}

/**
 * Adapter dùng khi chưa có bảng `board_columns`.
 *
 * Giữ lại để mốc trước M3 vẫn dựng được module, và để test nào không quan tâm
 * tới column khỏi phải nối một adapter thật. Nó trả mảng rỗng **một cách tường
 * minh** chứ không phải vì quên nối dây.
 */
export class NoColumnsQuery implements ProjectColumnsQuery {
  async activeColumnsOf(): Promise<ProjectColumnView[]> {
    return [];
  }
}

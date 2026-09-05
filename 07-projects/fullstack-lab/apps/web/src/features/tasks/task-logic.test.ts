import { describe, expect, it } from "vitest";
import { columns, tasks } from "@flowboard/mock";
import type { Task } from "@flowboard/contracts";
import { canonicalFilters, filterFingerprint, taskQueryParams } from "./task-filters.ts";
import { positionForIndex, positionHint } from "./position.ts";
import { neighbourColumn, projectColumn, type DragState } from "./board-dnd.ts";
import { newerOf } from "./task-ledger.ts";

/**
 * Phần thuần của M4, kiểm trực tiếp.
 *
 * Bốn chỗ dễ sai mà kế hoạch triển khai nêu tên đều có một hạt nhân không cần
 * React: fingerprint của filter, gợi ý vị trí, phép chiếu kéo-thả, và so sánh
 * version. Kiểm chúng ở đây thì một lỗi lệch một chỉ số hiện ra ngay, thay vì
 * hiện ra sau sáu bước tương tác dưới dạng "card nhảy sai chỗ".
 */

const [first = tasks[0] as Task, second = tasks[1] as Task] = tasks;

describe("fingerprint của filter", () => {
  it("cùng một tập điều kiện cho cùng một chuỗi, bất kể thứ tự khai", () => {
    const a = filterFingerprint({ priority: "high", search: "abc" });
    const b = filterFingerprint({ search: "abc", priority: "high" });
    expect(a).toBe(b);
  });

  it("đổi một điều kiện là đổi fingerprint — đây là cả cơ chế chống stale", () => {
    expect(filterFingerprint({ priority: "high" })).not.toBe(
      filterFingerprint({ priority: "low" }),
    );
  });

  it("chuỗi rỗng và không chọn là **một** — nếu không sẽ có hai key cho một truy vấn", () => {
    expect(filterFingerprint({ search: "" })).toBe(filterFingerprint({}));
    expect(filterFingerprint({ search: "   " })).toBe(filterFingerprint({}));
  });

  it("khoảng trắng thừa ở hai đầu không tạo truy vấn khác", () => {
    expect(filterFingerprint({ search: " abc " })).toBe(filterFingerprint({ search: "abc" }));
  });

  it("canonical bỏ hẳn khoá rỗng thay vì giữ giá trị rỗng", () => {
    expect(canonicalFilters({ search: "", priority: "high" })).toEqual({ priority: "high" });
  });
});

describe("query gửi lên server", () => {
  it("luôn mang columnId và limit", () => {
    const params = taskQueryParams({}, "col-1", 25);
    expect(params.get("columnId")).toBe("col-1");
    expect(params.get("limit")).toBe("25");
  });

  it("chỉ gửi những trục có trong allowlist của hợp đồng", () => {
    const params = taskQueryParams({ search: "x", priority: "high" }, "col-1", 25, "cur");
    expect([...params.keys()].sort()).toEqual(
      ["columnId", "cursor", "limit", "priority", "search"].sort(),
    );
  });

  it("không gửi khoá cho điều kiện chưa chọn", () => {
    const params = taskQueryParams({ search: "x" }, "col-1", 25);
    expect(params.has("priority")).toBe(false);
    expect(params.has("assigneeId")).toBe(false);
  });
});

describe("gợi ý vị trí", () => {
  it("giữa hai hàng xóm là điểm giữa", () => {
    expect(Number(positionHint("1024", "2048"))).toBe(1536);
  });

  it("thả xuống cuối cột thì cách hàng xóm cuối một nhịp 1024", () => {
    expect(Number(positionHint("2048", undefined))).toBe(2048 + 1024);
  });

  it("thả lên đầu cột thì lấy nửa vị trí của hàng xóm đầu", () => {
    expect(Number(positionHint(undefined, "1024"))).toBe(512);
  });

  it("cột rỗng dùng spacing khởi đầu của ADR-0006", () => {
    expect(Number(positionHint(undefined, undefined))).toBe(1024);
  });

  it("luôn là chuỗi thập phân thường — không dấu mũ, không âm", () => {
    // `positionSchema` từ chối mọi dạng khác, và một `400` ở đây rất khó đọc
    // ngược từ giao diện.
    const samples = [
      positionHint("0.0000000001", "0.0000000002"),
      positionHint(undefined, "0.0000000001"),
      positionHint("99999999999", undefined),
      positionHint("không phải số", undefined),
    ];
    for (const value of samples) expect(value).toMatch(/^\d+(\.\d+)?$/);
  });

  it("bỏ qua chính task đang kéo khi tìm hàng xóm", () => {
    const columnTasks: Task[] = [
      { ...first, id: "a", position: "1024" },
      { ...first, id: "b", position: "2048" },
      { ...first, id: "c", position: "3072" },
    ];
    // Kéo "a" xuống giữa "b" và "c": sau khi "a" rời đi, chỉ số 1 nằm giữa
    // chúng. Nếu quên loại "a" thì hàng xóm bị lệch đi một.
    expect(Number(positionForIndex(columnTasks, 1, "a"))).toBe((2048 + 3072) / 2);
  });
});

describe("phép chiếu kéo-thả", () => {
  const drag: DragState = {
    task: first,
    fromColumnId: "from",
    toColumnId: "to",
    toIndex: 0,
    lifted: true,
  };

  it("cột nguồn bỏ task đang kéo", () => {
    const result = projectColumn([first, second], "from", drag);
    expect(result.map((task) => task.id)).toEqual([second.id]);
  });

  it("cột đích chèn task vào đúng chỉ số", () => {
    const result = projectColumn([second], "to", { ...drag, toIndex: 1 });
    expect(result.map((task) => task.id)).toEqual([second.id, first.id]);
  });

  it("cột không liên quan giữ nguyên tham chiếu", () => {
    const others = [second];
    expect(projectColumn(others, "other", drag)).not.toBe(others);
    expect(projectColumn(others, "other", drag).map((t) => t.id)).toEqual([second.id]);
  });

  it("không kéo thì trả về đúng mảng cũ", () => {
    const source = [first, second];
    expect(projectColumn(source, "from", null)).toBe(source);
  });

  it("KHÔNG đổi position hay version — hai giá trị đó do server sở hữu", () => {
    const result = projectColumn([second], "to", drag);
    const moved = result.find((task) => task.id === first.id);
    expect(moved?.position).toBe(first.position);
    expect(moved?.version).toBe(first.version);
  });

  it("chỉ số vượt biên bị kẹp, không tạo lỗ trong mảng", () => {
    const result = projectColumn([second], "to", { ...drag, toIndex: 99 });
    expect(result).toHaveLength(2);
    expect(result.every((task) => task !== undefined)).toBe(true);
  });
});

describe("chuyển cột bằng bàn phím", () => {
  const ids = columns.map((column) => column.id);

  it("đi sang phải rồi sang trái quay về chỗ cũ", () => {
    const right = neighbourColumn(ids, ids[1] as string, 1);
    expect(neighbourColumn(ids, right, -1)).toBe(ids[1]);
  });

  it("kẹp ở hai đầu thay vì cuộn vòng", () => {
    // Cuộn vòng sẽ ném task từ cột cuối về cột đầu bằng một lần bấm, và người
    // dùng bàn phím không có phản hồi liên tục để nhận ra điều đó.
    expect(neighbourColumn(ids, ids[0] as string, -1)).toBe(ids[0]);
    expect(neighbourColumn(ids, ids[ids.length - 1] as string, 1)).toBe(ids[ids.length - 1]);
  });
});

describe("version guard", () => {
  it("bản version cao hơn thắng, bất kể bản nào tới sau", () => {
    const confirmed: Task = { ...first, version: 5 };
    const stale: Task = { ...first, version: 4 };
    expect(newerOf(stale, confirmed).version).toBe(5);
  });

  it("bản mới hơn từ server ghi đè bản đã xác nhận", () => {
    const confirmed: Task = { ...first, version: 5 };
    const fresher: Task = { ...first, version: 6 };
    expect(newerOf(fresher, confirmed).version).toBe(6);
  });

  it("bằng version thì bản vừa nhận thắng — nội dung có thể đã đổi bởi rebalance", () => {
    const confirmed: Task = { ...first, version: 5, position: "1024" };
    const incoming: Task = { ...first, version: 5, position: "2048" };
    expect(newerOf(incoming, confirmed).position).toBe("2048");
  });

  it("chưa có gì trong sổ thì dùng luôn bản vừa nhận", () => {
    expect(newerOf(first, undefined)).toBe(first);
  });
});

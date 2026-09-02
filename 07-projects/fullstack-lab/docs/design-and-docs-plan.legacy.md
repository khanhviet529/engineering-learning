# Design & Documentation Plan

Kế hoạch này chuẩn bị toàn bộ product design và tài liệu trước khi bắt đầu coding Flowboard.

## Mục tiêu

Khi hoàn thành kế hoạch, một người mới đọc repository có thể hiểu:

```text
Flowboard giải quyết vấn đề gì
→ user đi qua những flow nào
→ giao diện trông và hoạt động ra sao
→ frontend sẽ map với design thế nào
→ người dùng sử dụng sản phẩm ra sao
```

Pencil là design source of truth cho giao diện. Markdown là source of truth cho product decision, behavior và hướng dẫn sử dụng.

## Nguyên tắc làm việc

1. Thiết kế theo user flow, không thiết kế từng màn hình rời rạc.
2. Chốt MVP trước; không thiết kế toàn bộ sản phẩm tương lai.
3. Mọi màn hình phải có trạng thái thành công, loading, empty và error phù hợp.
4. Mọi component dùng lại phải có tên, variant và behavior rõ ràng.
5. Quyết định thay đổi sau khi chốt phải được ghi vào change log hoặc ADR.
6. AI luôn có context boundary, permission boundary và bước xác nhận khi có mutation.

## Phase 0 — Chuẩn bị workspace

### Việc cần làm

- Tạo file Pencil chính cho Flowboard.
- Tạo quy ước đặt tên page, frame, component và variant.
- Tạo thư mục tài liệu design và user guide.
- Ghi rõ viewport mục tiêu: desktop, tablet và mobile.
- Chọn một visual direction ban đầu: clean, calm, productivity-focused.

### Output

```text
Pencil file
docs/design/
docs/user-guide/
docs/design/pencil-handoff.md
```

### Hoàn thành khi

- người khác mở Pencil biết tìm page nào;
- có naming convention;
- có danh sách viewport và nguyên tắc responsive.

## Phase 1 — Product baseline

### Việc cần làm

- Xác định target user và primary use case.
- Viết problem statement.
- Chốt MVP và non-goals.
- Viết success criteria.
- Viết product principles.

### Tài liệu

- `docs/product-brief.md`
- `docs/product/user-personas.md`
- `docs/product/mvp-scope.md`

### Hoàn thành khi

- nói được Flowboard dành cho ai trong một câu;
- có một user journey chính;
- mọi tính năng MVP đều liên quan đến journey đó;
- các tính năng chưa làm được ghi rõ là non-goal.

## Phase 2 — Information architecture và user flows

### Việc cần làm

Thiết kế flow trước khi vẽ visual UI:

```text
Sign up
→ Create workspace
→ Create project
→ Invite member
→ Create task
→ Assign task
→ Move task
→ Comment
→ Review activity
```

Thiết kế thêm các flow:

- đăng nhập thất bại;
- user không có quyền;
- session hết hạn;
- task update thất bại;
- AI tạo task cần user xác nhận;
- AI không đủ context để trả lời.

### Output

- `docs/design/information-architecture.md`
- `docs/design/user-flows.md`
- Pencil page `Flows`

### Hoàn thành khi

- mỗi flow có entry point, action, success và failure outcome;
- không có màn hình nào tồn tại mà không thuộc một flow;
- các điểm cần backend/API đã được đánh dấu.

## Phase 3 — Flowboard design system

### Việc cần làm

Thiết kế trong Pencil:

- color tokens;
- typography scale;
- spacing;
- radius và elevation;
- icons;
- buttons;
- inputs;
- select và combobox;
- modal/drawer;
- tabs;
- toast/alert;
- avatar;
- badges;
- task card;
- activity item;
- AI response block.

Mỗi component cần có:

```text
Name
Purpose
Variants
States
Interaction
Responsive rule
Frontend mapping
```

### Output

- Pencil page `Design System`;
- `docs/design/design-system.md`;
- `docs/design/component-inventory.md`.

### Hoàn thành khi

- các màn hình có thể lắp từ component đã định nghĩa;
- không còn mỗi màn hình dùng một kiểu button/input khác nhau;
- component state đủ để frontend implement mà không phải đoán.

## Phase 4 — MVP screen design

### Nhóm màn hình

#### Authentication

- Sign up
- Sign in
- Forgot/reset password

#### Workspace

- Workspace switcher
- Workspace members
- Invite member

#### Project

- Project list
- Project overview
- Project board
- Project settings

#### Task

- Create task
- Task detail
- Edit task
- Comment
- Activity history

#### AI

- Generate tasks from goal
- Project summary
- Ask project copilot
- AI confirmation dialog
- AI error/fallback state

### Hoàn thành khi

- primary desktop flow hoàn chỉnh;
- mobile layout đã có cho các màn hình chính;
- mỗi màn hình có loading, empty, error và permission state;
- có prototype hoặc flow nối được trong Pencil.

## Phase 5 — Interaction và behavior specification

### Việc cần mô tả

- drag-and-drop task;
- optimistic update;
- filter và search;
- modal/drawer behavior;
- keyboard navigation;
- form validation;
- unsaved changes;
- retry khi network error;
- pagination hoặc infinite scroll;
- AI streaming nếu dùng;
- AI confirmation trước mutation.

### Tài liệu

- `docs/design/interaction-specifications.md`
- `docs/requirements/error-handling.md`
- `docs/ai/ai-ux-behavior.md`

### Hoàn thành khi

- frontend developer biết chính xác click, submit, loading và failure sẽ hiển thị gì;
- các behavior nguy hiểm như optimistic update và AI mutation có rollback/confirm rule.

## Phase 6 — Technical handoff

### Việc cần làm

Map design với implementation:

```text
Pencil component       Frontend component
TaskCard               components/tasks/task-card.tsx
TaskStatusBadge        components/tasks/task-status-badge.tsx
CreateTaskForm         features/tasks/create-task-form.tsx
ProjectBoard           features/projects/project-board.tsx
AiConfirmationDialog   features/ai/ai-confirmation-dialog.tsx
```

Chốt thêm:

- component folder structure;
- form library và validation strategy;
- UI library usage rules;
- styling/token strategy;
- responsive breakpoints;
- accessibility requirements;
- API data needed by each screen.

### Tài liệu

- `docs/design/pencil-handoff.md`
- `docs/engineering/frontend-conventions.md`
- `docs/api/screen-to-api-mapping.md`

### Hoàn thành khi

- mỗi screen map được với route và frontend feature;
- mỗi mutation map được với API contract;
- developer không phải tự quyết định lại visual design cơ bản.

## Phase 7 — User guide

User guide được viết từ flow đã thiết kế, không chỉ viết theo source code.

### Tài liệu

- `docs/user-guide/getting-started.md`
- `docs/user-guide/workspace-management.md`
- `docs/user-guide/project-management.md`
- `docs/user-guide/task-management.md`
- `docs/user-guide/collaboration.md`
- `docs/user-guide/ai-features.md`
- `docs/user-guide/troubleshooting.md`

Mỗi bài hướng dẫn có format:

```text
Purpose
Prerequisites
Steps
Expected result
Failure cases
Screenshots / Pencil reference
Related concepts
```

### Hoàn thành khi

- người mới có thể thực hiện primary journey chỉ bằng user guide;
- mỗi screenshot khớp với design và behavior đã chốt;
- AI guide nói rõ AI có thể sai và action nào cần xác nhận.

## Phase 8 — Review và freeze baseline

### Review checklist

- Product scope có quá lớn không?
- User flow có đi đến outcome rõ ràng không?
- Permission đã xuất hiện trong UX chưa?
- Có thiết kế error/empty/loading state chưa?
- Có mobile và accessibility rule chưa?
- Design system có đủ component cho MVP chưa?
- Database/API có cung cấp đủ data cho UI chưa?
- AI có được giới hạn context và action chưa?
- User guide có thể viết từ design chưa?

### Baseline được chốt khi

- primary user journey đã review;
- MVP screen inventory đã đầy đủ;
- design system version `0.1` đã thống nhất;
- requirements, design và domain model không mâu thuẫn;
- screen-to-API mapping đã có;
- open questions còn lại không ngăn được việc bắt đầu coding.

“Chốt” không có nghĩa là không bao giờ thay đổi. Nó có nghĩa là bắt đầu coding từ một baseline biết rõ; thay đổi sau đó phải được ghi nhận và đánh giá tác động.

## Suggested order of execution

```text
Week 1: Product baseline + information architecture + primary flows
Week 2: Design system + core screens
Week 3: States + AI UX + technical handoff
Week 4: User guide + review + freeze baseline v0.1
```

## First coding slice after freeze

Chỉ bắt đầu bằng vertical slice nhỏ nhất:

```text
Sign in
→ Project board
→ Create task
→ Task detail
→ Move task
→ Activity item
```

Nếu slice này khớp với Pencil, requirements, API contract và user guide, mới mở rộng sang các flow còn lại.

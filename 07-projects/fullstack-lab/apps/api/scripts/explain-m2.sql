-- Kiểm chứng index baseline của M2 bằng EXPLAIN (ANALYZE, BUFFERS).
--
-- `docs/data/query-and-index-policy.md` yêu cầu: "Xác minh plan dùng index phù
-- hợp hoặc document lý do planner chọn cách khác; không chấp nhận index chỉ vì
-- migration tạo thành công."
--
-- Toàn bộ script chạy trong **một transaction rồi ROLLBACK**, nên nó không để
-- lại dữ liệu và chạy lại được bao nhiêu lần cũng được. Việc so sánh
-- "trước/sau index" được làm bằng cách `DROP INDEX` ngay trong transaction đó —
-- DDL của PostgreSQL là transactional, nên index quay lại nguyên vẹn khi
-- rollback. Cách này trung thực hơn `SET enable_indexscan = off`, vốn chỉ ép
-- planner đổi ý chứ không thật sự bỏ index.
--
-- Mỗi lượt `DROP INDEX` nằm trong một **savepoint riêng** và được `ROLLBACK TO`
-- ngay sau khi đo. Không có nó, một index bị drop ở truy vấn 1 vẫn còn thiếu ở
-- truy vấn 5, và cột "SAU khi có index" của truy vấn 5 thực ra được đo **khi
-- không có index** — đúng lỗi đã xảy ra ở bản đầu của script này.
--
-- Chạy:
--   docker compose --env-file .env -f infra/compose/compose.yaml exec -T postgres \
--     psql -U flowboard -d flowboard -f - < apps/api/scripts/explain-m2.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Dữ liệu có phân bố đại diện
--
-- Con số chọn theo phân khúc sản phẩm ở `docs/product/vision-and-scope.md`
-- (nhóm 2–15 người), rồi nhân lên để bảng đủ lớn cho planner **có lựa chọn**:
-- trên bảng vài chục dòng, PostgreSQL luôn chọn seq scan và phép đo không nói
-- lên điều gì.
--
--   2.000 user · 200 workspace · 4.000 project · ~24.000 project membership
--
-- Phân bố cố ý **lệch**, không đều: một actor thuộc rất nhiều project, phần lớn
-- actor thuộc vài project. Dữ liệu đều tay là dữ liệu dễ, và index nào cũng
-- trông tốt trên dữ liệu dễ.
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
SELECT
  gen_random_uuid(),
  'explain-' || i || '@example.test',
  'Nguoi dung ' || i,
  '$argon2id$v=19$m=19456,t=2,p=1$explainseed$explainseedexplainseedexplainseed',
  now()
FROM generate_series(1, 2000) AS i;

INSERT INTO workspaces (id, name)
SELECT gen_random_uuid(), 'Workspace ' || i
FROM generate_series(1, 200) AS i;

-- Mỗi workspace có 20 project.
INSERT INTO projects (id, workspace_id, created_by_user_id, name, created_at)
SELECT
  gen_random_uuid(),
  w.id,
  (SELECT id FROM users WHERE email LIKE 'explain-%' ORDER BY email LIMIT 1),
  'Project ' || w.name || ' #' || p,
  now() - (random() * interval '400 days')
FROM workspaces w
CROSS JOIN generate_series(1, 20) AS p
WHERE w.name LIKE 'Workspace %';

-- Membership workspace: mỗi user thuộc 1–3 workspace.
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT DISTINCT ON (w.id, u.id) w.id, u.id, 'workspace_member'
FROM users u
CROSS JOIN LATERAL (
  SELECT id FROM workspaces WHERE name LIKE 'Workspace %' ORDER BY random() LIMIT 2
) w
WHERE u.email LIKE 'explain-%'
ON CONFLICT DO NOTHING;

-- Membership project, phân bố lệch: user đầu tiên thuộc **nhiều** project.
INSERT INTO project_members (project_id, user_id, role)
SELECT DISTINCT ON (p.id, u.id) p.id, u.id, 'editor'
FROM users u
CROSS JOIN LATERAL (
  SELECT pr.id
  FROM projects pr
  JOIN workspace_members wm ON wm.workspace_id = pr.workspace_id AND wm.user_id = u.id
  ORDER BY random()
  LIMIT CASE WHEN u.email = 'explain-1@example.test' THEN 300 ELSE 6 END
) p
WHERE u.email LIKE 'explain-%'
ON CONFLICT DO NOTHING;

ANALYZE users;
ANALYZE workspaces;
ANALYZE workspace_members;
ANALYZE projects;
ANALYZE project_members;

\echo ''
\echo '=== KÍCH THƯỚC DỮ LIỆU ==='
SELECT
  (SELECT count(*) FROM users)             AS users,
  (SELECT count(*) FROM workspaces)        AS workspaces,
  (SELECT count(*) FROM projects)          AS projects,
  (SELECT count(*) FROM workspace_members) AS workspace_members,
  (SELECT count(*) FROM project_members)   AS project_members;

-- Actor "nặng" nhất: thuộc nhiều project nhất. Đây là trường hợp đáng đo.
CREATE TEMP TABLE probe AS
SELECT id AS user_id FROM users WHERE email = 'explain-1@example.test';

\echo ''
\echo '######################################################################'
\echo '# TRUY VẤN 1 — danh sách project accessible của actor'
\echo '#   Index baseline liên quan: project_members(user_id, project_id)'
\echo '######################################################################'

\echo ''
\echo '--- SAU khi có index (trạng thái thật của migration) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.name, p.created_at, pm.role
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = (SELECT user_id FROM probe)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 26;

\echo ''
\echo '--- TRƯỚC khi có index (drop trong transaction, rollback trả lại) ---'
SAVEPOINT no_index;
DROP INDEX project_members_user_project_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.name, p.created_at, pm.role
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = (SELECT user_id FROM probe)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 26;
ROLLBACK TO SAVEPOINT no_index;

\echo ''
\echo '######################################################################'
\echo '# TRUY VẤN 2 — GET /workspaces: workspace của actor'
\echo '#   Index baseline liên quan: workspace_members(user_id, workspace_id)'
\echo '######################################################################'

\echo ''
\echo '--- SAU khi có index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT w.id, w.name, w.created_at, wm.role
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
WHERE wm.user_id = (SELECT user_id FROM probe)
ORDER BY w.created_at DESC, w.id DESC
LIMIT 26;

\echo ''
\echo '--- TRƯỚC khi có index ---'
SAVEPOINT no_index;
DROP INDEX workspace_members_user_workspace_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT w.id, w.name, w.created_at, wm.role
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
WHERE wm.user_id = (SELECT user_id FROM probe)
ORDER BY w.created_at DESC, w.id DESC
LIMIT 26;
ROLLBACK TO SAVEPOINT no_index;

\echo ''
\echo '######################################################################'
\echo '# TRUY VẤN 3 — phép kiểm quyền chạy ở MỌI request project'
\echo '#   Index baseline: project_members(project_id, user_id) UNIQUE'
\echo '#   Đây là truy vấn nóng nhất của hệ thống: SessionGuard cho phép đi'
\echo '#   tiếp rồi ProjectPermissionGuard chạy đúng câu này mỗi lần.'
\echo '######################################################################'

\echo ''
\echo '--- SAU khi có index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT role FROM project_members
WHERE project_id = (SELECT id FROM projects ORDER BY random() LIMIT 1)
  AND user_id = (SELECT user_id FROM probe);

\echo ''
\echo '--- TRƯỚC khi có index ---'
SAVEPOINT no_index;
DROP INDEX project_members_project_user_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT role FROM project_members
WHERE project_id = (SELECT id FROM projects ORDER BY random() LIMIT 1)
  AND user_id = (SELECT user_id FROM probe);
ROLLBACK TO SAVEPOINT no_index;

\echo ''
\echo '######################################################################'
\echo '# TRUY VẤN 4 — danh sách project trong một workspace'
\echo '#   Index baseline: projects(workspace_id, created_at DESC)'
\echo '######################################################################'

\echo ''
\echo '--- SAU khi có index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, created_at
FROM projects
WHERE workspace_id = (SELECT id FROM workspaces WHERE name LIKE 'Workspace %' LIMIT 1)
ORDER BY created_at DESC
LIMIT 26;

\echo ''
\echo '--- TRƯỚC khi có index ---'
SAVEPOINT no_index;
DROP INDEX projects_workspace_created_at_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, created_at
FROM projects
WHERE workspace_id = (SELECT id FROM workspaces WHERE name LIKE 'Workspace %' LIMIT 1)
ORDER BY created_at DESC
LIMIT 26;
ROLLBACK TO SAVEPOINT no_index;

\echo ''
\echo '######################################################################'
\echo '# TRUY VẤN 5 — GET /workspaces/:workspaceId/projects'
\echo '#   Hai điều kiện scope cùng lúc: membership của actor VÀ workspace.'
\echo '#   Index baseline: project_members(user_id, project_id)'
\echo '#                   projects(workspace_id, created_at DESC)'
\echo '#'
\echo '#   Lưu ý khi đọc: truy vấn này được PHỤC VỤ BỞI HAI index có thể thay'
\echo '#   nhau. Bỏ một cái thì cái kia tiếp quản và thời gian gần như không'
\echo '#   đổi — nên phép so "một index" KHÔNG chứng minh được gì. Muốn thấy'
\echo '#   chi phí thật thì phải bỏ cả hai.'
\echo '######################################################################'

-- Một workspace mà actor "nặng" thật sự thuộc về.
CREATE TEMP TABLE probe_ws AS
SELECT wm.workspace_id
FROM workspace_members wm
JOIN probe p ON p.user_id = wm.user_id
LIMIT 1;

\echo ''
\echo '--- SAU khi có index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.workspace_id, p.name, pm.role, p.created_at, p.updated_at
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = (SELECT user_id FROM probe)
  AND p.workspace_id = (SELECT workspace_id FROM probe_ws)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 26;

\echo ''
\echo '--- BỎ MỘT index membership: index còn lại tiếp quản ---'
\echo '--- (đo để thấy truy vấn này có dự phòng, không phải để so tốc độ) ---'
SAVEPOINT no_index;
DROP INDEX project_members_user_project_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.workspace_id, p.name, pm.role, p.created_at, p.updated_at
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = (SELECT user_id FROM probe)
  AND p.workspace_id = (SELECT workspace_id FROM probe_ws)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 26;
ROLLBACK TO SAVEPOINT no_index;

\echo ''
\echo '--- TRƯỚC khi có index (bỏ CẢ HAI index membership) ---'
SAVEPOINT no_index;
DROP INDEX project_members_user_project_idx;
DROP INDEX project_members_project_user_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.workspace_id, p.name, pm.role, p.created_at, p.updated_at
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = (SELECT user_id FROM probe)
  AND p.workspace_id = (SELECT workspace_id FROM probe_ws)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 26;
ROLLBACK TO SAVEPOINT no_index;

-- Không để lại gì: dữ liệu seed và các DROP INDEX đều biến mất.
ROLLBACK;

\echo ''
\echo '=== ĐÃ ROLLBACK — database trở lại nguyên trạng ==='
SELECT
  (SELECT count(*) FROM users)           AS users,
  (SELECT count(*) FROM projects)        AS projects,
  (SELECT count(*) FROM project_members) AS project_members;

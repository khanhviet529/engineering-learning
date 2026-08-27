# Index & query plan

**Position:** SQL → PostgreSQL storage engine

Index không phải nút "làm nhanh" miễn phí. Nó đổi cách tìm dữ liệu và tăng chi phí storage/write/maintenance.

Experiment: dữ liệu đủ lớn; query trước/sau index; dùng EXPLAIN/EXPLAIN ANALYZE; thử predicate có độ chọn lọc khác nhau.

# Pod, Deployment, Service

**Position:** Container → Kubernetes runtime

Mental model: Pod là đơn vị chạy; Deployment quản desired replicas/update; Service cung cấp endpoint ổn định để tìm một tập Pods.

Break: kill pod, scale replicas, thay image lỗi, quan sát controller đưa hệ thống về desired state.

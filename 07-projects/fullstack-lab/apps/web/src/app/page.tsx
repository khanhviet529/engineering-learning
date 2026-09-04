/**
 * Trang gốc ở mốc M0.5.
 *
 * Nó cố ý **không** giả vờ là một màn hình sản phẩm. Màn hình thật đầu tiên là
 * `AUTH-01` ở M1, dựng theo frame đã freeze. Trang này chỉ chứng minh app khởi
 * động được và token đã được nạp.
 */
export default function Page() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "var(--fb-color-surface-canvas)",
        color: "var(--fb-color-text-primary)",
        fontFamily: "var(--fb-font-family-base), system-ui, sans-serif",
      }}
    >
      <p style={{ fontSize: "var(--fb-font-size-body)" }}>
        Flowboard — bộ khung đã sẵn sàng. Màn hình đầu tiên xuất hiện ở mốc M1.
      </p>
    </main>
  );
}

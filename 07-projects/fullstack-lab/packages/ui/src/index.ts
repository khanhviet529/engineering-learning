// Public entry point của @flowboard/ui.
//
// Bề mặt công khai hiện đang **trống có chủ ý**. Các wrapper đầu tiên được dựng
// ở mốc M0.4 (token bridge), đúng chín component mà màn hình xác thực của M1
// cần: FbBrandMark, FbTextField, FbPasswordField, FbButtonPrimary,
// FbButtonSecondary, FbLink, FbAlert, FbChecklistRow, FbStatePanel.
//
// Quy tắc không đổi: wrapper ở đây **không** fetch data, **không** kiểm tra
// role và **không** gọi API. Component cần capability hoặc mutation thì thuộc
// về feature trong apps/web.

export {};

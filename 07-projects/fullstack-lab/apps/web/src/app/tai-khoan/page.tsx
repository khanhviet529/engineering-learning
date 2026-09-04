import type { Metadata } from "next";
import { AccountSettingsScreen } from "../../features/account/account-settings.tsx";

export const metadata: Metadata = { title: "Hồ sơ và tùy chọn · Flowboard" };

/** `USR-01` — hồ sơ và tùy chọn. Entry point là khối người dùng trên topbar. */
export default function Page() {
  return <AccountSettingsScreen />;
}

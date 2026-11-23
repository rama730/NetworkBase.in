import SettingsShell from "@/components/settings/SettingsLayout";
import "./settings.css";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}

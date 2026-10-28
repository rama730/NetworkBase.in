import SettingsDocument from "@/components/settings/SettingsDocument";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({
    title: "Settings | NetworkBase",
    description: "Manage your account, security, privacy, notifications, appearance, integrations, and data on NetworkBase.",
    path: "/settings",
    // Personal and signed-in: never something to index.
    robots: { index: false, follow: false },
  });
}

export default function SettingsRoute() {
  return <SettingsDocument />;
}

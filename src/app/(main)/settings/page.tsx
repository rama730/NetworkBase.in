import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({
    title: "Settings | NetworkBase",
    description: "Manage your account, privacy, appearance, and integrations on NetworkBase.",
    path: "/settings",
  });
}

export default async function SettingsRoute() {
  const { default: SettingsDocument } = await import("@/components/settings/SettingsDocument");
  return <SettingsDocument />;
}

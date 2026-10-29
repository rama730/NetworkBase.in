import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { isUuid } from "@/lib/validations/uuid";

export async function generateMetadata({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return buildRouteMetadata({
    title: "Messages | NetworkBase",
    description: "Channels and direct messages for your workspaces.",
    path: isUuid(channelId) ? `/messages/${channelId}` : "/messages",
  });
}

// The layout renders the conversation; this route adds no drawer.
export default function ChannelPage() {
  return null;
}

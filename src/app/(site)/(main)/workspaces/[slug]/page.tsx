import type { Metadata } from 'next';

import { generateWorkspaceRouteMetadata, WorkspaceRoute, type RouteSearchParams } from './workspace-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateWorkspaceRouteMetadata(props);
}

export default function WorkspaceDetailPage(props: Props) {
    return <WorkspaceRoute base="/workspaces" {...props} />;
}

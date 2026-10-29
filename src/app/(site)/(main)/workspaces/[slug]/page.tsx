import type { Metadata } from 'next';

import { generateProjectRouteMetadata, ProjectRoute, type RouteSearchParams } from './workspace-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateProjectRouteMetadata(props);
}

export default function ProjectDetailPage(props: Props) {
    return <ProjectRoute base="/workspaces" {...props} />;
}

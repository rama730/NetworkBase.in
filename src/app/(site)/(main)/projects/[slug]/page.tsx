import type { Metadata } from 'next';

import { generateProjectRouteMetadata, ProjectRoute, type RouteSearchParams } from './project-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateProjectRouteMetadata(props);
}

export default function ProjectDetailPage(props: Props) {
    return <ProjectRoute base="/projects" {...props} />;
}

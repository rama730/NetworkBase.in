import type { Metadata } from 'next';

import { generateProjectRouteMetadata, ProjectRoute, type RouteSearchParams } from '../../workspaces/[slug]/workspace-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateProjectRouteMetadata({ ...props, base: '/org' });
}

/** An organization's address, /org/<handle> (report §24): the project page underneath. */
export default function OrganizationPage(props: Props) {
    return <ProjectRoute base="/org" {...props} />;
}

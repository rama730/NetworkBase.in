import type { Metadata } from 'next';

import { generateWorkspaceRouteMetadata, WorkspaceRoute, type RouteSearchParams } from '../../workspaces/[slug]/workspace-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateWorkspaceRouteMetadata({ ...props, base: '/org' });
}

/** An organization's address, /org/<handle> (report §24): the project page underneath. */
export default function OrganizationPage(props: Props) {
    return <WorkspaceRoute base="/org" {...props} />;
}

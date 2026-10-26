import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { organizationsEnabled } from '@/lib/organizations/config';
import { generateProjectRouteMetadata, ProjectRoute, type RouteSearchParams } from '../../projects/[slug]/project-route';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RouteSearchParams> };

export function generateMetadata(props: Props): Promise<Metadata> {
    return generateProjectRouteMetadata(props);
}

/** An organization's address, /org/<handle> (report §24): the project page underneath. */
export default function OrganizationPage(props: Props) {
    if (!organizationsEnabled()) notFound();
    return <ProjectRoute base="/org" {...props} />;
}

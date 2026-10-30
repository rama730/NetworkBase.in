import { notFound } from 'next/navigation'

import { ConsoleScroll } from '@/components/trust/ConsoleScroll'
import { PersonView } from '@/components/trust/PersonView'
import { readPerson } from '@/lib/trust/console'

/** A person's standing (17.8); the same view opens in a side drawer from a case. */
export default async function TrustPersonPage({ params }: { params: Promise<{ handle: string }> }) {
    const p = await readPerson(decodeURIComponent((await params).handle))
    if (!p) notFound()
    return <ConsoleScroll><div className="mt-4"><PersonView p={p} /></div></ConsoleScroll>
}

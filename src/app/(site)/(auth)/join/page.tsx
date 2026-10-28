import { redirect } from 'next/navigation'

import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { normalizeJoinCode, ORG_JOIN_MESSAGES } from '@/lib/organizations/join-rules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const metadata = buildRouteMetadata({
    title: 'Join an organization | NetworkBase',
    description: 'Enter the code your organization gave you.',
    path: '/join',
})

/** "Have a code? Join an organization": a plain GET form, so it works before any script loads. */
export default async function JoinWithCodePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const raw = (await searchParams).code
    const typed = typeof raw === 'string' ? raw : null
    const code = typed ? normalizeJoinCode(typed) : null
    if (code) redirect(`/join/${code}`)

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
            <form action="/join" method="get" className="w-full max-w-sm space-y-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">Join an organization</h1>
                    <p className="text-sm text-muted-foreground">Enter the 6-character code from your teacher or admin.</p>
                </div>
                <label htmlFor="join-code" className="sr-only">Join code</label>
                <Input
                    id="join-code"
                    name="code"
                    defaultValue={typed ?? ''}
                    placeholder="K7M2QX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={9}
                    required
                    aria-invalid={typed !== null}
                    aria-describedby={typed !== null ? 'join-code-error' : undefined}
                    className="h-12 text-center font-mono text-xl tracking-[0.3em] uppercase"
                />
                {typed !== null ? <p id="join-code-error" role="alert" className="text-sm text-destructive">{ORG_JOIN_MESSAGES.no_match}</p> : null}
                <Button type="submit" className="min-h-11 w-full">Continue</Button>
            </form>
        </main>
    )
}

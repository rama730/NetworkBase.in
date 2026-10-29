import { RestrictedScreen, StandingBanner } from '@/components/trust/StandingNotices'
import { shortDate } from '@/lib/trust/messages'
import { caseLabel as label, ruleLabel } from '@/lib/trust/rules'
import { accountRestriction, ownedWorkspaceActions } from '@/lib/trust/standing'

const maskEmail = (email: string | null | undefined) => {
    if (!email) return null
    const [name, domain] = email.split('@')
    return name && domain ? `${name[0]}***@${domain}` : null
}

/**
 * The app shell's standing check (docs/trust-and-safety-concept.md §8.4, §8.6): suspended and banned accounts get
 * only the restricted screen (and the appeal page); limits and actions on owned workspaces get the banner.
 */
export async function StandingGate({ userId, email, path, children }: { userId: string; email: string | null | undefined; path: string; children: React.ReactNode }) {
    const restriction = await accountRestriction(userId)
    const appealSent = restriction?.appealState === 'pending' || restriction?.appealState === 'in_review' ? shortDate(restriction.appealDeadline) : null
    const canAppeal = Boolean(restriction?.appealUntil && new Date(restriction.appealUntil) > new Date() && !restriction.appealState)
    const caseText = restriction?.caseNumber ? label(restriction.caseNumber) : null

    if (restriction && restriction.action !== 'limit' && !path.startsWith('/appeal/')) {
        return (
            <RestrictedScreen
                title={restriction.action === 'ban' ? 'Your account is banned' : `Your account is suspended until ${shortDate(restriction.endsAt)}`}
                reason={restriction.rule ? ruleLabel(restriction.rule) : null} email={maskEmail(email)} caseLabel={caseText} appealSent={appealSent} canAppeal={canAppeal}
            />
        )
    }
    let banner: React.ReactNode = null
    if (restriction?.action === 'limit') {
        banner = <StandingBanner caseLabel={caseText} appealSent={appealSent} canAppeal={canAppeal}
            text={`Your account is limited until ${shortDate(restriction.endsAt)}: you can't message people you aren't connected to or post outside your workspaces.`} />
    } else {
        const [owned] = await ownedWorkspaceActions(userId)
        if (owned) {
            const state = owned.action === 'restrict' ? 'is restricted for now' : owned.action === 'suspend_workspace' ? 'is suspended' : `will be deleted on ${shortDate(owned.ends_at)}`
            const sent = owned.appeal_state === 'pending' || owned.appeal_state === 'in_review'
            banner = <StandingBanner caseLabel={owned.case_number ? label(owned.case_number) : null} appealSent={sent ? 'the date in your email' : null} canAppeal={!owned.appeal_state}
                text={`${owned.title} ${state}.`} />
        }
    }
    return <>{banner}{children}</>
}

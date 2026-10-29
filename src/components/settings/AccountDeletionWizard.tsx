"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface Props {
    onClose: () => void;
    /** Called with the date the account will be removed, once deletion is scheduled. */
    onDeleted: (hardDeleteAt: string | null) => void;
}

type OwnedProject = { id: string; title: string; slug: string | null; otherMembers: number; kind?: string; handover?: boolean };
type StepUpState = { methods: Array<"totp" | "recovery_code" | "password">; factorId?: string };

export default function AccountDeletionWizard({ onClose, onDeleted }: Props) {
    const router = useRouter();
    const { user, signOut } = useAuth();
    const email = user?.email ?? "";
    const username = typeof user?.user_metadata?.username === "string" ? user.user_metadata.username : "";
    // What the person types: their own email, or their username when they have no email on the account.
    const confirmWord = email || username || "DELETE";
    const [confirmText, setConfirmText] = useState("");
    const [reason, setReason] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [stepUp, setStepUp] = useState<StepUpState | null>(null);
    const [needsFreshSignIn, setNeedsFreshSignIn] = useState(false);
    const [owned, setOwned] = useState<OwnedProject[] | null>(null);
    const [ownedFailed, setOwnedFailed] = useState(false);

    // What this takes with it, shown before the person confirms.
    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/v1/account/deletion-preflight", { signal: controller.signal, cache: "no-store" })
            .then((response) => response.json())
            .then((payload) => {
                if (payload?.success && Array.isArray(payload.data?.projects)) setOwned(payload.data.projects);
                else setOwnedFailed(true);
            })
            .catch(() => { if (!controller.signal.aborted) setOwnedFailed(true); });
        return () => controller.abort();
    }, []);

    const confirmed = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

    const handleDelete = async () => {
        if (!confirmed) return;
        setDeleting(true);
        try {
            const response = await fetch("/api/v1/account/delete", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmationText: confirmText.trim(), reason: reason || undefined }),
            });
            const payload = await response.json().catch(() => null);
            // The server requires a fresh identity check before deleting.
            if (response.status === 403 && payload?.errorCode === "STEP_UP_REQUIRED") {
                if (payload?.details?.availableMethods?.length) {
                    setStepUp({ methods: payload.details.availableMethods, factorId: payload.details.factorId ?? undefined });
                } else {
                    // Signed in with a provider and nothing else to verify with: a fresh sign-in is the proof.
                    setNeedsFreshSignIn(true);
                }
                return;
            }
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || "Couldn’t delete account");
            }
            onDeleted(payload?.data?.hardDeleteAt ?? null);
        } catch (error) {
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t delete account", "Couldn’t delete account"));
        } finally {
            setDeleting(false);
        }
    };

    const signInAgain = async () => {
        await signOut();
        router.push(`/login?redirect=${encodeURIComponent("/settings#settings-delete-account")}`);
    };

    if (stepUp) {
        return <SecurityStepUpDialog
            open
            onOpenChange={(open) => { if (!open) setStepUp(null); }}
            title="Confirm it’s you"
            description="Verify your identity to schedule your account for deletion."
            availableMethods={stepUp.methods}
            factorId={stepUp.factorId}
            onVerified={async () => { setStepUp(null); await handleDelete(); }}
        />;
    }

    // Report §30.7: orgs block deletion; child projects you lead pass to a new lead instead of going.
    const ownedOrgs = (owned ?? []).filter((project) => project.kind === "organization");
    const handedOver = (owned ?? []).filter((project) => project.handover);
    const sharedProjects = (owned ?? []).filter((project) => project.otherMembers > 0 && project.kind !== "organization" && !project.handover);

    return <Dialog open onOpenChange={(open) => { if (!open && !deleting) onClose(); }}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-[var(--status-danger)]"><TriangleAlert className="h-5 w-5" aria-hidden="true" />Delete account</DialogTitle>
                <DialogDescription>
                    Your profile is hidden and you are signed out everywhere right away. After 30 days your account and its data are permanently deleted. You can cancel any time before then.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 nb-compact">
                <div className="space-y-2 rounded-lg border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-foreground">
                    <p className="font-medium">What happens to your data</p>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                        <li>Workspaces you own are deleted, including for the people working in them.</li>
                        <li>Your direct messages are deleted. Your messages in group messages and channels stay, without your name.</li>
                        <li>We keep a record of your email and username for 180 days so they can’t be taken over.</li>
                    </ul>
                    {owned === null && !ownedFailed ? (
                        <p className="nb-meta text-muted-foreground" role="status">Checking your workspaces…</p>
                    ) : ownedFailed ? (
                        <p className="nb-meta text-muted-foreground">We couldn’t check your workspaces. Review them on your Workspaces page before continuing.</p>
                    ) : owned && owned.length > 0 ? (
                        <p>
                            You own {owned.length} project{owned.length === 1 ? "" : "s"}
                            {sharedProjects.length > 0
                                ? `, ${sharedProjects.length} with other people in ${sharedProjects.length === 1 ? "it" : "them"}: ${sharedProjects.slice(0, 3).map((project) => project.title).join(", ")}${sharedProjects.length > 3 ? "…" : ""}`
                                : ""}.
                            {" "}Transfer any you want to keep from each workspace’s Settings tab. <Link href="/projects" onClick={onClose} className="text-primary hover:underline">Open your workspaces</Link>
                        </p>
                    ) : (
                        <p className="text-muted-foreground">You don’t own any workspaces.</p>
                    )}
                    {handedOver.length > 0 ? (
                        <p>{handedOver.map((project) => project.title).join(", ")} {handedOver.length === 1 ? "passes" : "pass"} to a new lead in {handedOver.length === 1 ? "its" : "their"} organization, so {handedOver.length === 1 ? "it isn’t" : "they aren’t"} deleted.</p>
                    ) : null}
                </div>

                {ownedOrgs.length > 0 ? (
                    <div role="alert" className="space-y-1 rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] p-3 text-foreground">
                        <p className="font-medium">You own {ownedOrgs.length === 1 ? "an organization" : `${ownedOrgs.length} organizations`}. Transfer ownership or delete {ownedOrgs.length === 1 ? "it" : "them"} first.</p>
                        <ul className="list-disc pl-4">
                            {ownedOrgs.map((org) => <li key={org.id}><Link href={`/org/${encodeURIComponent(org.slug ?? org.id)}?tab=settings`} onClick={onClose} className="text-primary hover:underline">{org.title}</Link></li>)}
                        </ul>
                    </div>
                ) : null}

                <Button variant="outline" asChild>
                    <a href="/api/v1/account/export" download><Download className="h-4 w-4" aria-hidden="true" />Export your data</a>
                </Button>

                <div className="space-y-1.5">
                    <label htmlFor="delete-account-confirm" className="nb-ui-label text-foreground">Type <strong>{confirmWord}</strong> to confirm</label>
                    <Input id="delete-account-confirm" autoFocus value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" spellCheck={false} />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor="delete-account-reason" className="nb-ui-label text-muted-foreground">Reason for leaving (optional)</label>
                    <textarea
                        id="delete-account-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="w-full resize-none rounded-md border border-input bg-card px-[var(--ui-control-px)] py-2 text-[15px] leading-[1.5] outline-none focus-visible:bg-muted/20"
                    />
                </div>

                {needsFreshSignIn ? (
                    <div role="alert" className="space-y-2 rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] p-3 text-[var(--status-danger)]">
                        <p>This account has no password or authenticator to verify with. Sign in again, then come back here within 10 minutes.</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void signInAgain()}>Sign in again</Button>
                    </div>
                ) : null}
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
                <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting || !confirmed || ownedOrgs.length > 0}>
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    Delete account
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}

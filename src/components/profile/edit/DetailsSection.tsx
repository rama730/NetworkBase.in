'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { Camera, Check, ChevronDown, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { GenderChoice } from '@/components/profile/GenderChoice'
import { ABOUT_FOLD } from '@/components/profile/v2/sections/AboutSection'
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from '@/app/actions/profile'
import { compressAvatarOffMainThread } from '@/lib/services/avatar-worker-client'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { publicAvatarVariantUrl } from '@/lib/profile/avatar-variants'
import { shareOrigin } from '@/lib/sharing/presentation'
import { PROFILE_LIMITS } from '@/lib/validations/profile'
import { PROFILE_FIELD_LIMITS } from '@/lib/validations/profile-fields'
import { sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'
import { freeUsernames, normalizeWebsite, websiteError } from '@/lib/profile/mix'
import type { OnboardingGenderIdentity } from '@/lib/onboarding/contracts'
import type { UsernameAvailabilityStatus } from '@/hooks/useUsernameAvailability'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { OnlyYou } from './ChangesCard'

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MB = 1024 * 1024
const day = (iso: string | Date) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** A labelled section of the editor: the same label and panel as the profile's own sections. */
export function EditPanel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
    const id = `pf-edit-${title.toLowerCase().replace(/\W+/g, '-')}`
    return (
        <section className="nb-pf-sec nb-pf-esec" aria-labelledby={id}>
            <div className="nb-pf-label has-rule"><h2 id={id} className="nb-pf-h">{title}</h2>{extra}</div>
            <div className="nb-pf-panel nb-pf-ep">{children}</div>
        </section>
    )
}

/** One field: label, a count that shows while you type or near the limit, the control and its note. */
function Field({ id, label, value, max, req, wide, help, children }: { id: string; label: string; value?: string; max?: number; req?: boolean; wide?: boolean; help?: ReactNode; children: ReactNode }) {
    const n = (value ?? '').length
    return (
        <div className={cn('nb-pf-f', wide && 'wide')} data-pf-field>
            <div className="nb-pf-l">
                <label htmlFor={id} className="nb-ui-label text-foreground">{label}{req ? <span className="text-destructive" aria-hidden="true"> *</span> : null}</label>
                {max ? <span id={`${id}-count`} className={cn('nb-meta nb-pf-cnt text-muted-foreground font-normal', n >= max * 0.8 && 'near')}>{n} / {max}</span> : null}
            </div>
            {children}
            {help}
        </div>
    )
}

/**
 * Edit profile › Details: photo, identity (name, username with its profile link), About with how it reads on the
 * profile, location and website, and the private details only you see.
 */
export function DetailsSection({ profile, baseAvatarUrl, originalUsername, username, usernameNextChangeAt, showWebsiteError, onField, onImageFinalized }: {
    profile: any
    baseAvatarUrl: string
    originalUsername: string
    username: { status: UsernameAvailabilityStatus; message: string }
    /** While the last change is under 30 days old, the username waits until this date. */
    usernameNextChangeAt?: string | null
    /** Save was pressed with a bad website: show its error even before the field is left. */
    showWebsiteError?: boolean
    onField: (key: string, value: unknown) => void
    onImageFinalized?: (url: string, updatedAt?: string) => void
}) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [photoError, setPhotoError] = useState<string | null>(null)
    const [websiteTouched, setWebsiteTouched] = useState(false)
    const [aboutOpen, setAboutOpen] = useState(false)
    // The draft changes while an upload runs; the result lands on whatever the draft is then.
    const fieldRef = useRef(onField)
    fieldRef.current = onField

    const avatar = profile.avatarUrl as string | undefined
    const isNewPhoto = Boolean(avatar) && avatar !== baseAvatarUrl
    const host = new URL(shareOrigin()).host
    const handle = String(profile.username ?? '')
    const locked = Boolean(usernameNextChangeAt && new Date(usernameNextChangeAt) > new Date())

    const upload = async (file: File) => {
        setPhotoError(null)
        if (!PHOTO_TYPES.includes(file.type)) {
            const kind = file.type.startsWith('image/') ? file.type.slice(6).split('+')[0]!.toUpperCase() : null
            return setPhotoError(kind ? `That’s a ${kind}. Use a JPG, PNG or WebP photo.` : 'That file isn’t a photo. Use a JPG, PNG or WebP photo.')
        }
        if (file.size > 2 * MB) return setPhotoError(`That photo is ${(file.size / MB).toFixed(1)} MB. Choose one under 2 MB.`)
        const before = avatar ?? ''
        const local = URL.createObjectURL(file)
        fieldRef.current('avatarUrl', local)
        setUploading(true)
        try {
            const prepared = await compressAvatarOffMainThread(file)
            const session = await createProfileImageUploadUrlAction({ mimeType: 'image/jpeg', sizeBytes: prepared.size, kind: 'avatar' })
            if (!session.success) throw new Error(session.error)
            await uploadToSupabaseSignedUrl(session, prepared, { cacheProfile: 'public' })
            const done = await finalizeProfileImageUploadAction({ uploadIntentId: session.uploadIntentId, commitToProfile: false })
            if (!done.success) throw new Error(done.error)
            fieldRef.current('avatarUrl', done.publicUrl)
            onImageFinalized?.(done.publicUrl, done.updatedAt)
            toast.message('Photo ready. Save to put it on your profile.')
        } catch {
            fieldRef.current('avatarUrl', before)
            setPhotoError('The upload didn’t finish. Check your connection and try again.')
        } finally {
            URL.revokeObjectURL(local)
            setUploading(false)
        }
    }

    // The username note: what the link becomes, why it can't, or names to try.
    const formatOk = handle ? validateUsername(handle).valid : false
    const usernameNote = locked ? (
        <>Your profile link. You can change it again on {day(usernameNextChangeAt!)}.</>
    ) : username.status === 'idle' ? (
        handle ? <>Your profile link. You can change it once every 30 days.</> : <span className="bad"><X className="size-3" />Pick a username.</span>
    ) : username.status === 'checking' ? (
        <><PixelBeat /> Checking…</>
    ) : username.status === 'invalid' && formatOk ? (
        <><span className="bad"><X className="size-3" />@{handle} is taken.</span> Try:{' '}
            {freeUsernames(handle).map((name) => <button key={name} type="button" className="nb-pf-unpick" onClick={() => onField('username', name)}>@{name}</button>)}</>
    ) : username.status === 'invalid' ? (
        <span className="bad"><X className="size-3" />{username.message || 'Use 3 to 20 letters, numbers, - or _.'}</span>
    ) : username.status === 'error' ? (
        <span className="warn">{username.message}</span>
    ) : (
        <><span className="ok"><Check className="size-3" />Available.</span> <span className="nb-pf-url">{host}/u/<s>{originalUsername}</s> → <b>{handle}</b></span><br />
            Changes when you save. You can’t change it again until {day(new Date(Date.now() + 30 * 86_400_000))}.</>
    )

    const website = String(profile.website ?? '')
    const webError = (websiteTouched || showWebsiteError) ? websiteError(website) : null
    const bio = String(profile.bio ?? '').trim()
    const longBio = bio.length > ABOUT_FOLD

    return (
        <div className="nb-pf-edit-sec">
            <EditPanel title="Photo">
                <div className="nb-pf-ephoto">
                    <div className={cn('nb-pf-eava', uploading && 'is-up')}>
                        {avatar ? <Image src={avatar.startsWith('blob:') ? avatar : publicAvatarVariantUrl(avatar, 128)} alt="" fill sizes="80px" className="object-cover" unoptimized />
                            : <UserAvatar identity={profile} className="size-full" roundedClassName="rounded-none" sizes="80px" />}
                        {uploading ? <span className="nb-pf-upl"><PixelBeat />Uploading</span> : null}
                        {isNewPhoto && !uploading ? <span className="nb-pf-new">New · not saved</span> : null}
                    </div>
                    <div className="nb-pf-ptxt">
                        <b>Profile photo</b>
                        <span>{avatar ? 'Square. Shows on your profile, cards and in search. JPG, PNG or WebP, up to 2 MB.' : 'No photo yet, so people see your pixel figure. JPG, PNG or WebP, up to 2 MB.'}</span>
                        {photoError ? <span className="nb-pf-help is-bad" role="alert"><X className="inline size-3" /> {photoError}</span> : null}
                    </div>
                    <div className="nb-pf-ebtns">
                        <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} className="hidden" tabIndex={-1} aria-hidden="true" disabled={uploading}
                            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} />
                        <Button id="profile-photo-button" type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                            <Camera className="size-4" />{photoError ? 'Try again' : avatar ? 'Change photo' : 'Upload photo'}
                        </Button>
                        {avatar ? <Button type="button" variant="ghost" size="sm" onClick={() => { setPhotoError(null); onField('avatarUrl', '') }} disabled={uploading}>Remove</Button> : null}
                    </div>
                </div>
            </EditPanel>

            <EditPanel title="Identity">
                <div className="nb-pf-egrid">
                    <Field id="profile-full-name" label="Full name" req value={profile.fullName} max={PROFILE_LIMITS.fullNameMax}>
                        <Input id="profile-full-name" name="fullName" required autoComplete="name" maxLength={PROFILE_LIMITS.fullNameMax} aria-describedby="profile-full-name-count"
                            aria-invalid={!String(profile.fullName ?? '').trim()} value={profile.fullName ?? ''} onChange={(e) => onField('fullName', e.target.value)} placeholder="Your name" />
                    </Field>
                    <Field id="profile-username" label="Username" req help={<p id="profile-username-hint" className="nb-pf-help" aria-live="polite">{usernameNote}</p>}>
                        <div className={cn('nb-pf-pre', locked && 'is-locked')}>
                            <span id="profile-username-url" className="nb-pf-pfx">{host}/u/</span>
                            <Input id="profile-username" name="username" required autoComplete="off" spellCheck={false} disabled={locked}
                                minLength={PROFILE_LIMITS.usernameMin} maxLength={PROFILE_LIMITS.usernameMax}
                                aria-describedby="profile-username-url profile-username-hint" aria-invalid={username.status === 'invalid'}
                                value={handle} onChange={(e) => onField('username', sanitizeUsernameInput(e.target.value))} />
                        </div>
                    </Field>
                    <Field id="profile-headline" label="Headline" wide value={profile.headline} max={PROFILE_LIMITS.headlineMax}>
                        <Input id="profile-headline" name="headline" maxLength={PROFILE_LIMITS.headlineMax} aria-describedby="profile-headline-count"
                            value={profile.headline ?? ''} onChange={(e) => onField('headline', e.target.value)} placeholder="e.g. Frontend developer · Open source contributor" />
                    </Field>
                </div>
            </EditPanel>

            <EditPanel title="About">
                <div className="nb-pf-egrid">
                    <Field id="profile-bio" label="About you" wide value={profile.bio} max={PROFILE_LIMITS.bioMax}>
                        <textarea id="profile-bio" name="bio" rows={7} maxLength={PROFILE_LIMITS.bioMax} aria-describedby="profile-bio-count" value={profile.bio ?? ''}
                            onChange={(e) => onField('bio', e.target.value)} placeholder="What you build, what you’re looking for."
                            className="nb-body min-h-36 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-2 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                    </Field>
                    <div className="nb-pf-aboutpv wide">
                        <span className="k">On your profile</span>
                        <div data-testid="about-preview">
                            {bio ? (
                                <>
                                    <div className={longBio && !aboutOpen ? 'nb-pf-about-body is-folded' : 'nb-pf-about-body'}>
                                        {bio.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
                                    </div>
                                    {longBio ? <button type="button" className="nb-pf-more" aria-expanded={aboutOpen} onClick={() => setAboutOpen((v) => !v)}>{aboutOpen ? 'Show less' : 'Read more'}<ChevronDown className="size-3.5" /></button> : null}
                                </>
                            ) : <p className="nb-pf-help">How your About reads on your profile shows here.</p>}
                        </div>
                    </div>
                    <Field id="profile-location" label="Location" value={profile.location} max={PROFILE_LIMITS.locationMax}>
                        <Input id="profile-location" name="location" maxLength={PROFILE_LIMITS.locationMax} aria-describedby="profile-location-count"
                            value={profile.location ?? ''} onChange={(e) => onField('location', e.target.value)} placeholder="e.g. Chennai, or Remote" />
                    </Field>
                    <Field id="profile-website" label="Website" value={website} max={PROFILE_LIMITS.websiteMax}
                        help={webError ? <p id="profile-website-help" className="nb-pf-help is-bad"><X className="inline size-3" /> {webError}</p> : null}>
                        <Input id="profile-website" name="website" inputMode="url" maxLength={PROFILE_LIMITS.websiteMax} placeholder="example.com"
                            aria-describedby={`profile-website-count${webError ? ' profile-website-help' : ''}`} aria-invalid={Boolean(webError)}
                            value={website} onChange={(e) => onField('website', e.target.value)}
                            onBlur={() => { setWebsiteTouched(true); const next = normalizeWebsite(website); if (next !== website) onField('website', next) }} />
                    </Field>
                </div>
            </EditPanel>

            <EditPanel title="Private details" extra={<OnlyYou />}>
                <div className="nb-pf-egrid">
                    <div className="nb-pf-f wide">
                        <GenderChoice name="profileGenderIdentity" value={(profile.genderIdentity ?? '') as OnboardingGenderIdentity | ''} onChange={(value) => onField('genderIdentity', value)} />
                    </div>
                    <Field id="profile-pronouns" label="Pronouns" value={profile.pronouns} max={PROFILE_FIELD_LIMITS.pronounsMax}>
                        <Input id="profile-pronouns" name="pronouns" maxLength={PROFILE_FIELD_LIMITS.pronounsMax} value={profile.pronouns ?? ''}
                            onChange={(e) => onField('pronouns', e.target.value)} placeholder="e.g. they/them" />
                    </Field>
                </div>
                <p className="nb-pf-help">Not shown on your profile. Only you can see these.</p>
            </EditPanel>
        </div>
    )
}

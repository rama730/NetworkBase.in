'use client'

import { useRef, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import UsernameInput from '@/components/onboarding/UsernameInput'
import { initialsForName } from '@/lib/profile/display'
import { PROFILE_FIELD_LIMITS } from '@/lib/validations/profile-fields'
import type { UsernameCheck } from '@/lib/onboarding/block-reason'

export interface Step1IdentityProps {
  fullName: string
  username: string
  avatarUrl: string
  isUploadingAvatar: boolean
  /** Shown beside the photo: "uploaded" or why it failed. */
  avatarMessage: { kind: 'status' | 'error'; text: string } | null
  usernameServerError: string | null
  /** After a refused Continue: show what is missing. */
  showErrors: boolean
  onFullNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onAvatarPick: (file: File) => void
  onUsernameCheck: (check: UsernameCheck) => void
}

export function Step1Identity({
  fullName,
  username,
  avatarUrl,
  isUploadingAvatar,
  avatarMessage,
  usernameServerError,
  showErrors,
  onFullNameChange,
  onUsernameChange,
  onAvatarPick,
  onUsernameCheck,
}: Step1IdentityProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nameTouched, setNameTouched] = useState(false)
  // Handles are suggested once, when the person leaves the name field, not on every keystroke.
  const [suggestFor, setSuggestFor] = useState(() =>
    fullName.trim().length >= PROFILE_FIELD_LIMITS.fullNameMin ? fullName.trim() : '',
  )
  const nameError = (nameTouched || showErrors) && fullName.trim().length < PROFILE_FIELD_LIMITS.fullNameMin
    ? 'Enter your full name (at least 2 characters).'
    : null

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 max-md:flex-col max-md:items-start">
        <Avatar className="h-[72px] w-[72px] rounded-[var(--onb-radius-avatar)] border border-border">
          <AvatarImage src={avatarUrl} alt="" />
          <AvatarFallback identityKey={username || fullName} className="rounded-[var(--onb-radius-avatar)] bg-muted text-lg text-muted-foreground">
            {initialsForName(fullName, username)}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col items-start gap-2">
          <p className="onb-section-kicker">Profile photo</p>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Cleared so choosing the same file again (after an error) still fires.
              event.target.value = ''
              if (file) onAvatarPick(file)
            }}
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
            className="min-h-11"
          >
            {isUploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isUploadingAvatar ? 'Uploading photo' : avatarUrl ? 'Replace photo' : 'Upload photo'}
          </Button>
          <p className="onb-field-hint">Optional. JPG, PNG or WebP. You can change it later.</p>
          <p
            className={avatarMessage?.kind === 'error' ? 'onb-field-error' : 'onb-field-status'}
            role="status"
            aria-live="polite"
          >
            {avatarMessage?.text ?? ''}
          </p>
        </div>
      </div>

      <div className="onb-field">
        <label htmlFor="fullName" className="onb-field-label">
          Full name <span className="onb-required" aria-hidden="true">*</span>
          <span className="sr-only"> (required)</span>
        </label>
        <Input
          id="fullName"
          placeholder="John Doe"
          value={fullName}
          onChange={(event) => onFullNameChange(event.target.value)}
          onBlur={() => {
            setNameTouched(true)
            setSuggestFor(fullName.trim().length >= PROFILE_FIELD_LIMITS.fullNameMin ? fullName.trim() : '')
          }}
          className="onb-input"
          maxLength={PROFILE_FIELD_LIMITS.fullNameMax}
          autoComplete="name"
          aria-required="true"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? 'full-name-hint full-name-error' : 'full-name-hint'}
        />
        <p id="full-name-hint" className="onb-field-hint">Use the name you want collaborators to see.</p>
        <p id="full-name-error" className="onb-field-error" role={nameError ? 'alert' : undefined}>{nameError ?? ''}</p>
      </div>

      <UsernameInput
        value={username}
        onChange={onUsernameChange}
        onCheck={onUsernameCheck}
        suggestFor={suggestFor}
        serverError={usernameServerError}
      />
    </div>
  )
}

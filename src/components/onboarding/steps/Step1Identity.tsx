'use client'

import { useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import UsernameInput from '@/components/onboarding/UsernameInput'
import type { UsernameAvailabilityStatus } from '@/hooks/useUsernameAvailability'

export interface Step1IdentityProps {
  fullName: string
  username: string
  avatarUrl: string
  isUploadingAvatar: boolean
  onFullNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onUsernameStatusChange: (status: UsernameAvailabilityStatus) => void
  allowRemoteUsernameChecks?: boolean
  avatarStatus?: string | null
}

/**
 * Step 1 — Identity layout (redesigned).
 *
 * Visual changes from the original:
 * - Avatar: 72px, compact inline row (not stacked), with the shared fallback
 * - Contextual upload or replacement action beside avatar
 * - Username field with `@` prefix indicator inside input
 * - Pre-fill hints in neutral `muted-foreground` at 12px (no green, no icon)
 * - No emoji in headings, left-aligned everything
 * - Mobile: avatar centered above form (not inline row)
 */
export function Step1Identity({
  fullName,
  username,
  avatarUrl,
  isUploadingAvatar,
  onFullNameChange,
  onUsernameChange,
  onAvatarChange,
  onUsernameStatusChange,
  allowRemoteUsernameChecks = true,
  avatarStatus,
}: Step1IdentityProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0])
    .join('')
    .toUpperCase() || 'U'

  return (
    <div className="space-y-8">
      {/* Avatar row: inline on desktop, centered on mobile */}
      <div
        className={cn(
          'flex items-center gap-4',
          'max-md:flex-col max-md:items-start'
        )}
      >
        <Avatar className="h-[72px] w-[72px] rounded-[var(--onb-radius-avatar)] border border-border">
          <AvatarImage src={avatarUrl} alt={fullName || 'Profile photo'} />
          <AvatarFallback identityKey={username || fullName} className="rounded-[var(--onb-radius-avatar)] bg-muted text-lg text-muted-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col items-start gap-2">
          <p className="onb-section-kicker">Profile photo</p>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onAvatarChange}
            accept="image/*"
            className="hidden"
            aria-label="Upload profile photo"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
            className="onb-focusable min-h-[44px] md:min-h-0"
          >
            {isUploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isUploadingAvatar ? 'Uploading photo' : avatarUrl ? 'Replace photo' : 'Upload photo'}
          </Button>
          <p className="onb-field-hint">Optional. You can change this later.</p>
          {avatarStatus ? <p className="onb-field-status" role="status" aria-live="polite">{avatarStatus}</p> : null}
        </div>
      </div>

      {/* Full Name field */}
      <div className="onb-field">
        <label htmlFor="fullName" className="onb-field-label">
          Full name <span className="onb-required">*</span>
        </label>
        <Input
          id="fullName"
          placeholder="John Doe"
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
          className="onb-input"
          aria-describedby="full-name-hint"
        />
        <p id="full-name-hint" className="onb-field-hint">
          {avatarUrl ? 'Pre-filled from your account. Use the name you want collaborators to see.' : 'Use the name you want collaborators to see.'}
        </p>
      </div>

      {/* Username field */}
      <UsernameInput
        value={username}
        onChange={onUsernameChange}
        fullName={fullName}
        allowRemoteChecks={allowRemoteUsernameChecks}
        onStatusChange={onUsernameStatusChange}
      />
    </div>
  )
}

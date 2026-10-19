'use client'

import { Briefcase, CalendarClock, Pencil } from 'lucide-react'
import { Card } from './Card'
import { cn } from '@/lib/utils'
import {
  experienceLevelLabel,
  getRolePreferences,
  rolePreferenceLabel,
  weeklyCapacityLabel,
} from '@/lib/profile/role-preferences'

interface OpenToRolesCardProps {
  openTo?: unknown
  experienceLevel?: unknown
  hoursPerWeek?: unknown
  isOwner: boolean
  onEdit?: () => void
  onInvite?: () => void
  onInviteIntent?: () => void
  onApply?: () => void
  onApplyIntent?: () => void
  hasOpenRoles?: boolean
}

export function OpenToRolesCard({
  openTo,
  experienceLevel,
  hoursPerWeek,
  isOwner,
  onEdit,
  onInvite,
  onInviteIntent,
  onApply,
  onApplyIntent,
  hasOpenRoles = false,
}: OpenToRolesCardProps) {
  const roles = getRolePreferences(openTo)
  const experience = experienceLevelLabel(experienceLevel)
  const capacity = weeklyCapacityLabel(hoursPerWeek)
  const hasPreferences = roles.length > 0 || Boolean(experience) || Boolean(capacity)

  if (!isOwner && !hasPreferences && !onInvite && !hasOpenRoles) return null

  const editAction = isOwner && onEdit ? (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Edit role preferences"
      className="nb-touch-target inline-flex items-center justify-center rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:rounded-[5px]"
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null

  return (
    <Card
      id="profile-open-to-roles"
      title="Open to Roles"
      icon={<Briefcase className="h-4 w-4" />}
      action={editAction}
    >
      <div className="space-y-4 px-5 py-4 max-md:px-4">
        {roles.length > 0 ? (
          <ul aria-label="Preferred role types" className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <li
                key={role}
                className="nb-tag font-medium"
              >
                {rolePreferenceLabel(role)}
              </li>
            ))}
          </ul>
        ) : null}

        {experience || capacity ? (
          <dl className="nb-compact space-y-2">
            {experience ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Experience</dt>
                <dd className="font-medium text-foreground">{experience}</dd>
              </div>
            ) : null}
            {capacity ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="inline-flex items-center gap-1 text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  Weekly capacity
                </dt>
                <dd className="text-right font-medium text-foreground">{capacity}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {!hasPreferences ? (
          <p className="nb-body text-muted-foreground">
            {isOwner ? 'Tell people which roles and opportunities interest you.' : 'Role preferences have not been shared.'}
          </p>
        ) : null}

        {isOwner && !hasPreferences && onEdit ? (
          <button type="button" onClick={onEdit} className="nb-ui-label text-primary hover:text-primary/80 transition-colors">
            Set role preferences
          </button>
        ) : null}

        {!isOwner && (hasOpenRoles || onInvite) && (
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            {hasOpenRoles && onApply && (
              <button
                type="button"
                onClick={onApply}
                onMouseEnter={onApplyIntent}
                onFocus={onApplyIntent}
                className={cn(
                  "nb-ui-label inline-flex items-center justify-center gap-2 rounded-[3px] px-4 py-2.5 font-semibold transition-colors duration-[130ms] shadow-none bg-primary text-primary-foreground hover:bg-primary/90",
                  onInvite ? "w-full sm:w-1/2" : "w-full"
                )}
              >
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Apply to join
              </button>
            )}
            {onInvite && (
              <button
                type="button"
                onClick={onInvite}
                onMouseEnter={onInviteIntent}
                onFocus={onInviteIntent}
                className={cn(
                  "nb-ui-label inline-flex items-center justify-center gap-2 rounded-[3px] border border-border bg-card px-4 py-2.5 font-semibold text-foreground transition-colors duration-[130ms] hover:bg-muted",
                  hasOpenRoles ? "w-full sm:w-1/2" : "w-full"
                )}
              >
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Invite to project
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

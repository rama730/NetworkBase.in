'use client'

import { Briefcase, Pencil } from 'lucide-react'
import { RailSection } from '@/components/ui/rail-section'
import { OwnerOnlyNote } from './Card'
import { FactList } from './FactList'
import { Button } from '@/components/ui/button'
import {
  experienceLevelLabel,
  getRolePreferences,
  rolePreferenceLabel,
  WEEKLY_CAPACITY_OPTIONS,
} from '@/lib/profile/role-preferences'

interface OpenToRolesCardProps {
  openTo?: unknown
  openToCollaborate?: boolean
  customRoles?: string[]
  categories?: string[]
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
  openToCollaborate = false,
  customRoles = [],
  categories = [],
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
  const capacity = WEEKLY_CAPACITY_OPTIONS.find(option => option.value === hoursPerWeek)
  const preferences = [
    { label: 'Role types', values: roles.map(role => rolePreferenceLabel(role) || role) },
    { label: 'Preferred roles', values: customRoles },
    { label: 'Categories', values: categories },
    { label: 'Experience', values: experience ? [experience] : [] },
    { label: 'Weekly availability', values: capacity ? [capacity.compactLabel] : [], description: capacity?.label },
  ].filter(row => row.values.length > 0)
  const hasPreferences = preferences.length > 0
  const showApply = !isOwner && hasOpenRoles && Boolean(onApply)
  const showInvite = !isOwner && Boolean(onInvite)

  if (!isOwner && !openToCollaborate) return null

  const editAction = isOwner && onEdit ? (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Edit role preferences"
      className="nb-touch-target inline-flex items-center justify-center rounded-[5px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null

  return (
    <RailSection
      id="profile-open-to-roles"
      title="Collaboration preferences"
      action={editAction}
      contentClassName="p-5 max-md:p-4"
    >
      <div className="space-y-4">
        {hasPreferences ? (
          <FactList facts={preferences} />
        ) : (
          <div>
            <p className="nb-body text-muted-foreground">
              {isOwner ? 'Add the role types, roles, and categories that interest you.' : 'Open to collaboration. Specific role preferences have not been added yet.'}
            </p>
            {/* Visitors see this card only when Open to collaborate is on. */}
            {isOwner && !openToCollaborate ? <OwnerOnlyNote /> : null}
          </div>
        )}

        {showApply || showInvite ? (
          <div className="space-y-2 border-t border-border pt-4">
            {showApply ? (
              <Button type="button" size="sm" onClick={onApply} onMouseEnter={onApplyIntent} onFocus={onApplyIntent}
                className="min-h-11 w-full">
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Apply for a role
              </Button>
            ) : null}
            {showInvite ? (
              <Button type="button" variant="outline" size="sm" onClick={onInvite} onMouseEnter={onInviteIntent} onFocus={onInviteIntent}
                className="min-h-11 w-full">
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Invite to workspace
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </RailSection>
  )
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('profile layout (mix): band, the tab bar touching it, the skills strip, then the main column and one right card', () => {
  const client = read('src/components/profile/v2/ProfileV2Client.tsx')
  const shell = read('src/components/profile/v2/ProfileShell.tsx')
  const bar = read('src/components/profile/v2/ProfileTabBar.tsx')

  assert.doesNotMatch(client, /<SkillsCard/)
  assert.match(client, /<SkillsStrip /)
  assert.match(client, /<ProfileTabBar/)
  assert.match(client, /key: 'contributions', label: 'Contributions', count:/)
  assert.match(shell, /\{header\}\s*\{tabs\}\s*\{strip\}/)
  assert.match(shell, /data-testid="profile-tabs-shell"/)
  assert.match(shell, /className="nb-pf-rail"/)
  assert.match(bar, /role="tablist"/)
  assert.match(bar, /ArrowLeft/)
})

test('current availability is absent from live product contracts and schema', () => {
  const schema = read('src/lib/db/schema/index.ts')
  const onboarding = read('src/components/onboarding/steps/Step2Details.tsx')
  const migration = read('drizzle/0002_profiles_accounts.sql')

  assert.doesNotMatch(schema, /availabilityStatus/)
  assert.doesNotMatch(onboarding, /Current availability|Availability Status/)
  assert.match(onboarding, /Weekly availability/)
  assert.match(onboarding, /Open to roles/)
  assert.doesNotMatch(migration, /availability_status/)
})

test('profile summary is the calm band (mix): photo, serif name, handle + tag, headline, one row, inline stats', () => {
  const client = read('src/components/profile/v2/ProfileV2Client.tsx')
  const header = read('src/components/profile/v2/ProfileBand.tsx')

  assert.match(header, /<PersonPresenceBadge userId=\{profile\?\.id \?\? null\} lastActiveAt=\{vm\.lastActiveAt\}/)
  assert.match(header, /className="nb-pf-band-in"/)
  assert.match(header, /<h1 className="nb-pf-name" data-pf-name>/)
  assert.doesNotMatch(header, /hover:scale|group-hover:scale|hover:translate/)
  assert.match(header, /'Open to collaborate' : 'Not open to collaborate'/)
  assert.match(header, /\['Connections', connectionsCount, onConnectionsClick\]/)
  assert.match(header, /\['Workspaces', projectsCount, onProjectsClick\]/)
  assert.match(header, /Set a status/)
  assert.match(header, />Edit profile</)
  assert.match(header, /aria-label="Share profile"/)
  assert.match(header, /'profile-summary-header'/)
  assert.match(client, /onConnectionsClick=\{handleOpenConnections\}/)
  assert.match(client, /onProjectsClick=\{handleOpenProjects\}/)
})

test('public profile actions use the design-system hierarchy and hide unavailable messaging', () => {
  const client = read('src/components/profile/v2/ProfileV2Client.tsx')
  const header = read('src/components/profile/v2/ProfileBand.tsx')
  const rail = read('src/components/profile/v2/sections/ProfileFactsCard.tsx')

  assert.match(header, /import \{ Button \} from '@\/components\/ui\/button'/)
  assert.match(header, /resolveProfileActionState\(\{/)
  assert.match(header, /\{showMessageAction \? <DropdownMenuItem onClick=\{onMessage\}/)
  assert.doesNotMatch(header, /disabled=\{!isAuthenticated \|\| !canMessage\}/)
  assert.doesNotMatch(header, /(?:border-sky-200|bg-sky-50|border-amber-200|bg-amber-50)(?:\s|')/)
  assert.doesNotMatch(header, /Ellipsis|IconButton/)
  assert.match(header, /variant=\{relationshipControlVariant\}/)
  assert.match(header, /<DropdownMenuItem onClick=\{onMessage\}/)
  // Block lives in the person's one ⋯ menu beside Report (Blocking B6), not in the Connect menu.
  assert.match(header, /<ItemMenu label=\{`More actions for \$\{name\}`\}[\s\S]*?\{canManageBlock \? \(/)
  assert.match(header, /\) : isInteractionBlocked && !privacyRelationship\.blockedByViewer \? \(/)
  assert.doesNotMatch(rail, /title="Shortcuts"/)
  assert.match(client, /<ProfileFactsCard/)
})

test('profile surfaces use the shared typography roles', () => {
  const rail = read('src/components/profile/v2/sections/ProfileFactsCard.tsx')
  const about = read('src/components/profile/v2/sections/AboutSection.tsx')
  const projects = read('src/components/profile/v2/sections/WorkspacesGridCard.tsx')
  const contributions = read('src/components/profile/v2/sections/ContributionTimeline.tsx')
  const editor = read('src/components/profile/edit/EditProfileTabs.tsx') + read('src/components/profile/edit/DetailsSection.tsx')

  assert.match(rail, /nb-pf-fsec/)
  assert.match(rail, /<FactList /)
  assert.match(about, /nb-pf-about/)
  assert.doesNotMatch(about, /font-serif|nb-pf-name/)
  assert.match(projects, /nb-pf-label/)
  assert.match(projects, /nb-compact/)
  assert.match(contributions, /nb-pf-tl-card/)
  assert.match(contributions + read('src/components/profile/ContributionStoryView.tsx'), /nb-meta/)
  // Edit profile's sections carry the profile's own section label and panel (spec: profile mix).
  assert.match(editor, /<EditPanel title=/)
  assert.match(editor, /nb-pf-label has-rule/)
  assert.match(editor, /nb-ui-label/)
  assert.match(editor, /nb-body/)
  assert.match(editor, /nb-meta/)
  assert.doesNotMatch(editor, /text-\[13px\]/)
})

test('portfolio project cards reuse Discovery and versioned local image URLs remain supported', () => {
  const config = read('next.config.ts')
  const projects = read('src/components/profile/v2/sections/WorkspacesGridCard.tsx')
  const css = read('src/app/globals.css')
  const collaboration = read('src/lib/profile/collaboration.ts')

  assert.match(config, /pathname: '\/api\/v1\/workspaces\/\*\/image'/)
  assert.match(projects, /import ProjectCard from "@\/components\/workspaces\/WorkspaceCard"/)
  assert.match(projects, /<ProjectCard/)
  assert.match(projects, /toWorkspaceCardViewModel\(cardProject\)/)
  assert.doesNotMatch(projects, /from "next\/image"/)

  // Full parity with Discovery: links, open roles count, and single-column full-width layout
  assert.match(projects, /githubRepoUrl:\s*project\.githubRepoUrl/)
  assert.match(projects, /externalLinks:\s*project\.externalLinks/)
  assert.match(projects, /openRolesCount:\s*project\.openRolesCount/)
  assert.match(css, /\.nb-portfolio-grid\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;\s*gap:\s*16px;\s*\}/)
  assert.match(collaboration, /p\.github_repo_url/)
  assert.match(collaboration, /p\.external_links/)
  assert.match(collaboration, /p\.open_roles_count/)
})

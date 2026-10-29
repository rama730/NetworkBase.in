/** Titles for the four steps: the page header, the sidebar and the mobile bar all read these. */
export interface StepConfig {
  id: 1 | 2 | 3 | 4
  title: string
  subtitle: string
  sidebarLabel: string
  /** One short line under the step name in the desktop rail. */
  railHint: string
}

export const STEP_UI_CONFIG: readonly StepConfig[] = [
  {
    id: 1,
    title: "Let’s set up your profile",
    subtitle: 'Choose a username and confirm your name',
    sidebarLabel: 'Identity',
    railHint: 'Name, username, photo',
  },
  {
    id: 2,
    title: 'Tell us about yourself',
    subtitle: 'All optional. Add what helps people know you, or skip for now.',
    sidebarLabel: 'Details · optional',
    railHint: 'Work, profile, links',
  },
  {
    id: 3,
    title: 'What are you good at?',
    subtitle: 'Pick skills and topics that describe you',
    sidebarLabel: 'Skills',
    railHint: 'Skills and interests',
  },
  {
    id: 4,
    title: 'Privacy & visibility',
    subtitle: 'Choose who can find you and start a conversation. You can change these later.',
    sidebarLabel: 'Privacy',
    railHint: 'Visibility and messages',
  },
]

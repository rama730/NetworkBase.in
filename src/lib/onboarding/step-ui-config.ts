/** Titles for the four steps: the page header, the steps bar and the ink panel all read these. */
export interface StepConfig {
  id: 1 | 2 | 3 | 4
  title: string
  subtitle: string
  /** The step's cell in the top bar. */
  stepLabel: string
  /** The ink panel's serif headline; step 1 greets the person by first name. */
  panelTitle: (firstName: string) => string
}

export const STEP_UI_CONFIG: readonly StepConfig[] = [
  {
    id: 1,
    title: "Let’s set up your profile",
    subtitle: 'Choose a username and confirm your name',
    stepLabel: 'Identity',
    panelTitle: (first) => (first ? `Hi, ${first}. Let’s make your page.` : 'Hi. Let’s make your page.'),
  },
  {
    id: 2,
    title: 'Tell us about yourself',
    subtitle: 'All optional. Add what helps people know you, or skip for now.',
    stepLabel: 'About you',
    panelTitle: () => 'People join work they can picture.',
  },
  {
    id: 3,
    title: 'What are you good at?',
    subtitle: 'Pick skills and topics that describe you',
    stepLabel: 'Skills',
    panelTitle: () => 'Skills help the right people find you.',
  },
  {
    id: 4,
    title: 'Privacy and visibility',
    subtitle: 'Choose who can find you and start a conversation. You can change these later.',
    stepLabel: 'Privacy',
    panelTitle: () => 'You decide who finds you.',
  },
]

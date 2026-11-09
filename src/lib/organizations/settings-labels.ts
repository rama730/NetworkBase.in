// One set of words for the settings that appear both when creating an organization and in its Settings
// (org design plan ST15): the same label, help and option words in both places.

export const ORG_SETTING_LABELS = {
    reviewRequired: { label: 'Check finished work', help: 'Admins approve or return finished work before it counts as done.' },
    lateRule: { label: 'Late work', help: 'What happens after the due date.', options: { always: 'Always accepted', until: 'Accepted until a date', none: 'Not accepted' } },
    reminders: { label: 'Reminders', help: 'Sent at 9:00 in each person’s time zone to people who haven’t handed in yet.', options: { both: 'Day before and due day', day_before: 'Day before', due_day: 'On the due day', off: 'Off' } },
    storyPoints: { label: 'Story points', help: 'Hidden removes the field everywhere in this organization.', options: { shown: 'Shown', hidden: 'Hidden' } },
    dueTime: { label: 'Due time', help: 'Filled in when someone picks a due date. They can still change it.' },
    mainSprintWord: { label: 'Main sprint is called', help: (main: string, inner: string) => `The longer sprints that hold the ${inner.toLowerCase()}s. New ones are numbered, like ${main} 1.` },
    joinMode: { label: 'How people join', options: { instant: 'Instant', approval: 'Approval required' } },
    outsidePeople: { label: 'People outside the organization can be added to its workspaces', help: 'They see only that workspace, never the organization’s content.' },
    childCreation: { label: 'Who can create workspaces', options: { members: 'All members', admins: 'Admins only' } },
} as const

/** The line under each join mode, in the organization's own word for a member. */
export const joinModeHint = (mode: 'instant' | 'approval', memberWord: string) =>
    mode === 'instant' ? `Anyone with the code becomes a ${memberWord}.` : 'The code sends a request an admin approves.'



export const APPLICATION_CORE_STATUSES = ['none', 'pending', 'accepted', 'rejected', 'withdrawn', 'proposed'] as const;
export type ApplicationCoreStatus = (typeof APPLICATION_CORE_STATUSES)[number];

export const APPLICATION_LIFECYCLE_STATUSES = [
    'pending',
    'accepted',
    'rejected',
    'withdrawn',
    'proposed',
    'role_filled',
] as const;
export type ApplicationLifecycleStatus = (typeof APPLICATION_LIFECYCLE_STATUSES)[number];

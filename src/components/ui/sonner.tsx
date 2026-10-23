'use client';

import { FeedbackHost } from '@/components/feedback/FeedbackHost';
import { ManualCopyDialog } from '@/components/feedback/ManualCopyDialog';

/** The existing provider entry point, with one compact host and a task-specific copy fallback. */
export function Toaster() { return <><FeedbackHost /><ManualCopyDialog /></>; }

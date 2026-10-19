import { z } from 'zod';

export const APPLICATION_MESSAGE_MAX = 2000;
export const APPLICATION_NOTE_MAX = 500;

const applicationMessage = z
    .string({ error: 'Please add a short application message' })
    .trim()
    .min(1, 'Please add a short application message')
    .max(APPLICATION_MESSAGE_MAX, `Applications are limited to ${APPLICATION_MESSAGE_MAX} characters`);

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** The apply form's structured fields; blanks are dropped, so the stored object only holds what was filled in. */
export const applicationDetailsSchema = z
    .object({
        portfolioUrl: z.preprocess(
            blankToUndefined,
            z.string().trim().max(300, 'Portfolio link is too long').regex(/^https?:\/\/\S+$/i, 'Enter a valid portfolio or GitHub URL').optional(),
        ),
        availability: z.preprocess(blankToUndefined, z.string().trim().max(120, 'Availability is limited to 120 characters').optional()),
    })
    .strict();

export type ApplicationDetails = { portfolioUrl?: string; availability?: string };

export const applyToRoleInputSchema = z.object({
    projectId: z.string().uuid('Invalid project'),
    roleId: z.string().uuid('Invalid role'),
    message: applicationMessage,
    details: applicationDetailsSchema.default({}),
});

export const editApplicationInputSchema = z.object({
    applicationId: z.string().uuid('Invalid application'),
    message: applicationMessage,
    roleId: z.string().uuid('Invalid role').optional(),
    details: applicationDetailsSchema.default({}),
});

export const applicationNoteSchema = z.string().trim().max(APPLICATION_NOTE_MAX, `Notes are limited to ${APPLICATION_NOTE_MAX} characters`).optional();

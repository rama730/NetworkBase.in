import { z } from 'zod';

export const APPLICATION_MESSAGE_MAX = 2000;
export const APPLICATION_NOTE_MAX = 500;

const applicationMessage = z
    .string({ error: 'Please add a short application message' })
    .trim()
    .min(1, 'Please add a short application message')
    .max(APPLICATION_MESSAGE_MAX, `Applications are limited to ${APPLICATION_MESSAGE_MAX} characters`);

export const applyToRoleInputSchema = z.object({
    projectId: z.string().uuid('Invalid project'),
    roleId: z.string().uuid('Invalid role'),
    message: applicationMessage,
});

export const editApplicationInputSchema = z.object({
    applicationId: z.string().uuid('Invalid application'),
    message: applicationMessage,
    roleId: z.string().uuid('Invalid role').optional(),
});

export const applicationNoteSchema = z.string().trim().max(APPLICATION_NOTE_MAX, `Notes are limited to ${APPLICATION_NOTE_MAX} characters`).optional();

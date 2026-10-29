'use client';

import { get, set, del } from 'idb-keyval';
import { CreateWorkspaceInput } from '@/lib/validations/workspace';

const DEFAULT_DRAFT_KEY = 'project_wizard_draft';
const EXPIRY_DAYS = 3;  // Draft expires after 3 days

export interface WizardDraft extends Partial<CreateWorkspaceInput> {
    _timestamp: number;
    _phase: number;
}

export interface DraftInfo {
    exists: boolean;
    phase: number;
    savedAt: Date | null;
    isExpired: boolean;
    /** The org the draft was being created in (report §14.5), if any. */
    parentOrgId?: string | null;
}

function getDraftKey(userId?: string | null): string {
    return userId ? `project_wizard_draft:${userId}` : DEFAULT_DRAFT_KEY;
}

/**
 * IndexedDB-backed draft storage with expiration, scoped by user ID to prevent
 * cross-account draft leakage on shared browsers.
 */
export const draftStore = {
    /**
     * Save draft to IndexedDB (scoped by user ID)
     */
    async save(data: Partial<CreateWorkspaceInput>, phase: number, userId?: string | null): Promise<void> {
        const key = getDraftKey(userId);
        const draft: WizardDraft = {
            ...data,
            _timestamp: Date.now(),
            _phase: phase,
        };

        try {
            await set(key, draft);
        } catch {
            try {
                localStorage.setItem(key, JSON.stringify(draft));
            } catch { /* Silent */ }
        }
    },

    /**
     * Load draft (returns null if expired or not found)
     */
    async load(userId?: string | null): Promise<WizardDraft | null> {
        const draft = await this._getRaw(userId);
        if (!draft) return null;

        // Check expiration (3 days)
        const ageMs = Date.now() - draft._timestamp;
        const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

        if (ageMs > expiryMs) {
            // Auto-clear expired draft
            await this.clear(userId);
            return null;
        }

        return draft;
    },

    /**
     * Get draft info without loading full data (for UI display)
     */
    async getInfo(userId?: string | null): Promise<DraftInfo> {
        const draft = await this._getRaw(userId);

        if (!draft) {
            return { exists: false, phase: 1, savedAt: null, isExpired: false };
        }

        const ageMs = Date.now() - draft._timestamp;
        const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        const isExpired = ageMs > expiryMs;

        if (isExpired) {
            await this.clear(userId);
            return { exists: false, phase: 1, savedAt: null, isExpired: true };
        }

        return {
            exists: true,
            phase: draft._phase || 1,
            savedAt: new Date(draft._timestamp),
            isExpired: false,
            parentOrgId: (draft as { parent_org_id?: string | null }).parent_org_id ?? null,
        };
    },

    /**
     * Clear draft
     */
    async clear(userId?: string | null): Promise<void> {
        const key = getDraftKey(userId);
        try { await del(key); } catch { /* Silent */ }
        try { localStorage.removeItem(key); } catch { /* Silent */ }

        // Also clean legacy un-scoped key if user ID was provided
        if (userId) {
            try { await del(DEFAULT_DRAFT_KEY); } catch { /* Silent */ }
            try { localStorage.removeItem(DEFAULT_DRAFT_KEY); } catch { /* Silent */ }
        }
    },

    /**
     * Internal: Get raw draft without expiry check
     */
    async _getRaw(userId?: string | null): Promise<WizardDraft | null> {
        const key = getDraftKey(userId);
        try {
            const draft = await get<WizardDraft>(key);
            if (draft) return draft;
        } catch { /* IndexedDB failed */ }

        try {
            const stored = localStorage.getItem(key);
            if (stored) return JSON.parse(stored) as WizardDraft;
        } catch { /* Parse failed */ }

        // Fallback check for legacy un-scoped draft if user-scoped draft not found
        if (userId && key !== DEFAULT_DRAFT_KEY) {
            try {
                const legacy = await get<WizardDraft>(DEFAULT_DRAFT_KEY);
                if (legacy) return legacy;
            } catch { /* IndexedDB failed */ }

            try {
                const legacyStored = localStorage.getItem(DEFAULT_DRAFT_KEY);
                if (legacyStored) return JSON.parse(legacyStored) as WizardDraft;
            } catch { /* Parse failed */ }
        }

        return null;
    },
};

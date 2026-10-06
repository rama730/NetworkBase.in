"use client";

import { create } from "zustand";

/**
 * The status picker is one dialog for the whole app, opened from the avatar menu, the profile, or /status.
 * `/status in a meeting` opens it with that text filled in (`draftText`).
 */
export const usePresenceUi = create<{ pickerOpen: boolean; draftText: string | null; setPickerOpen: (open: boolean, draftText?: string | null) => void }>()((set) => ({
  pickerOpen: false,
  draftText: null,
  setPickerOpen: (pickerOpen, draftText = null) => set({ pickerOpen, draftText: pickerOpen ? draftText : null }),
}));

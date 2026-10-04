"use client";

import { create } from "zustand";

/** The status picker is one dialog for the whole app, opened from the avatar menu, the profile, or /status. */
export const usePresenceUi = create<{ pickerOpen: boolean; setPickerOpen: (open: boolean) => void }>()((set) => ({
  pickerOpen: false,
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
}));

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import { MAX_NOTIFICATION_PAUSE_MS, mergeNotificationPreferences } from "@/lib/notifications/merge";
import type { NotificationPreferences } from "@/lib/notifications/types";

const withMute: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    mutedScopes: [{ kind: "project", value: "11111111-1111-4111-8111-111111111111", label: "Ponytail" }],
};

test("a toggle changes only its own setting: a mute added meanwhile survives", () => {
    // The settings page still holds a copy from before the tray added the mute.
    const stale: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, mentions: false };
    const merged = mergeNotificationPreferences(withMute, stale, ["mentions"]);
    assert.equal(merged.mentions, false);
    assert.equal(merged.mutedScopes.length, 1, "the stored mute is kept");
});

test("a change to the mute list does not revert other settings saved elsewhere", () => {
    const stored: NotificationPreferences = { ...withMute, delivery: { ...withMute.delivery, email: false } };
    const unmuted: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, mutedScopes: [] };
    const merged = mergeNotificationPreferences(stored, unmuted, ["mutedScopes"]);
    assert.equal(merged.mutedScopes.length, 0);
    assert.equal(merged.delivery.email, false, "the email setting saved elsewhere is not put back");
});

test("without changed keys the whole object replaces the stored one", () => {
    const merged = mergeNotificationPreferences(withMute, DEFAULT_NOTIFICATION_PREFERENCES, undefined);
    assert.equal(merged.mutedScopes.length, 0);
});

test("a pause is bounded to a year", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    const forever: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, pausedUntil: "2999-01-01T00:00:00.000Z" };
    const merged = mergeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES, forever, ["pausedUntil"], now);
    assert.equal(new Date(merged.pausedUntil!).getTime(), now + MAX_NOTIFICATION_PAUSE_MS);
});

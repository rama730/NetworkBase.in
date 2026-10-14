"use client";

// ============================================================================
// Task Panel Overhaul - Wave 4: MentionComposer
//
// A contentEditable composer that understands `@mention` tokens. The composer
// is the source of truth for two kinds of content:
//
//   - Plain text that the user typed. Stays in native text nodes so the
//     browser handles caret movement, IME composition, undo, etc.
//   - Atomic mention chips rendered as `<span contenteditable="false">` with
//     `data-mention-id` / `data-mention-name` attributes.
//
// Serialization round-trips through `@/lib/projects/mention-tokens`, so the
// authoritative representation that gets sent to the server is the raw string
// `@{uuid|Display Name}` - identical to what comes back down on read.
//
// Lifecycle:
//   1. Parent passes `resetKey`. When it changes (after a successful submit),
//      we clear the editor. We do NOT attempt to re-render the editor from a
//      `value` prop; React and contentEditable fight hard in that model, and
//      the composer is always a fresh draft anyway.
//   2. Every input -> we re-serialize the editor and notify the parent via
//      `onDraftChange(raw)` so they can show typing indicators, disable the
//      submit button, etc.
//   3. When the caret is inside an `@query` run, we fetch the project members
//      endpoint, render the `MentionAutocomplete`, and handle keyboard
//      navigation locally.
// ============================================================================

import * as React from "react";

import {
    buildMentionToken,
    MENTION_DISPLAY_NAME_MAX_LENGTH,
    sanitizeMentionDisplayName,
} from "@/lib/projects/mention-tokens";
import { cn } from "@/lib/utils";

import {
    MentionAutocomplete,
    type MentionCandidate,
} from "./MentionAutocomplete";

// ---------------------------------------------------------------------------
// Types + props
// ---------------------------------------------------------------------------

export interface MentionComposerProps {
    projectId: string;
    placeholder?: string;
    disabled?: boolean;
    /** Autofocus the editor on mount. */
    autoFocus?: boolean;
    /** Reset counter - bumping this clears the editor. */
    resetKey?: number;
    /** Called on every input with the serialized raw string (tokens intact). */
    onDraftChange?: (raw: string) => void;
    /** Called when the user hits Ctrl/Cmd + Enter while the menu is closed. */
    onSubmit?: () => void;
    className?: string;
    /** Lets an embedding surface reuse the editor without duplicating mention behavior. */
    editorClassName?: string;
    "aria-label"?: string;
}

// Shape of the candidate fetch response; stays narrow to match what the API
// route actually returns.
interface FetchedMember {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role?: "owner" | "admin" | "member" | "viewer";
}

interface MentionDetectState {
    query: string;
    textNode: Text;
    atOffset: number;
    cursorOffset: number;
    anchorRect: { top: number; left: number; height: number };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function clearEditor(root: HTMLElement) {
    while (root.firstChild) {
        root.removeChild(root.firstChild);
    }
}

function serializeEditor(root: HTMLElement): string {
    let out = "";

    const walk = (node: ChildNode) => {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent ?? "";
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = node as HTMLElement;
        const mentionId = el.dataset?.mentionId;
        if (mentionId) {
            const rawName =
                el.dataset.mentionName ?? el.textContent?.replace(/^@/, "") ?? "user";
            try {
                out += buildMentionToken({ userId: mentionId, displayName: rawName });
            } catch {
                // Invalid id from a hand-crafted DOM: fall back to plain text so
                // we never drop user content.
                out += `@${rawName}`;
            }
            return;
        }

        if (el.tagName === "BR") {
            out += "\n";
            return;
        }

        // Treat block-level wrappers (`<div>`, `<p>`) as implicit newlines so
        // multi-line input round-trips correctly on browsers that insert
        // `<div>` for each Enter key.
        const isBlock = el.tagName === "DIV" || el.tagName === "P";
        const needsLeadingNewline =
            isBlock && out.length > 0 && !out.endsWith("\n");
        if (needsLeadingNewline) out += "\n";
        el.childNodes.forEach(walk);
    };

    root.childNodes.forEach(walk);
    // Trim a trailing newline that the last `<div>` insertion would have added.
    return out.replace(/\n+$/, "");
}

function findAncestorEditor(node: Node | null, editor: HTMLElement): boolean {
    let current: Node | null = node;
    while (current) {
        if (current === editor) return true;
        current = current.parentNode;
    }
    return false;
}

export interface MentionComposerHandle {
    focus: () => void;
    triggerMention: () => void;
}

function detectMentionState(
    editor: HTMLElement,
): MentionDetectState | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;

    const { startContainer, startOffset } = range;
    if (!findAncestorEditor(startContainer, editor)) return null;
    if (startContainer.nodeType !== Node.TEXT_NODE) return null;

    const textNode = startContainer as Text;
    const text = textNode.textContent ?? "";

    // Walk backwards from the caret to find a `@` that is either at the start
    // of the text node or preceded by whitespace. Anything containing internal
    // whitespace closes the mention window.
    let idx = startOffset - 1;
    while (idx >= 0) {
        const ch = text[idx];
        if (!ch) return null;
        if (ch === "@") break;
        if (/\s/.test(ch)) return null;
        idx -= 1;
    }
    if (idx < 0) return null;
    if (idx > 0 && !/\s/.test(text[idx - 1] || "")) return null;

    const query = text.slice(idx + 1, startOffset);
    if (query.length > MENTION_DISPLAY_NAME_MAX_LENGTH) return null;

    // Anchor the menu to the bounding rect of `@query` relative to the editor container
    const anchor = document.createRange();
    anchor.setStart(textNode, idx);
    anchor.setEnd(textNode, startOffset);
    const clientRects = anchor.getClientRects();
    const rangeRect = clientRects.length > 0 ? clientRects[0] : anchor.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();

    const editorWidth = editorRect?.width || 380;
    const maxLeft = Math.max(4, editorWidth - 300 - 8);
    // When @ is at the start of a line or text (idx === 0), it anchors at the left padding (10px)
    const rawLeft = idx === 0
        ? 10
        : (rangeRect && editorRect && rangeRect.left > 0)
            ? Math.max(0, rangeRect.left - editorRect.left)
            : 10;
    const relLeft = Math.max(4, Math.min(rawLeft, maxLeft));

    // Flip upwards if near bottom of viewport
    const estimatedMenuHeight = 240;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;
    const shouldFlipUp = Boolean(
        rangeRect &&
        editorRect &&
        rangeRect.bottom + estimatedMenuHeight > viewportHeight - 16 &&
        editorRect.top > estimatedMenuHeight
    );

    const relTop = (shouldFlipUp && rangeRect && editorRect)
        ? Math.max(-estimatedMenuHeight, (rangeRect.top - editorRect.top) - estimatedMenuHeight - 4)
        : (rangeRect && editorRect && rangeRect.bottom > 0)
            ? Math.max(20, rangeRect.bottom - editorRect.top + 4)
            : 28;

    return {
        query,
        textNode,
        atOffset: idx,
        cursorOffset: startOffset,
        anchorRect: { top: relTop, left: relLeft, height: rangeRect?.height || 20 },
    };
}

// Inserts a mention chip into the editor, replacing the `@query` run.
// Bulletproof: handles valid detected ranges, detached DOM fallback search,
// focus recovery, and caret positioning.
function insertMentionCandidate(
    editor: HTMLElement,
    candidate: MentionCandidate,
    state: MentionDetectState | null,
    onDraftChange?: (raw: string) => void,
    setIsEmpty?: (empty: boolean) => void,
) {
    const displayName =
        sanitizeMentionDisplayName(
            candidate.fullName || candidate.username || "user",
        ) || "user";

    const chip = document.createElement("span");
    chip.dataset.mentionId = candidate.id;
    chip.dataset.mentionName = displayName;
    chip.setAttribute("contenteditable", "false");
    chip.className =
        "inline-flex items-center gap-1 rounded-[3px] bg-primary/10 pl-1.5 pr-1 py-px text-[13px] font-medium text-primary align-baseline select-none";

    const label = document.createElement("span");
    label.textContent = `@${displayName}`;
    chip.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove @${displayName}`);
    removeBtn.className =
        "inline-flex size-3.5 items-center justify-center rounded-[2px] text-primary/70 hover:bg-primary/20 hover:text-destructive transition-colors text-[11px] leading-none cursor-pointer";
    removeBtn.innerHTML = "&times;";

    removeBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = chip.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && (next.textContent === "\u00A0" || next.textContent === " ")) {
            next.parentNode?.removeChild(next);
        }
        chip.parentNode?.removeChild(chip);
        editor.focus();
        const raw = serializeEditor(editor);
        setIsEmpty?.(raw.length === 0);
        onDraftChange?.(raw);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    chip.appendChild(removeBtn);

    const spacer = document.createTextNode("\u00A0");

    let afterNode: Node | null = null;

    // Primary: use the detected state if its text node is still valid in this editor
    if (
        state?.textNode &&
        state.textNode.parentNode &&
        findAncestorEditor(state.textNode, editor)
    ) {
        const original = state.textNode;
        const fullText = original.textContent ?? "";
        const atOffset = Math.min(state.atOffset, fullText.length);
        const cursorOffset = Math.min(Math.max(atOffset, state.cursorOffset), fullText.length);

        const before = fullText.slice(0, atOffset);
        const after = fullText.slice(cursorOffset);
        const parent = original.parentNode;

        if (parent) {
            const beforeNode = document.createTextNode(before);
            const trailingNode = document.createTextNode(after);

            parent.insertBefore(beforeNode, original);
            parent.insertBefore(chip, original);
            parent.insertBefore(spacer, original);
            parent.insertBefore(trailingNode, original);
            parent.removeChild(original);

            afterNode = trailingNode;
        }
    }

    // Fallback: search editor text nodes for the trailing `@` or `@query` run
    if (!afterNode) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let targetTextNode: Text | null = null;
        let atIndex = -1;
        let currentNode: Node | null = walker.nextNode();

        while (currentNode) {
            const text = currentNode.textContent ?? "";
            const lastAt = text.lastIndexOf("@");
            if (lastAt !== -1) {
                targetTextNode = currentNode as Text;
                atIndex = lastAt;
            }
            currentNode = walker.nextNode();
        }

        if (targetTextNode && targetTextNode.parentNode) {
            const fullText = targetTextNode.textContent ?? "";
            const before = fullText.slice(0, atIndex);
            // Slice after query word (non-whitespace run after @)
            const spaceIdx = fullText.indexOf(" ", atIndex);
            const after = spaceIdx !== -1 ? fullText.slice(spaceIdx) : "";

            const parent = targetTextNode.parentNode;
            const beforeNode = document.createTextNode(before);
            const trailingNode = document.createTextNode(after);

            parent.insertBefore(beforeNode, targetTextNode);
            parent.insertBefore(chip, targetTextNode);
            parent.insertBefore(spacer, targetTextNode);
            parent.insertBefore(trailingNode, targetTextNode);
            parent.removeChild(targetTextNode);

            afterNode = trailingNode;
        } else {
            // Last resort: append to end of editor
            editor.appendChild(chip);
            editor.appendChild(spacer);
            const trailingNode = document.createTextNode("");
            editor.appendChild(trailingNode);
            afterNode = trailingNode;
        }
    }

    // Ensure editor has active DOM focus
    editor.focus();

    // Position caret immediately after the spacer
    if (afterNode) {
        const newRange = document.createRange();
        newRange.setStart(afterNode, 0);
        newRange.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(newRange);
    }

    // Ensure draft state updates immediately in parents
    const raw = serializeEditor(editor);
    setIsEmpty?.(raw.length === 0);
    onDraftChange?.(raw);

    // Fire synthetic input event so draft serializers and parent observers sync
    editor.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 0; // show the full roster on bare `@`
const QUERY_DEBOUNCE_MS = 140;
const MAX_RESULTS = 10;

export const MentionComposer = React.forwardRef<MentionComposerHandle, MentionComposerProps>(
    function MentionComposer(
        {
            projectId,
            placeholder,
            disabled,
            autoFocus,
            resetKey,
            onDraftChange,
            onSubmit,
            className,
            editorClassName,
            ...rest
        }: MentionComposerProps,
        forwardedRef,
    ) {
    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const [isEmpty, setIsEmpty] = React.useState(true);

    // Autocomplete state kept here (parent does not need to know). We snapshot
    // the detection state in a ref so the selection handler can reuse it even
    // if the user moves the caret between render commits.
    const [menuState, setMenuState] = React.useState<MentionDetectState | null>(null);
    const menuStateRef = React.useRef<MentionDetectState | null>(null);
    const [candidates, setCandidates] = React.useState<MentionCandidate[]>([]);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const blurTimeoutRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        return () => {
            if (blurTimeoutRef.current !== null) window.clearTimeout(blurTimeoutRef.current);
        };
    }, []);

    // Keep the ref in sync so event handlers reading the "live" menu state
    // never race with stale React state.
    React.useEffect(() => {
        menuStateRef.current = menuState;
    }, [menuState]);

    // Reset the editor when `resetKey` bumps.
    React.useEffect(() => {
        if (resetKey === undefined) return;
        const editor = editorRef.current;
        if (!editor) return;
        clearEditor(editor);
        setIsEmpty(true);
        setMenuState(null);
        setCandidates([]);
        setActiveIndex(0);
    }, [resetKey]);

    React.useEffect(() => {
        if (!autoFocus) return;
        editorRef.current?.focus();
    }, [autoFocus]);

    // ---------------------------------------------------------------------
    // Candidate fetching (debounced)
    // ---------------------------------------------------------------------
    React.useEffect(() => {
        if (!menuState) {
            setCandidates([]);
            setLoading(false);
            setError(null);
            return;
        }
        const query = menuState.query;
        if (query.length < MIN_QUERY_LENGTH) {
            setCandidates([]);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        const handle = window.setTimeout(async () => {
            try {
                const url = new URL(
                    `/api/v1/projects/${projectId}/members`,
                    window.location.origin,
                );
                if (query) url.searchParams.set("q", query);
                url.searchParams.set("eligibility", "mention");
                const response = await fetch(url.toString(), {
                    method: "GET",
                    credentials: "same-origin",
                });
                if (!response.ok) {
                    throw new Error(`Lookup failed (${response.status})`);
                }
                const payload = (await response.json()) as {
                    success?: boolean;
                    data?: { members?: FetchedMember[] };
                };
                if (cancelled) return;
                if (!payload.success) {
                    setCandidates([]);
                    setError("Could not load teammates.");
                    return;
                }
                const members = (payload.data?.members ?? []).slice(0, MAX_RESULTS);
                setCandidates(members);
                setActiveIndex(0);
            } catch (err) {
                if (cancelled) return;
                setCandidates([]);
                setError(err instanceof Error ? err.message : "Lookup failed");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, QUERY_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [menuState, projectId]);

    // ---------------------------------------------------------------------
    // Input handling
    // ---------------------------------------------------------------------
    const lastMentionStateRef = React.useRef<MentionDetectState | null>(null);

    const handleInput = React.useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const raw = serializeEditor(editor);
        setIsEmpty(raw.length === 0);
        onDraftChange?.(raw);

        const detected = detectMentionState(editor);
        setMenuState(detected);
        if (detected) {
            lastMentionStateRef.current = detected;
        }
    }, [onDraftChange]);

    const closeMenu = React.useCallback(() => {
        if (blurTimeoutRef.current !== null) {
            window.clearTimeout(blurTimeoutRef.current);
            blurTimeoutRef.current = null;
        }
        setMenuState(null);
        lastMentionStateRef.current = null;
        setCandidates([]);
        setActiveIndex(0);
    }, []);

    const selectCandidate = React.useCallback(
        (candidate: MentionCandidate) => {
            if (blurTimeoutRef.current !== null) {
                window.clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
            }
            const editor = editorRef.current;
            if (!editor) return;
            const state = menuStateRef.current || lastMentionStateRef.current || detectMentionState(editor);
            insertMentionCandidate(editor, candidate, state, onDraftChange, setIsEmpty);
            closeMenu();
        },
        [closeMenu, onDraftChange],
    );

    React.useImperativeHandle(
        forwardedRef,
        () => ({
            focus: () => {
                editorRef.current?.focus();
            },
            triggerMention: () => {
                if (blurTimeoutRef.current !== null) {
                    window.clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = null;
                }
                const editor = editorRef.current;
                if (!editor) return;
                editor.focus();
                const sel = window.getSelection();
                let range: Range;
                if (
                    sel &&
                    sel.rangeCount > 0 &&
                    findAncestorEditor(sel.getRangeAt(0).startContainer, editor)
                ) {
                    range = sel.getRangeAt(0);
                    range.deleteContents();
                } else {
                    range = document.createRange();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                }
                const textNode = document.createTextNode("@");
                range.insertNode(textNode);
                const newRange = document.createRange();
                newRange.setStart(textNode, 1);
                newRange.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(newRange);
                handleInput();
            },
        }),
        [handleInput],
    );

    // ---------------------------------------------------------------------
    // Keyboard handling
    // ---------------------------------------------------------------------
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (menuState && candidates.length > 0) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                    candidates.length === 0 ? 0 : (current + 1) % candidates.length,
                );
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) =>
                    candidates.length === 0
                        ? 0
                        : (current - 1 + candidates.length) % candidates.length,
                );
                return;
            }
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                const selected = candidates[activeIndex];
                if (selected) selectCandidate(selected);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
                return;
            }
            if (event.key === "Tab") {
                event.preventDefault();
                const selected = candidates[activeIndex];
                if (selected) selectCandidate(selected);
                return;
            }
        }

        // Backspace / Delete handling for mention chips
        if (event.key === "Backspace" || event.key === "Delete") {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (range.collapsed) {
                    const { startContainer, startOffset } = range;
                    let chipToDelete: HTMLElement | null = null;
                    let spacerToDelete: Node | null = null;

                    if (event.key === "Backspace") {
                        if (startContainer.nodeType === Node.TEXT_NODE) {
                            const textNode = startContainer as Text;
                            if (
                                startOffset === 0 ||
                                (startOffset === 1 && (textNode.textContent === "\u00A0" || textNode.textContent === " "))
                            ) {
                                let prev = textNode.previousSibling;
                                if (
                                    prev &&
                                    prev.nodeType === Node.TEXT_NODE &&
                                    (prev.textContent === "\u00A0" || prev.textContent === " " || !prev.textContent)
                                ) {
                                    spacerToDelete = prev;
                                    prev = prev.previousSibling;
                                }
                                if (
                                    prev &&
                                    prev.nodeType === Node.ELEMENT_NODE &&
                                    (prev as HTMLElement).dataset?.mentionId
                                ) {
                                    chipToDelete = prev as HTMLElement;
                                }
                            }
                        } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
                            const parent = startContainer as HTMLElement;
                            if (startOffset > 0) {
                                let prev = parent.childNodes[startOffset - 1];
                                if (
                                    prev &&
                                    prev.nodeType === Node.TEXT_NODE &&
                                    (prev.textContent === "\u00A0" || prev.textContent === " " || !prev.textContent)
                                ) {
                                    spacerToDelete = prev;
                                    if (startOffset > 1) {
                                        prev = parent.childNodes[startOffset - 2];
                                    }
                                }
                                if (
                                    prev &&
                                    prev.nodeType === Node.ELEMENT_NODE &&
                                    (prev as HTMLElement).dataset?.mentionId
                                ) {
                                    chipToDelete = prev as HTMLElement;
                                }
                            }
                        }
                    } else if (event.key === "Delete") {
                        if (startContainer.nodeType === Node.TEXT_NODE) {
                            const textNode = startContainer as Text;
                            if (startOffset === (textNode.textContent?.length || 0)) {
                                const next = textNode.nextSibling;
                                if (
                                    next &&
                                    next.nodeType === Node.ELEMENT_NODE &&
                                    (next as HTMLElement).dataset?.mentionId
                                ) {
                                    chipToDelete = next as HTMLElement;
                                }
                            }
                        } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
                            const parent = startContainer as HTMLElement;
                            const next = parent.childNodes[startOffset];
                            if (
                                next &&
                                next.nodeType === Node.ELEMENT_NODE &&
                                (next as HTMLElement).dataset?.mentionId
                            ) {
                                chipToDelete = next as HTMLElement;
                            }
                        }
                    }

                    if (chipToDelete) {
                        event.preventDefault();
                        if (spacerToDelete && spacerToDelete.parentNode) {
                            spacerToDelete.parentNode.removeChild(spacerToDelete);
                        }
                        const next = chipToDelete.nextSibling;
                        if (
                            next &&
                            next.nodeType === Node.TEXT_NODE &&
                            (next.textContent === "\u00A0" || next.textContent === " ")
                        ) {
                            next.parentNode?.removeChild(next);
                        }
                        chipToDelete.parentNode?.removeChild(chipToDelete);

                        const editor = editorRef.current;
                        if (editor) {
                            const raw = serializeEditor(editor);
                            setIsEmpty(raw.length === 0);
                            onDraftChange?.(raw);
                            editor.dispatchEvent(new Event("input", { bubbles: true }));
                        }
                        return;
                    }
                }
            }
        }

        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit?.();
            return;
        }
    };

    // Chromium sometimes places the caret inside a chip when the user presses
    // backspace adjacent to one. We catch the case and delete the whole chip,
    // matching Slack / Linear behaviour.
    const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
        const inputEvent = event as unknown as InputEvent;
        if (inputEvent.inputType !== "deleteContentBackward") return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const { startContainer, startOffset } = range;
        const editor = editorRef.current;
        if (!editor) return;

        // Case A: caret is right after a chip (previous sibling is a chip span).
        if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
            const textNode = startContainer as Text;
            const prev = textNode.previousSibling;
            if (
                prev &&
                prev.nodeType === Node.ELEMENT_NODE &&
                (prev as HTMLElement).dataset.mentionId
            ) {
                event.preventDefault();
                prev.parentNode?.removeChild(prev);
                editor.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }
        }
    };

    return (
        <div className={cn("relative", className)} data-testid="mention-composer">
            <div
                ref={editorRef}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={Boolean(menuState && candidates.length > 0)}
                aria-controls={menuState && candidates.length > 0 ? "mention-autocomplete-listbox" : undefined}
                aria-activedescendant={
                    menuState && candidates[activeIndex]
                        ? `mention-option-${candidates[activeIndex].id}`
                        : undefined
                }
                aria-multiline="true"
                aria-label={rest["aria-label"] ?? placeholder}
                aria-disabled={disabled}
                contentEditable={!disabled}
                suppressContentEditableWarning
                data-empty={isEmpty ? "true" : undefined}
                data-testid="mention-composer-editor"
                onInput={handleInput}
                onBeforeInput={handleBeforeInput}
                onKeyDown={handleKeyDown}
                onPaste={(event) => {
                    // Plain text only: rich paste could carry remote images or forged mention chips.
                    event.preventDefault();
                    const text = event.clipboardData.getData("text/plain");
                    if (text) document.execCommand("insertText", false, text);
                }}
                onDrop={(event) => event.preventDefault()}
                onBlur={() => {
                    // Delay close so pointer-down inside the menu lands first.
                    if (blurTimeoutRef.current !== null) window.clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = window.setTimeout(() => {
                        setMenuState((current) =>
                            current && menuStateRef.current === current ? null : current,
                        );
                    }, 250);
                }}
                className={cn(
                    "mention-composer min-h-[96px] w-full resize-none rounded-[5px] border border-border bg-card px-3 py-3 text-[13px] leading-6 text-foreground outline-none transition focus:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60",
                    "whitespace-pre-wrap break-words",
                    disabled && "pointer-events-none opacity-60",
                    editorClassName,
                )}
                data-placeholder={placeholder}
            />

            <style jsx>{`
                .mention-composer:empty::before,
                .mention-composer[data-empty="true"]::before {
                    content: attr(data-placeholder);
                    color: var(--muted-foreground);
                    pointer-events: none;
                }
            `}</style>

            <MentionAutocomplete
                anchorRect={menuState ? menuState.anchorRect : null}
                query={menuState?.query ?? ""}
                candidates={candidates}
                activeIndex={activeIndex}
                loading={loading}
                error={error}
                onSelect={selectCandidate}
                onHoverIndex={(index) => setActiveIndex(index)}
            />
        </div>
    );
});

export default MentionComposer;

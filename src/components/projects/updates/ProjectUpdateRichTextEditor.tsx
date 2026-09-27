"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ListTodo, Paperclip, Timer } from "lucide-react";

import type { ProjectUpdateContextKind } from "@/lib/projects/updates";

export interface ProjectUpdateEditorRef {
    insertTextAtCursor: (text: string) => void;
}

const ReferenceLinkBackspaceExtension = Extension.create({
    name: "referenceLinkBackspace",

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey("referenceLinkBackspace"),
                props: {
                    handleKeyDown(view, event) {
                        if (event.key !== "Backspace" && event.key !== "Delete") {
                            return false;
                        }

                        const { state, dispatch } = view;
                        const { selection } = state;
                        if (!selection.empty) {
                            return false;
                        }

                        const pos = selection.from;
                        const isBackspace = event.key === "Backspace";
                        const referenceRanges: Array<{ from: number; to: number; href: string }> = [];

                        state.doc.descendants((node, nodePos) => {
                            if (!node.isText) return true;
                            const linkMark = node.marks.find((mark) => mark.type.name === "link");
                            const href = linkMark?.attrs.href;
                            if (typeof href !== "string" || !href.includes("__readme-ref")) {
                                return true;
                            }

                            referenceRanges.push({
                                from: nodePos,
                                to: nodePos + node.nodeSize,
                                href,
                            });
                            return true;
                        });

                        const targetIndex = referenceRanges.findIndex((range) =>
                            isBackspace
                                ? pos > range.from && pos <= range.to
                                : pos >= range.from && pos < range.to
                        );
                        if (targetIndex === -1) return false;

                        const target = referenceRanges[targetIndex];
                        if (!target) return false;
                        let from = target.from;
                        let to = target.to;

                        for (let index = targetIndex - 1; index >= 0; index -= 1) {
                            const range = referenceRanges[index];
                            if (!range || range.href !== target.href || range.to !== from) break;
                            from = range.from;
                        }

                        for (let index = targetIndex + 1; index < referenceRanges.length; index += 1) {
                            const range = referenceRanges[index];
                            if (!range || range.href !== target.href || range.from !== to) break;
                            to = range.to;
                        }

                        if (from >= to) return false;
                        dispatch(state.tr.delete(from, to).scrollIntoView());
                        return true;
                    }
                }
            })
        ];
    }
});

// Transforms raw references like {% ref.files id="some-id" label="some-label" %}
// to Markdown links like [some-label](/__readme-ref/files/some-id)
export function transformIncomingContent(content: string): string {
    if (!content) return "";
    return content.replace(/\{%\s*ref\.([a-z_]+)\s+id="([^"]+)"(?:\s+label="([^"]*)")?\s*%\}/gi, (match, kind, id, label) => {
        const unescaped = (label || "").replace(/&quot;/g, '"').replace(/\\\\/g, "\\").trim();
        const singular = kind.endsWith("s") ? kind.slice(0, -1) : kind;
        const cleanLabel = unescaped || `${singular || "project"} reference`;
        return `[${cleanLabel}](/__readme-ref/${kind}/${id})`;
    });
}

// Transforms Markdown links like [some-label](/__readme-ref/files/some-id)
// back to raw references like {% ref.files id="some-id" label="some-label" %}
export function transformOutgoingContent(content: string): string {
    if (!content) return "";
    return content.replace(/\[([^\]]+)\]\(\/__readme-ref\/([a-z_]+)\/([^)]+)\)/gi, (match, label, kind, id) => {
        const escaped = label.replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();
        return `{% ref.${kind} id="${id}" label="${escaped}" %}`;
    });
}

export function ProjectUpdateRichTextEditor({
    content,
    placeholder,
    onChange,
    onCommand,
    onMention,
    editorRef,
}: {
    content: string;
    placeholder: string;
    onChange: (value: string) => void;
    onCommand: (kind: ProjectUpdateContextKind) => void;
    onMention?: () => void;
    editorRef?: React.MutableRefObject<ProjectUpdateEditorRef | null>;
}) {
    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashMenuCoords, setSlashMenuCoords] = useState<{ top: number; left: number } | null>(null);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                horizontalRule: false,
                link: false,
            }),
            Markdown,
            Link.extend({
                inclusive: false,
            }).configure({
                openOnClick: false,
                autolink: false,
                HTMLAttributes: {
                    class: "text-primary font-semibold no-underline hover:underline cursor-pointer",
                },
            }),
            ReferenceLinkBackspaceExtension,
        ],
        content: transformIncomingContent(content),
        onUpdate: ({ editor }) => {
            const nextContent = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText();
            onChange(transformOutgoingContent(nextContent));

            const { state, view } = editor;
            const { selection } = state;
            const { $head } = selection;
            const textBefore = $head.parent.textBetween(0, $head.parentOffset, undefined, "\ufffc");

            if (textBefore.endsWith("/")) {
                const coords = view.coordsAtPos(selection.from);
                const editorRect = editorRootRef.current?.getBoundingClientRect();
                if (coords && editorRect) {
                    setSlashMenuCoords({
                        top: coords.bottom - editorRect.top + 8,
                        left: coords.left - editorRect.left,
                    });
                    setSlashMenuOpen(true);
                }
            } else if (textBefore.endsWith("@")) {
                setSlashMenuOpen(false);
                if (onMention) {
                    editor.commands.deleteRange({ from: selection.from - 1, to: selection.from });
                    onMention();
                }
            } else {
                setSlashMenuOpen(false);
            }
        },
        editorProps: {
            attributes: {
                class: "prose max-w-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 min-h-24 text-[15px] leading-[1.6] text-foreground",
            },
        },
    });

    useEffect(() => {
        if (editorRef) {
            editorRef.current = {
                insertTextAtCursor: (text: string) => {
                    if (editor) {
                        const transformedText = transformIncomingContent(text);
                        editor.commands.insertContent(transformedText);
                        editor.commands.focus();
                    }
                }
            };
        }
        return () => {
            if (editorRef) editorRef.current = null;
        };
    }, [editor, editorRef]);

    useEffect(() => {
        if (!editor) return;
        const currentMarkdown = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText();
        const currentRaw = transformOutgoingContent(currentMarkdown);
        if (currentRaw !== content) {
            editor.commands.setContent(transformIncomingContent(content));
        }
    }, [content, editor]);

    useEffect(() => {
        if (!editor) return;
        requestAnimationFrame(() => editor.commands.focus("end"));
    }, [editor]);

    const runCommand = (kind: ProjectUpdateContextKind) => {
        if (editor) {
            const from = Math.max(1, editor.state.selection.from - 1);
            editor.commands.deleteRange({ from, to: editor.state.selection.from });
        }
        setSlashMenuOpen(false);
        onCommand(kind);
    };

    return (
        <div
            ref={editorRootRef}
            className="relative cursor-text"
            onClick={() => editor?.commands.focus()}
        >
            {editor ? <EditorContent editor={editor} /> : null}
            {!editor?.getText() ? (
                <div className="pointer-events-none absolute left-0 top-0 text-[15px] leading-[1.6] text-muted-foreground">
                    {placeholder}
                </div>
            ) : null}

            {slashMenuOpen && slashMenuCoords ? (
                <div
                    className="absolute z-10 w-48 overflow-hidden rounded-[5px] border border-border bg-popover text-popover-foreground shadow-md"
                    style={{ top: slashMenuCoords.top, left: Math.min(slashMenuCoords.left, 500) }}
                >
                    <div className="border-b border-border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Add Context</div>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
                        onClick={(event) => {
                            event.stopPropagation();
                            runCommand("task");
                        }}
                    >
                        <ListTodo className="h-4 w-4 text-muted-foreground" /> Link Task
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
                        onClick={(event) => {
                            event.stopPropagation();
                            runCommand("sprint");
                        }}
                    >
                        <Timer className="h-4 w-4 text-muted-foreground" /> Link Sprint
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
                        onClick={(event) => {
                            event.stopPropagation();
                            runCommand("file");
                        }}
                    >
                        <Paperclip className="h-4 w-4 text-muted-foreground" /> Link File
                    </button>
                </div>
            ) : null}
        </div>
    );
}

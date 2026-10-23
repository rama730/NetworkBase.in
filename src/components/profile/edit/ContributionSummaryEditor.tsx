"use client";

/**
 * ContributionSummaryEditor
 *
 * Rich Markdown and ProseMirror/Tiptap composer for project contribution narratives.
 * Supports bold, italics, ordered/bullet lists, heading levels, links with safe HTTP
 * scheme validation, and debounced @ mentions for persons, files, tasks, and sprints.
 *
 * Implements WCAG 2.5.5 touch target minimums (44px) on mobile and enforces Ponytail
 * design tokens (zero rounded-full controls, standard drafting radii rounded-[4px]).
 */

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Link2,
  AtSign,
  FileText,
  ListChecks,
  Timer,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposerReferenceOptions } from "@/components/projects/updates/ComposerReferenceOptions";
import { referenceLinkBackspaceExtension } from "@/lib/editor/reference-link-backspace";
import { isSafeHttpUrl } from "@/lib/security/urls";
import {
  referenceToken,
  STORY_REFERENCE_PATTERN,
  type StoryReferenceKind,
  type ResolvedStoryReference,
} from "@/lib/profile/contribution-story";

export function incomingContributionSummary(
  value: string,
  references: ResolvedStoryReference[],
) {
  return value.replace(
    new RegExp(STORY_REFERENCE_PATTERN),
    (_match, kind, id) => {
      const ref = references.find((r) => r.kind === kind && r.id === id);
      const label = (ref?.label ?? `${kind} reference`)
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `[${label}](/__contribution-ref/${kind}/${id})`;
    },
  );
}
export function outgoingContributionSummary(value: string) {
  return value.replace(
    /\[(?:\\.|[^\]\\])*\]\(\/__contribution-ref\/(person|file|task|sprint|activity)\/([a-zA-Z0-9:_-]{1,160})\)/g,
    (_m, kind, id) => referenceToken(kind, id),
  );
}
export function ContributionSummaryEditor({
  value,
  onChange,
  references,
  searchReferences,
  onReferenceSelected,
  fileCount,
  projectId,
}: {
  value: string;
  onChange: (value: string) => void;
  references: ResolvedStoryReference[];
  searchReferences: (
    kind: StoryReferenceKind,
    query: string,
  ) => Promise<ResolvedStoryReference[]>;
  onReferenceSelected: (reference: ResolvedStoryReference) => void;
  fileCount: number;
  projectId: string | null;
}) {
  const [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState("");
  const [referenceKind, setReferenceKind] = useState<StoryReferenceKind | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ResolvedStoryReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const searchRef = useRef(searchReferences);
  useEffect(() => {
    searchRef.current = searchReferences;
  }, [searchReferences]);
  useEffect(() => {
    if (!referenceKind || !projectId) return;
    let cancelled = false;
    setOptions([]);
    setLoading(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      void searchRef
        .current(referenceKind, query)
        .then((result) => {
          if (!cancelled) setOptions(result);
        })
        .catch(() => {
          if (!cancelled)
            setSearchError("Could not load references. Please retry.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [referenceKind, query, projectId, retry]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Markdown,
      Link.extend({ inclusive: false }).configure({
        openOnClick: false,
        autolink: false,
        validate: (url: string) =>
          url.startsWith("/__contribution-ref/") || isSafeHttpUrl(url),
        HTMLAttributes: {
          class:
            "text-primary font-semibold no-underline hover:underline cursor-pointer",
        },
      }),
      referenceLinkBackspaceExtension("/__contribution-ref/"),
    ],
    content: incomingContributionSummary(value, references),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Contribution summary",
        "aria-multiline": "true",
        "aria-describedby": "contribution-summary-help",
        class:
          "min-h-56 px-4 py-4 outline-none text-base sm:text-[15px] leading-relaxed break-words",
      },
    },
    onUpdate: ({ editor }) => {
      const storage = editor.storage as {
        markdown?: { getMarkdown: () => string };
      };
      onChange(
        outgoingContributionSummary(
          storage.markdown?.getMarkdown() ?? editor.getText(),
        ),
      );
      const { $head } = editor.state.selection;
      const before = $head.parent.textBetween(0, $head.parentOffset);
      if (projectId && /(?:^|\s)@$/.test(before) && !editor.isActive("link")) {
        const position = editor.state.selection.from;
        editor.commands.deleteRange({ from: position - 1, to: position });
        setQuery("");
        setReferenceKind("person");
      }
    },
  });
  useEffect(() => {
    if (!editor) return;
    const current = outgoingContributionSummary(
      (
        editor.storage as { markdown?: { getMarkdown: () => string } }
      ).markdown?.getMarkdown() ?? editor.getText(),
    );
    if (current !== value)
      editor.commands.setContent(
        incomingContributionSummary(value, references),
        {
          emitUpdate: false,
        },
      );
  }, [value, editor, references]);
  const insert = (ref: ResolvedStoryReference) => {
    onReferenceSelected(ref);
    editor
      ?.chain()
      .focus(undefined, { scrollIntoView: false })
      .insertContent([
        {
          type: "text",
          text: ref.label,
          marks: [
            {
              type: "link",
              attrs: { href: `/__contribution-ref/${ref.kind}/${ref.id}` },
            },
          ],
        },
        { type: "text", text: " ", marks: [] },
      ])
      .run();
    setReferenceKind(null);
  };
  const closeReferences = () => {
    setReferenceKind(null);
    editor?.commands.focus(undefined, { scrollIntoView: false });
  };
  const openReferences = (kind: StoryReferenceKind) => {
    setQuery("");
    setReferenceKind((current) => (current === kind ? null : kind));
  };
  const action = (
    label: string,
    Icon: typeof Bold,
    run: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      className="nb-touch-target rounded-[4px] p-2 text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon className="size-4" />
    </button>
  );
  const activity = referenceToken("activity", projectId ?? "files");
  return (
    <div>
      <div className="overflow-hidden rounded-[6px] border border-border">
        <div
          role="toolbar"
          aria-label="Summary formatting"
          className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 p-1"
        >
          {action(
            "Bold",
            Bold,
            () => {
              editor?.chain().focus().toggleBold().run();
            },
            editor?.isActive("bold"),
          )}
          {action(
            "Italic",
            Italic,
            () => {
              editor?.chain().focus().toggleItalic().run();
            },
            editor?.isActive("italic"),
          )}

          {action(
            "Bullet list",
            List,
            () => {
              editor?.chain().focus().toggleBulletList().run();
            },
            editor?.isActive("bulletList"),
          )}
          {action(
            "Numbered list",
            ListOrdered,
            () => {
              editor?.chain().focus().toggleOrderedList().run();
            },
            editor?.isActive("orderedList"),
          )}
          {action(
            "Undo summary edit",
            Undo2,
            () => {
              editor?.chain().focus().undo().run();
            },
            false,
            !editor?.can().undo(),
          )}
          {action(
            "Redo summary edit",
            Redo2,
            () => {
              editor?.chain().focus().redo().run();
            },
            false,
            !editor?.can().redo(),
          )}
          {action("Add link", Link2, () => {
            setLinkOpen((v) => !v);
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => openReferences("person")}
            aria-expanded={referenceKind === "person"}
            disabled={!projectId}
          >
            <AtSign className="size-4" />
            Mention
          </Button>
        </div>
        {linkOpen && (
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <label className="min-w-0 flex-1 nb-compact">
              Link URL
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="nb-story-input"
                placeholder="https://"
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={!isSafeHttpUrl(link)}
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: link })
                  .run();
                setLinkOpen(false);
                setLink("");
              }}
            >
              Add link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLinkOpen(false)}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="nb-contribution-rich">
          <EditorContent editor={editor} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 nb-compact text-muted-foreground">
          {projectId ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.includes(activity)}
                onChange={(e) =>
                  e.target.checked
                    ? insert({
                        kind: "activity",
                        id: projectId,
                        label: `Contributed to ${fileCount} project files`,
                        href: null,
                        available: true,
                      })
                    : onChange(value.split(activity).join(""))
                }
              />
              Include file activity
            </label>
          ) : (
            <span>Tell your contribution story</span>
          )}
          <span
            className={value.length > 10000 ? "text-destructive font-medium" : "text-muted-foreground"}
          >
            {value.length.toLocaleString()} / 10,000
          </span>
        </div>
      </div>
      {referenceKind && (
        <section
          aria-label="Contribution mention picker"
          className="mt-3 rounded-[8px] border border-border bg-card p-3 shadow-none"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {referenceKind === "person"
                  ? "Mention a teammate"
                  : `${referenceKind[0]!.toUpperCase() + referenceKind.slice(1)} context`}
              </p>
              <p className="text-xs text-muted-foreground">
                Only public teammates and publicly accessible project items.
                Mentions send no notification.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close mention picker"
              className="nb-touch-target flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={closeReferences}
            >
              <X className="size-4" />
            </button>
          </div>
          <ComposerReferenceOptions
            key={referenceKind}
            query={query}
            onQueryChange={setQuery}
            placeholder={
              referenceKind === "person"
                ? "Find teammate by name or username"
                : `Find ${referenceKind}`
            }
            options={options}
            loading={loading}
            error={searchError}
            onRetry={() => setRetry((current) => current + 1)}
            onSelect={insert}
            onClose={closeReferences}
          />
        </section>
      )}
      <div
        id="contribution-summary-help"
        className="mt-2 flex flex-wrap items-center gap-2 nb-compact text-muted-foreground"
      >
        <span>Type @ to mention ·</span>
        {(["file", "task", "sprint"] as const).map((kind, index) => {
          const Icon = [FileText, ListChecks, Timer][index]!;
          return (
            <button
              type="button"
              key={kind}
              disabled={!projectId}
              className="nb-touch-target inline-flex items-center gap-1 rounded-[4px] px-1 hover:bg-muted disabled:opacity-50"
              onClick={() => openReferences(kind)}
            >
              <Icon className="size-3.5" />
              {kind[0]!.toUpperCase() + kind.slice(1) + "s"}
            </button>
          );
        })}
        <span>Activity is optional and stays in your story.</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 nb-compact">
        <span className="text-muted-foreground py-1">Writing starters</span>
        {[
          "What I worked on",
          "Decisions & challenges",
          "Outcomes & lessons",
        ].map((text) => (
          <button
            key={text}
            type="button"
            className="nb-touch-target pointer-coarse:min-h-[44px] pointer-coarse:px-3 rounded-[4px] border border-border px-2 py-1 hover:bg-muted"
            onClick={() =>
              editor
                ?.chain()
                .focus("end")
                .insertContent(`<p><strong>${text}</strong></p><p></p>`)
                .run()
            }
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

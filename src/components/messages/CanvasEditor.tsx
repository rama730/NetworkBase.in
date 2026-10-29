"use client";

import { useEffect, useRef, useState } from "react";
import { Node as TiptapNode, mergeAttributes, type Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import {
  Code, Copy, Download, ExternalLink, GripVertical, Heading1, Heading2, Heading3, List, ListChecks, ListOrdered, Quote, Trash2, Type, CopyPlus,
} from "lucide-react";
import { toast } from "@/lib/feedback";

import { uploadChatFile } from "@/components/messages/upload";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { normalizeSafeExternalUrl, sameOriginPath } from "@/lib/messaging/safe-links";
import { canvasAssetId, canvasAssetUrl } from "@/lib/messaging/canvas-store";
import { copyWithToast } from "@/lib/clipboard";

type ImageSize = "s" | "m" | "full";

// ponytail: the image size rides in the markdown image title (`![a](src "m")`),
// so tiptap-markdown's stock image serializer round-trips it with no custom code.
const CanvasImage = TiptapNode.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: "full" },
      uploading: { default: false, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.src ?? "");
    const origin = typeof window === "undefined" ? "https://networkbase.in" : window.location.origin;
    const local = node.attrs.uploading && source.startsWith("blob:");
    const src = local ? source : canvasAssetId(source, origin) ? source : normalizeSafeExternalUrl(source);
    if (!src) return ["span", {}, String(node.attrs.alt ?? "Image unavailable")];
    return ["img", mergeAttributes(HTMLAttributes, {
      src,
      class: "nb-canvas-img",
      "data-size": node.attrs.title,
      "data-uploading": node.attrs.uploading ? "true" : undefined,
      loading: "lazy",
    })];
  },
});

/** Markdown for saving: uploads still in flight (blob: URLs) are left out. */
export function canvasMarkdown(editor: Editor) {
  const markdown = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText();
  return markdown.replace(/!\[[^\]]*\]\(blob:[^)]*\)\n*/g, "");
}

export function useCanvasEditor(options: { content: string; editable?: boolean; onChange?: (markdown: string) => void }) {
  const onChange = useRef(options.onChange);
  useEffect(() => {
    onChange.current = options.onChange;
  });
  return useEditor({
    immediatelyRender: false,
    editable: options.editable ?? true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, isAllowedUri: (url) => Boolean(sameOriginPath(url, typeof window === "undefined" ? "https://networkbase.in" : window.location.origin) || normalizeSafeExternalUrl(url)), HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
        dropcursor: { class: "nb-canvas-dropcursor", width: 2 },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CanvasImage,
      Placeholder.configure({ placeholder: "Words go here" }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ],
    content: options.content,
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta("canvas-remote")) return;
      onChange.current?.(canvasMarkdown(editor));
    },
    editorProps: { attributes: { class: "nb-canvas outline-none", "aria-label": "Channel notes" } },
  });
}

/** Replace the document without echoing a save (server content, templates handle their own save). */
export function setCanvasContent(editor: Editor, markdown: string, emit = false) {
  editor.chain().command(({ tr }) => {
    if (!emit) tr.setMeta("canvas-remote", true);
    return true;
  }).setContent(markdown, { emitUpdate: true }).run();
}

/** Upload images and drop them in at `pos`; each shows from a local preview until it is stored. */
export function insertCanvasImages(editor: Editor, channelId: string, files: File[], pos?: number) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  for (const file of images) {
    const preview = URL.createObjectURL(file);
    const at = pos ?? editor.state.selection.to;
    editor.chain().focus().insertContentAt(at, { type: "image", attrs: { src: preview, alt: file.name, title: "full", uploading: true } }).run();
    const patch = (attrs: Record<string, unknown> | null) => {
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name !== "image" || node.attrs.src !== preview) return true;
        const tr = attrs ? editor.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, ...attrs }) : editor.state.tr.delete(nodePos, nodePos + node.nodeSize);
        editor.view.dispatch(tr);
        return false;
      });
      URL.revokeObjectURL(preview);
    };
    uploadChatFile(channelId, file)
      .then((assetId) => patch({ src: canvasAssetUrl(assetId), uploading: false }))
      .catch(() => {
        patch(null);
        toast.warning(`${file.name} couldn’t upload.`);
      });
  }
  return images.length > 0;
}

type Block = { pos: number; top: number };

/** Drag a whole block: select it and hand ProseMirror the slice, so its own drop logic moves it. */
function beginBlockDrag(editor: Editor, pos: number, event: React.DragEvent) {
  const selection = NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", selection.node.textContent);
  editor.view.dragging = { slice: selection.content(), move: true };
}

const TURN_INTO = [
  { label: "Text", icon: Type, run: (e: Editor) => e.chain().focus().clearNodes().run() },
  { label: "Heading 1", icon: Heading1, run: (e: Editor) => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { label: "Heading 2", icon: Heading2, run: (e: Editor) => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { label: "Heading 3", icon: Heading3, run: (e: Editor) => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  { label: "Bulleted list", icon: List, run: (e: Editor) => e.chain().focus().clearNodes().toggleBulletList().run() },
  { label: "Numbered list", icon: ListOrdered, run: (e: Editor) => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { label: "Checklist", icon: ListChecks, run: (e: Editor) => e.chain().focus().clearNodes().toggleTaskList().run() },
  { label: "Quote", icon: Quote, run: (e: Editor) => e.chain().focus().clearNodes().toggleBlockquote().run() },
  { label: "Code block", icon: Code, run: (e: Editor) => e.chain().focus().clearNodes().toggleCodeBlock().run() },
] as const;

/**
 * The canvas surface: the editor plus Slack's ⋮⋮ block handle. Hover (or the
 * caret) picks the top-level block; ⋮⋮ opens Turn into / move / duplicate /
 * delete, and dragging it moves the block with ProseMirror's own drop logic.
 */
export function CanvasBody({ editor, channelId }: { editor: Editor | null; channelId: string }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const locate = (pos: number | null) => {
    if (!editor || pos === null || !wrapper.current) return setBlock(null);
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return setBlock(null);
    setBlock({ pos, top: dom.getBoundingClientRect().top - wrapper.current.getBoundingClientRect().top });
  };

  const blockAt = (clientY: number) => {
    if (!editor) return null;
    const rect = editor.view.dom.getBoundingClientRect();
    const hit = editor.view.posAtCoords({ left: rect.left + 16, top: clientY });
    if (!hit) return null;
    if (hit.inside >= 0 && editor.state.doc.resolve(hit.inside).depth === 0) return hit.inside;
    const $pos = editor.state.doc.resolve(hit.pos);
    return $pos.depth >= 1 ? $pos.before(1) : null;
  };

  useEffect(() => {
    if (!editor || !editor.isEditable) return;
    const follow = () => {
      if (menuOpen) return;
      const { $from } = editor.state.selection;
      locate($from.depth >= 1 ? $from.before(1) : editor.state.selection.from);
    };
    editor.on("selectionUpdate", follow);
    return () => {
      editor.off("selectionUpdate", follow);
    };
  }, [editor, menuOpen]);

  if (!editor) return <div className="nb-canvas min-h-[50vh]" aria-busy="true" />;
  const node = block ? editor.state.doc.nodeAt(block.pos) : null;
  const editable = editor.isEditable;

  const selectBlock = () => {
    if (!block || !node) return;
    if (node.isTextblock || !node.isAtom) {
      editor.chain().setTextSelection({ from: block.pos + 1, to: block.pos + node.nodeSize - 1 }).run();
    } else {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)));
    }
  };
  const remove = () => {
    if (!block || !node) return;
    editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + node.nodeSize));
    setBlock(null);
  };
  const duplicate = () => {
    if (!block || !node) return;
    editor.view.dispatch(editor.state.tr.insert(block.pos + node.nodeSize, node));
  };
  const resize = (title: ImageSize) => {
    if (!block || !node) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(block.pos, undefined, { ...node.attrs, title }));
  };

  const onDragStart = (event: React.DragEvent) => {
    if (block) beginBlockDrag(editor, block.pos, event);
  };

  return (
    <div
      ref={wrapper}
      className="relative pl-12"
      onMouseMove={(event) => {
        if (!menuOpen && editable) locate(blockAt(event.clientY));
      }}
      // Capture phase: files never reach ProseMirror's own paste/drop handling.
      onDropCapture={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length || !editable) return;
        event.preventDefault();
        event.stopPropagation();
        const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertCanvasImages(editor, channelId, files, hit?.pos);
      }}
      onPasteCapture={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (!files.length || !editable || !insertCanvasImages(editor, channelId, files)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {editable && block && node ? (
        <div className="nb-canvas-handle absolute left-0 flex items-center" style={{ top: block.top }}>
          {/* The grip is a plain draggable button; Radix opens on pointerdown, which would fight the drag. */}
          <div className="relative">
            <button
              type="button"
              draggable
              onDragStart={onDragStart}
              onClick={() => setMenuOpen(true)}
              className="nb-icon-button size-7 cursor-grab active:cursor-grabbing pointer-coarse:size-11"
              aria-label="Block options (drag to move)"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <GripVertical size={16} />
            </button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span aria-hidden="true" className="pointer-events-none absolute inset-0" tabIndex={-1} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {node.type.name === "image" ? (
                <>
                  <DropdownMenuLabel className="nb-micro">Image size</DropdownMenuLabel>
                  {(["s", "m", "full"] as const).map((size) => (
                    <DropdownMenuItem key={size} onSelect={() => resize(size)}>
                      {size === "s" ? "Small" : size === "m" ? "Medium" : "Full width"}{node.attrs.title === size ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => window.open(String(node.attrs.src), "_blank", "noopener")}><ExternalLink /> Open original</DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={String(node.attrs.src)} download={String(node.attrs.alt ?? "image")}><Download /> Download</a>
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><Type /> Turn into</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    {TURN_INTO.map(({ label, icon: Icon, run }) => (
                      <DropdownMenuItem key={label} onSelect={() => { selectBlock(); run(editor); }}><Icon /> {label}</DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={duplicate}><CopyPlus /> Duplicate</DropdownMenuItem>
              {node.textContent ? (
                <DropdownMenuItem onSelect={() => { void copyWithToast(node.textContent, "Copied"); }}><Copy /> Copy text</DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}><Trash2 /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Read-only render of canvas markdown (template and existing-canvas previews). */
export function CanvasPreview({ markdown }: { markdown: string }) {
  const editor = useCanvasEditor({ content: markdown, editable: false });
  useEffect(() => {
    if (editor && canvasMarkdown(editor) !== markdown) setCanvasContent(editor, markdown);
  }, [editor, markdown]);
  return <EditorContent editor={editor} />;
}

// The printed canvas uses the brand type and ink-on-paper colours (spec), not system defaults.
// ponytail: fixed print colours (a PDF is always light). upgrade: none needed.
const PRINT_CSS = `
  body { font: 15px/1.6 "Instrument Sans", ui-sans-serif, system-ui, sans-serif; color: #141A1E; background: #FAF8F4; margin: 0; }
  h1.title { font-size: 30px; font-weight: 600; margin: 0 0 16px; }
  h1 { font-size: 24px; font-weight: 600; } h2 { font-size: 20px; font-weight: 600; } h3 { font-size: 17px; font-weight: 600; }
  img { max-width: 100%; break-inside: avoid; border-radius: 8px; }
  img[data-size="s"] { width: 33%; } img[data-size="m"] { width: 60%; }
  ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; } ul[data-type="taskList"] li > label { flex: none; }
  ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #5B6770; }
  blockquote { border-left: 2px solid #D7DDDF; margin: 0; padding-left: 12px; color: #5B6770; }
  pre { background: #F1EEE7; padding: 12px; border-radius: 5px; white-space: pre-wrap; }
  code { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 13px; }
  a { color: #C24720; }
  @page { margin: 18mm; }
`;

/**
 * Download as PDF: the canvas alone in a hidden frame, then the browser's
 * print dialog ("Save as PDF"). Images are same-origin, so they print.
 */
export function printCanvas(title: string, html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return frame.remove();
  doc.title = title || "Channel notes";
  const style = doc.createElement("style");
  style.textContent = PRINT_CSS;
  doc.head.appendChild(style);
  if (title) {
    const heading = doc.createElement("h1");
    heading.className = "title";
    heading.textContent = title;
    doc.body.appendChild(heading);
  }
  const content = doc.createElement("div");
  content.innerHTML = html; // editor.getHTML(): schema-serialized, no scripts or handlers
  doc.body.appendChild(content);
  const images = Array.from(doc.images).map((image) => (image.complete ? Promise.resolve() : new Promise((done) => { image.onload = image.onerror = done; })));
  void Promise.all(images).then(() => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1_000);
  });
}

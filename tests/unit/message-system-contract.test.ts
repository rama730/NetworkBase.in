import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Messages system adheres to design specification contracts", () => {
    const chatSectionsSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChatSections.tsx"),
        "utf8",
    );
    const cssSource = fs.readFileSync(
        path.join(process.cwd(), "src/app/globals.css"),
        "utf8",
    );
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const appSidebarSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/layout/AppSidebar.tsx"),
        "utf8",
    );
    const projectBadgeSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/ProjectBadge.tsx"),
        "utf8",
    );

    // 1. Thread line removal: channels container under active project must not have vertical thread border
    assert.doesNotMatch(
        chatSectionsSource,
        /border-l border-border pl-1\.5/,
        "Channel list under open project must not have unwanted thread line border",
    );
    assert.match(
        chatSectionsSource,
        /<Section\s+id="channels"/,
        "The open project's channels sit in their own Channels section (no thread-line indentation)",
    );

    // 2. Active chat row must use neutral sidebar-accent, not brand accent color
    assert.doesNotMatch(
        cssSource,
        /\.nb-chat-row\[aria-current="page"\]\s*\{\s*background:var\(--accent\)/,
        "Active chat row must not use brand-tinted --accent background",
    );
    assert.match(
        cssSource,
        /\.nb-chat-row\[aria-current="page"\]\s*\{\s*background:var\(--sidebar-accent\);\s*color:var\(--foreground\)/,
        "Active chat row must use neutral --sidebar-accent background matching design specs",
    );

    // 3. ProjectBadge component: image support and single uppercase initial fallback
    assert.match(
        projectBadgeSource,
        /title\.charAt\(0\)\.toUpperCase\(\)/,
        "ProjectBadge must fall back to single uppercase letter initial",
    );
    assert.match(
        projectBadgeSource,
        /<Image\s+src=\{avatarUrl\}/,
        "ProjectBadge must render cover image thumbnail when avatarUrl is present",
    );

    // 4. Workspaces in AppSidebar should not render profile pictures, while Messages switcher uses ProjectBadge
    assert.doesNotMatch(
        appSidebarSource,
        /<ProjectBadge|<UserAvatar|<Image/,
        "AppSidebar Workspaces list must not render profile pictures",
    );
    assert.match(
        chatSectionsSource,
        /<ProjectBadge project=\{open\} size="sm"/,
        "ChatSections open project header must render ProjectBadge",
    );
    assert.match(
        chatSectionsSource,
        /<ProjectBadge project=\{project\} size="sm"/,
        "ChatSections switch project dropdown items must render ProjectBadge",
    );

    // 5. Decoupled project settings from switcher
    assert.match(
        chatSectionsSource,
        /`Options for \$\{open\.title\}`/,
        "ChatSections must render dedicated options menu trigger for opened project",
    );
    assert.match(
        chatSectionsSource,
        /label=\{`Mark \$\{projectTitle\(id\)\} read`\}/,
        "Project headers offer Mark read, naming the project it clears (round 2 #41)",
    );
    assert.match(
        chatSectionsSource,
        /Project settings/,
        "Individual project settings must include Project settings for opened project",
    );

    // 6. Composer alignment and typing indicator
    assert.doesNotMatch(
        conversationViewSource,
        /<p className="h-5 flex-none truncate bg-card px-4 text-\[12px\] text-muted-foreground"/,
        "ConversationView must not render permanent h-5 empty paragraph below Composer",
    );
    assert.match(
        fs.readFileSync(path.join(process.cwd(), "src/components/messages/Composer.tsx"), "utf8"),
        /function TypingIndicator[\s\S]*if \(!label\) return null;[\s\S]*absolute inset-x-3 bottom-\[calc\(100%\+1px\)\] flex h-5[\s\S]*transition-\[opacity,transform\][\s\S]*data-\[visible=false\]:opacity-0[\s\S]*<TypingIndicator names=\{typingNames\} \/>/,
        "Typing floats just above the composer box, so neither the box nor the timeline moves",
    );
    {
        const timeline = fs.readFileSync(path.join(process.cwd(), "src/components/messages/Timeline.tsx"), "utf8");
        const thread = fs.readFileSync(path.join(process.cwd(), "src/components/messages/ThreadPane.tsx"), "utf8");
        // The gap under the last message opens only while someone types (room for the indicator).
        assert.match(timeline, /function TimelineFooter\(\{ context \}[\s\S]*context\?\.typing \? "h-10" : "h-6 transition-\[height\]/);
        assert.match(timeline, /if \(!typing \|\| !atBottom\) return;[\s\S]*requestAnimationFrame\(\(\) => virtuoso\.current\?\.scrollTo\(\{ top: Number\.MAX_SAFE_INTEGER, behavior: "smooth" \}\)\)/);
        assert.match(conversationViewSource, /typing=\{typing\.names\.length > 0\}/);
        assert.match(thread, /THREAD_COMPONENTS = \{ Footer: [\s\S]*context\?\.typing \? "h-10" : "h-6 transition-\[height\]/);
        assert.match(thread, /if \(!typingNow \|\| !atBottom\.current\) return;[\s\S]*requestAnimationFrame\(\(\) => list\.current\?\.scrollTo\(\{ top: Number\.MAX_SAFE_INTEGER, behavior: "smooth" \}\)\)/);
    }
    assert.match(
        cssSource,
        /\.nb-message-composer\s*\{\s*padding-bottom:max\(8px,env\(safe-area-inset-bottom\)\);\s*\}/,
        "Composer padding-bottom must be streamlined to eliminate dead space",
    );
});

test("Section 1 (Slack-Parity Core Experience) contracts", () => {
    const layoutSource = fs.readFileSync(
        path.join(process.cwd(), "src/app/(site)/(main)/messages/[channelId]/layout.tsx"),
        "utf8",
    );
    const drawerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChatDrawer.tsx"),
        "utf8",
    );
    const rowSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessageRow.tsx"),
        "utf8",
    );
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const composerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/Composer.tsx"),
        "utf8",
    );
    const canvasExists = fs.existsSync(
        path.join(process.cwd(), "src/components/messages/ChannelCanvas.tsx"),
    );

    // 1.1 Side-by-Side Split Thread Panel on desktop (3-pane layout)
    assert.match(
        layoutSource,
        /<div data-scroll-root="route" className="relative flex h-full min-h-0 w-full overflow-hidden">/,
        "ChannelLayout must use split flex container for desktop 3-pane layout",
    );
    assert.match(
        drawerSource,
        /lg:relative lg:inset-auto lg:z-10 lg:w-\[clamp\(340px,34vw,560px\)\][^"]*lg:border-l lg:border-border/,
        "ChatDrawer must dock as desktop sidecar panel adjacent to channel timeline",
    );

    // 1.2 Floating Hover Action Bar on Message Rows (1-click reactions 👍, ❤️, Reply in thread, More actions)
    assert.match(
        rowSource,
        /quick\.slice\(0, HOVER_QUICK_COUNT\)/,
        "MessageRow hover bar shows 1-click quick reactions from the one shared set (plan #98)",
    );
    assert.match(
        rowSource,
        /label: "Reply in thread"[\s\S]*\(\["reply", "save", "share"\] as const\)/,
        "MessageRow floating action bar must include Reply in thread (plus Save and Share)",
    );
    assert.match(
        rowSource,
        /aria-label="More actions"/,
        "MessageRow floating action bar must include More actions dropdown button",
    );

    // 1.3 Dynamic Channel Tab System & On-Demand Pins (Slack-parity extensible tabs)
    const tabBarPath = path.join(process.cwd(), "src/components/messages/ChannelTabBar.tsx");
    const tabsCachePath = path.join(process.cwd(), "src/lib/messaging/channel-tabs.ts");
    assert.ok(fs.existsSync(tabBarPath), "ChannelTabBar component must exist");
    assert.ok(fs.existsSync(tabsCachePath), "channel-tabs cache utility must exist");
    assert.ok(canvasExists, "ChannelCanvas component must exist");

    const tabBarSource = fs.readFileSync(tabBarPath, "utf8");
    const tabsCacheSource = fs.readFileSync(tabsCachePath, "utf8");

    assert.match(
        conversationViewSource,
        /<ChannelTabBar/,
        "ConversationView must render dynamic ChannelTabBar component",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /\(\["messages", "pins", "canvas"\] as const\)/,
        "ConversationView must no longer use hardcoded static tabs array",
    );
    assert.match(
        tabBarSource,
        /role="tablist"/,
        "ChannelTabBar must have WAI-ARIA tablist container with fixed h-10 CLS=0 stability",
    );
    assert.match(
        tabBarSource,
        /Messages/,
        "ChannelTabBar must provide permanent Messages anchor tab",
    );
    assert.match(
        tabBarSource,
        /data-add-tab-trigger|aria-label="Add a tab"/,
        "ChannelTabBar must provide interactive + add tab trigger following active tabs",
    );
    assert.match(
        tabsCacheSource,
        /if \(options\.pinCount > 0 \|\| options\.active === "pins"\)/,
        "Pins is a built-in tab once something is pinned",
    );
    assert.doesNotMatch(
        tabsCacheSource,
        /options\.active === "files"/,
        "Files is one shared tab added from + (no temporary Files tab)",
    );
    assert.match(
        tabBarSource,
        /onAddCanvas[\s\S]*onAddFiles[\s\S]*onAddTasks[\s\S]*onAddBookmark/,
        "The + menu adds a canvas (blank, existing, template), Files, project Tasks or a bookmark",
    );
    assert.match(
        tabBarSource,
        /onEditTabs/,
        "ChannelTabBar dropdown must provide Edit tabs management dialog",
    );
    assert.match(
        tabBarSource,
        /onCloseTab\(tab\)/,
        "ChannelTabBar closable tabs must provide accessible hover close button (x)",
    );
    assert.doesNotMatch(
        tabsCacheSource,
        /localStorage/,
        "Tabs are shared per channel (chat_channel_tabs), never browser-only",
    );
    assert.match(
        rowSource,
        /View pins/,
        "MessageRow must offer to open the Pins tab after pinning",
    );
    assert.match(
        conversationViewSource,
        /<ChannelCanvas key=\{channelId\} channel=\{channel\} channelId=\{channelId\}/,
        "ConversationView must render ChannelCanvas when canvas tab is selected",
    );
    assert.match(
        conversationViewSource,
        /<Pins channelId=\{channelId\}/,
        "ConversationView must render Pins when pins tab is selected",
    );
    assert.match(
        conversationViewSource,
        /<TasksTab/,
        "ConversationView must render TasksTab when tasks tab is selected",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /ChannelLinkView|<iframe/,
        "Bookmark tabs are not framed inside the app (plan #19)",
    );
    assert.match(
        tabBarSource,
        /const href = normalizeSafeExternalUrl\(tab\.url \?\? ""\) \?\? undefined;[\s\S]*?<a\s+href=\{href\}\s+target="_blank"\s+rel="noopener noreferrer"/,
        "Bookmarks are real links to their (safe) URL in a new browser tab (plan #19/#90; round 2 #109: links, not tabs)",
    );

    // 1.4 Saved for later and reminders (the reorganization plan, item 2, approved 2026-10-03)
    assert.match(
        rowSource,
        /"Save"[\s\S]*Remind me about this/,
        "Messages can be saved for later, with a reminder",
    );

    // 1.5 Slash Commands Expansion
    assert.match(
        composerSource,
        /"\/poll"[\s\S]*"\/code"[\s\S]*"\/status"/,
        "Composer must support the slash commands (/task, /poll, /code, /status)",
    );
    assert.doesNotMatch(
        composerSource,
        /\/shrug|\/tableflip/,
        "Novelty commands are cut from a project tool",
    );
    assert.match(
        composerSource,
        /SLASH_COMMANDS = \[/,
        "Composer must declare SLASH_COMMANDS list with interactive suggestions",
    );
});

test("Section 2 (1M-Scale Pure Performance & Optimization) contracts", () => {
    const storageCacheExists = fs.existsSync(
        path.join(process.cwd(), "src/lib/messaging/storage-cache.ts"),
    );
    const useConversationSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/useConversation.ts"),
        "utf8",
    );
    const composerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/Composer.tsx"),
        "utf8",
    );

    // The retired cache exists only to purge legacy keys; query data owns active timelines.
    assert.ok(storageCacheExists, "Legacy persisted timelines must be purged");
    assert.doesNotMatch(useConversationSource, /getCachedTimeline|setCachedTimeline/);
    assert.match(useConversationSource, /query\.data \? \[\.\.\.query\.data\.pages\]/);

    // 2.2 Fast Uploading: Optimistic blob preview and progress bar
    assert.match(
        composerSource,
        /previewUrl = isImage \? URL\.createObjectURL\(file\) : null/,
        "Composer must generate instant optimistic blob preview for image uploads",
    );
    assert.match(
        composerSource,
        /u\.progress < 100 && !u\.error/,
        "Composer must render animated progress bar overlay during upload",
    );

    // 2.4 Server Scale: Typing throttle & auto-decay
    assert.match(
        useConversationSource,
        /shouldSendTyping\(lastSent\.current, now\)/,
        "useConversation must throttle typing indicators to server-scale interval",
    );
    assert.match(
        fs.readFileSync(path.join(process.cwd(), "src/lib/messaging/typing.ts"), "utf8"),
        /CHAT_TYPING_THROTTLE_MS[\s\S]*CHAT_TYPING_TTL_MS|CHAT_TYPING_TTL_MS[\s\S]*CHAT_TYPING_THROTTLE_MS/,
        "typing throttle and auto-decay come from shared constants",
    );
});

test("Section 3 (Keyboard Power-User Ergonomics) contracts", () => {
    const chromeSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessagesChrome.tsx"),
        "utf8",
    );
    const rowSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessageRow.tsx"),
        "utf8",
    );
    const composerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/Composer.tsx"),
        "utf8",
    );

    // Shortcuts: Cmd+K, Alt+Up/Down, Esc, Shift+Esc
    assert.match(
        chromeSource,
        /useMessagesKeyboardShortcuts/,
        "MessagesChrome must mount global keyboard shortcuts hook",
    );
    assert.match(
        chromeSource,
        /\(e\.metaKey \|\| e\.ctrlKey\) && \(e\.key === "k" \|\| e\.key === "K"\)/,
        "MessagesChrome must handle Cmd/Ctrl+K quick switcher shortcut",
    );
    assert.match(
        chromeSource,
        /e\.altKey && \(e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"\)/,
        "MessagesChrome must handle Alt+Up/Down to jump unread channels",
    );
    assert.match(
        chromeSource,
        /e\.shiftKey && e\.key === "Escape"/,
        "MessagesChrome must handle Shift+Esc to mark project channels read",
    );

    // Message row shortcuts (E, T, S, U, ⌫) on the focused row, over the one action list (plan #96/#97/#105)
    assert.match(
        rowSource,
        /key === "e" \? "edit" : key === "t" \? "reply" : key === "s" \? "save" : key === "u" \? "unread"/,
        "MessageRow must handle E (edit), T (thread), S (save) and U (mark unread)",
    );
    assert.match(rowSource, /onKeyDown=\{onRowKeyDown\}/, "Shortcuts act on the focused row");
    assert.doesNotMatch(rowSource, /window\.addEventListener\("keydown"|isHoveredRef|toggleReaction\("👍"\)|shortcut: "⌘L"/, "No per-row window listener, hover shortcuts, R or ⌘L");

    // Empty composer ArrowUp edits last message
    assert.match(
        composerSource,
        /onArrowUpEmpty: \(\) => \{\s*if \(!onEditLast\) return false;\s*onEditLast\(\);/,
        "Composer must trigger onEditLast when pressing ArrowUp in empty input",
    );
});

test("Section 4 (NetworkBase Integration) contracts", () => {
    const cardSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/cards/MessageCard.tsx"),
        "utf8",
    );
    const codeSnippetSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/CodeSnippetBlock.tsx"),
        "utf8",
    );
    const messageBodySource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessageBody.tsx"),
        "utf8",
    );

    // 4.1 Interactive status pill TaskCard
    assert.match(
        cardSource,
        /<TaskStatusBadge status=\{view\.status\} \/>/,
        "MessageCard shows the app's own task status badge (same colours as the Tasks board, round 3 #132)",
    );
    assert.match(
        cardSource,
        /<DropdownMenuTrigger[\s\S]*?<TaskStatusBadge status=\{view\.status\} \/>/,
        "TaskCard renders its status as the shared task badge inside a dropdown",
    );

    // 4.2 Rich code snippets with line numbers and Copy (no fake "Open in IDE": plan #20)
    assert.doesNotMatch(
        codeSnippetSource,
        /Open in IDE|buildIdeLaunchUri/,
        "CodeSnippetBlock must not offer an IDE launch it can't fulfil",
    );
    assert.match(
        codeSnippetSource,
        /copyWithToast\(cleanCode/,
        "CodeSnippetBlock copies the code",
    );
    assert.match(
        messageBodySource,
        /<CodeSnippetBlock language=\{lang\} code=\{codeString\} \/>/,
        "MessageBody must delegate markdown pre/code blocks to CodeSnippetBlock",
    );
});

test("Section 5 (UI/UX Polish & Modern Visual Refinements) contracts", () => {
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const soundModuleExists = fs.existsSync(
        path.join(process.cwd(), "src/lib/audio/chat-sounds.ts"),
    );
    const useConversationSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/useConversation.ts"),
        "utf8",
    );

    // 5.1 & 5.2 Topic edits in Details only; one unboxed members button with avatars + count
    assert.doesNotMatch(
        conversationViewSource,
        /editingTopic|EditChannelDialog/,
        "Topic and description are edited in Details only (no inline header editor, no second dialog)",
    );
    assert.match(
        conversationViewSource,
        /Add a topic/,
        "Members see 'Add a topic' in the header when the topic is empty",
    );
    assert.match(
        conversationViewSource,
        /onClick=\{\(\) => openDetails\("members"\)\}[\s\S]*?<UserAvatar title="" identity=\{p\} size=\{20\} \/>[\s\S]*?channel\.member_count/,
        "The header members button combines avatars (the 20px scale size) and the count",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /p\.headline/,
        "ConversationView header member profile avatars must not display personal profile headline",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /onClick=\{\(\) => openDetails\("members"\)\}\s*className="[^"]*border border-border/,
        "ConversationView header member profile pictures must not be enclosed in a bordered card",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /UserAvatar title="" identity=\{p\}[\s\S]*?roundedClassName="rounded-full"/,
        "ConversationView header member profile avatars must not use rounded-full circles",
    );

    // 5.3 Custom sound toggle removed in favor of native OS system notifications
    assert.ok(!soundModuleExists, "Custom synthesized Web Audio module must not exist (delegated to native system notifications)");
    assert.doesNotMatch(
        conversationViewSource,
        /<Volume2|<VolumeX/,
        "ConversationView header must not render redundant sound effects toggle button",
    );
    assert.doesNotMatch(
        useConversationSource,
        /playMentionSound|playMessageSound/,
        "useConversation must not trigger custom audio chimes",
    );
});

test("Section 6 (Slack-Parity Canvas Redesign) contracts", () => {
    const canvasSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChannelCanvas.tsx"),
        "utf8",
    );
    const tabBarSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChannelTabBar.tsx"),
        "utf8",
    );
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const canvasStoreSource = fs.readFileSync(
        path.join(process.cwd(), "src/lib/messaging/canvas-store.ts"),
        "utf8",
    );

    // 6.1 Image 1 Decommissioning: Old static cards completely replaced with interactive document canvas
    assert.doesNotMatch(
        canvasSource,
        /BookmarksCard|ChannelPinnedMessagesCard|ChannelTasksCard/,
        "Old static cards must not exist in redesigned ChannelCanvas",
    );

    // 6.2 Image 2 Parity: Tab Bar Dropdown Creation Options & Add Canvas tab
    assert.doesNotMatch(
        tabBarSource,
        /data-add-canvas-trigger/,
        "No separate 'Add canvas' tab: canvases are added from + (and the composer)",
    );
    assert.match(
        tabBarSource,
        /New canvas[\s\S]*Templates…[\s\S]*Copy from another channel…/,
        "ChannelTabBar + menu offers a new canvas, a template or a copy of another channel's (round 2 #54)",
    );
    assert.match(
        canvasSource,
        /Delete canvas/,
        "Deleting a canvas is an explicit action in its own menu",
    );

    // 6.3 Image 3 Parity: Document workspace, grips, placeholders & live title sync
    assert.match(
        canvasSource,
        /placeholder="Your canvas title"/,
        "ChannelCanvas must render 'Your canvas title' placeholder",
    );
    const canvasEditorSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/CanvasEditor.tsx"),
        "utf8",
    );
    assert.match(
        canvasEditorSource,
        /placeholder: "Words go here"/,
        "Canvas editor must render 'Words go here' placeholder",
    );
    assert.match(
        canvasEditorSource,
        /<GripVertical[\s\S]*Turn into[\s\S]*Duplicate[\s\S]*Delete/,
        "Canvas ⋮⋮ handle must open a block menu (Turn into, Duplicate, Delete); moving is drag-only",
    );
    assert.match(
        canvasEditorSource,
        /draggable[\s\S]*onDragStart/,
        "Canvas ⋮⋮ handle must drag blocks",
    );
    assert.match(
        canvasSource,
        /Download as PDF[\s\S]*|Copy as Markdown/,
        "Canvas menu must export (PDF and Markdown)",
    );
    assert.match(
        canvasSource,
        /Start from a template/,
        "ChannelCanvas must render the docked template tray (one name for templates, round 2 #54)",
    );
    assert.match(
        canvasSource,
        /QUICK_TEMPLATES = \["channel-overview", "meeting-notes", "project-brief"\]/,
        "ChannelCanvas template tray must provide quick template pills (Channel Overview, Weekly Sync, Shared Resources)",
    );
    assert.match(
        canvasSource,
        /aria-label="Dismiss template suggestions"/,
        "ChannelCanvas template tray must provide dismiss button [×]",
    );

    // 6.4 Live synchronization & storage caching (<5ms, zero CLS)
    assert.doesNotMatch(
        canvasStoreSource,
        /localStorage/,
        "Canvases are shared (chat_canvases), never browser-only",
    );
    assert.match(
        canvasSource,
        /saveCanvas\(/,
        "ChannelCanvas must save to the server",
    );
    assert.match(
        conversationViewSource,
        /canvasQuery\.data\?\.title/,
        "ConversationView must take the canvas tab title from the shared canvas",
    );
    assert.match(
        conversationViewSource,
        /<CanvasTemplateModal/,
        "ConversationView must mount CanvasTemplateModal",
    );
    assert.match(
        conversationViewSource,
        /<ExistingCanvasModal/,
        "ConversationView must mount ExistingCanvasModal",
    );

    // 6.5 Image 4 Parity: Split-view template gallery with live document preview and Use Template button
    const templateModalSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/CanvasTemplateModal.tsx"),
        "utf8",
    );
    const existingModalSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ExistingCanvasModal.tsx"),
        "utf8",
    );

    assert.match(
        templateModalSource,
        /placeholder="Search all templates"/,
        "CanvasTemplateModal must provide search input for filtering all templates",
    );
    assert.match(
        templateModalSource,
        /Use template/,
        "CanvasTemplateModal must provide Slack-style 'Use Template' action button",
    );
    assert.match(
        templateModalSource,
        /selectedTemplate\?\.id === template\.id \? "bg-card shadow-xs"/,
        "CanvasTemplateModal marks the selected template with the paper well (spec: selection is never a clay fill)",
    );
    assert.match(
        existingModalSource,
        /placeholder="Search canvases…"/,
        "ExistingCanvasModal must provide search input for filtering existing canvases",
    );
    assert.match(
        existingModalSource,
        /Copy into #\$\{channelName\}/,
        "ExistingCanvasModal says what its button does: copy into this channel (round 2 #54)",
    );
    assert.match(
        existingModalSource,
        /listProjectCanvases/,
        "ExistingCanvasModal must list real canvases from the project",
    );
    assert.match(
        tabBarSource,
        /<LayoutTemplate/,
        "ChannelTabBar must use LayoutTemplate icon for Start with a template",
    );
    assert.match(
        canvasStoreSource,
        /Onboarding checklist/,
        "canvas-store must include Employee Onboarding matching Image 4",
    );
});

test("Section 7 (Header Ergonomics & Message Action Menu Fixes) contracts", () => {
    const rowSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessageRow.tsx"),
        "utf8",
    );
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const chatDrawerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChatDrawer.tsx"),
        "utf8",
    );
    const channelScreensSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ChannelScreens.tsx"),
        "utf8",
    );

    // 7.1 Message three-dot action menu anchoring & visibility persistence
    assert.match(
        rowSource,
        /isToolbarOpen\s*\?\s*"flex"/,
        "MessageRow toolbar must stay flex visible when dropdown or picker is open to prevent jumping to (0,0)",
    );
    assert.match(
        rowSource,
        /<DropdownMenu\s+open=\{moreOpen\}\s+onOpenChange=\{(?:setMoreOpen|handleMoreOpenChange)\}/,
        "MessageRow must bind controlled open state to DropdownMenu",
    );
    assert.match(
        rowSource,
        /closing/,
        "MessageRow must preserve closing state to prevent exit-animation jumps to (0,0)",
    );

    // 7.2 Channel view header ergonomics: Clickable channel name opens About, project title inline
    assert.match(
        conversationViewSource,
        /onClick=\{\(\) => openDetails\("about"\)\}[\s\S]*?title=\{`Conversation details \(\$\{detailsShortcut\}\)`\}/,
        "Clicking the conversation name opens Details (About), like ⌘⇧I (round 2 #104: ⌘I stays Italic)",
    );
    assert.match(
        conversationViewSource,
        /channel\.project_title \? <span[^>]*>\{channel\.project_title\}<\/span>/,
        "Project title must appear on the quiet line under the channel name",
    );

    // 7.4 Star: after the title only when starred (no empty hover slot), in the accent colour
    assert.match(
        conversationViewSource,
        /channel\.starred \? \([\s\S]*?<Star size=\{14\} className="text-primary" fill="currentColor"/,
        "Star sits after the title only when starred, in the accent colour (status colours mean status, round 3 #131)",
    );

    // 7.5 Drawer header: title and "#channel · Project" inline; Thread and Details become tabs when both open
    assert.match(
        chatDrawerSource,
        /<h2 ref=\{heading\}[^>]*>\{label\}<\/h2>[\s\S]*\{where \?/,
        "ChatDrawer header must display title and channel subtitle inline on the same row",
    );
    assert.match(
        chatDrawerSource,
        /channel\.project_title \? ` · \$\{channel\.project_title\}` : ""/,
        "The drawer subtitle includes the project title after the channel name",
    );
    assert.match(
        channelScreensSource,
        /panes\.thread \|\| panes\.details[\s\S]*?<ChatDrawer/,
        "Thread and Details open in one drawer beside the conversation (?thread=, ?details=)",
    );
});

test("Section 8 (Comprehensive UI/UX Enhancements & Consolidation) contracts", () => {
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );
    const composerSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/Composer.tsx"),
        "utf8",
    );

    // 8.1 Slack-parity channel starting point: hashtag inline before channel name, no profile box
    assert.match(
        conversationViewSource,
        /<Hash size=\{18\}/,
        "Channel Intro must render inline Hash icon before channel name",
    );
    assert.match(
        conversationViewSource,
        /"Welcome to" : "This is the start of"[\s\S]*?<Hash[\s\S]*?\{channel\.name\}/,
        "Channel Intro must render Slack-parity starting point with inline hashtag and channel name",
    );
    assert.match(
        conversationViewSource,
        /Add a description[\s\S]*Add people[\s\S]*Create a canvas/,
        "Channel Intro offers its real next steps (plan item 45)",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /Add company handbook/,
        "Channel Intro must not render pre-card ('Add company handbook')",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /Personalize a welcome message/,
        "Channel Intro must not render pre-card ('Personalize a welcome message')",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /Invite teammates/,
        "Channel Intro must not render pre-card ('Invite teammates')",
    );

    // 8.2 Notifications live on the header bell, always shown to members (plan #11, #13)
    assert.match(
        conversationViewSource,
        /\{isMember \? \(\s*<DropdownMenu>\s*<DropdownMenuTrigger className=\{`\$\{headerButton\} hidden sm:inline-flex`\} aria-label=\{`Notifications:/,
        "The header bell is visible to members (on phones it moves into ⋯, round 3 #98)",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /<DropdownMenuSub>|Pinned messages/,
        "The ⋯ menu keeps only Add people, Copy link, Mark as read, Leave/Close and Archive",
    );
    // Except a DM without its tab bar (one tab only): bookmarks and files start from ⋯ (round 3 #100).
    assert.match(conversationViewSource, /isMember && !showTabBar \? \([\s\S]*?Add a bookmark/);

    // 8.3 Composer plus menu rich creation options (code snippet, media)
    assert.match(
        composerSource,
        /Code block/,
        "Composer plus menu must include the Code block option (one name everywhere, round 2 #161)",
    );
    assert.match(
        composerSource,
        /Photos and videos/,
        "Composer plus menu must include Photos and videos option",
    );

    // 8.4 State-aware Send button using semantic primary design tokens
    assert.match(
        composerSource,
        /bg-primary px-3\.5 text-\[13px\] font-medium text-primary-foreground[\s\S]*?hover:bg-\[var\(--primary-hover\)\]/,
        "Composer Send button must use active primary design tokens when content is ready to send",
    );

    // 8.5 Power-user keyboard shortcuts: Cmd+I for Details, Cmd+L for link
    assert.match(
        conversationViewSource,
        /if \(isDetailsKey\(e\)\)/,
        "ConversationView opens Details with ⌘⇧I (Ctrl+Alt+I off a Mac: Ctrl+Shift+I is DevTools, round 3 #97)",
    );
    const rowSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessageRow.tsx"),
        "utf8",
    );
    assert.match(
        rowSource,
        /onClick=\{pending \? undefined : copyLink\}/,
        "Clicking a message's time copies its link (⌘L is the browser's again, plan #97/#100)",
    );

    // 8.6 Canvas and Poll in the composer plus menu; Send later beside Send
    assert.match(
        composerSource,
        /label: "Open canvas"[\s\S]*label: "Poll"/,
        "Composer plus menu must include Canvas and Poll",
    );
    assert.match(
        composerSource,
        /: uploads\.length \? "Scheduled messages can’t carry files yet"/,
        "Composer offers Schedule message, off (with the reason) while files are attached (plan #111)",
    );

    // 8.7 Pre-cards removed: no Open canvas action pill in channel Intro
    assert.doesNotMatch(
        conversationViewSource,
        /Open canvas/,
        "Channel Intro must not render Open canvas pre-card action pill",
    );

    // 8.8 Debounced draft auto-saving in composer
    assert.match(
        composerSource,
        /writeDraft\(draftKey, next\);\s*draftsThisPage\.add\(draftKey\)/,
        "Composer saves the draft on every change (one localStorage write): leaving never loses the last keys (round 3 #175)",
    );
});

test("Section 9 (Project Selection First & Professional Empty Placeholder) contracts", () => {
    const messagesIndexSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessagesIndex.tsx"),
        "utf8",
    );
    const messagesViewsSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/MessagesViews.tsx"),
        "utf8",
    );
    const homePaneSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/HomePane.tsx"),
        "utf8",
    );

    // 9.1 MessagesIndex must reset project to null and must not auto-redirect to last channel
    assert.match(
        messagesIndexSource,
        /setProject\(null\)/,
        "MessagesIndex must reset selected project to null on visit to present all projects",
    );
    assert.doesNotMatch(
        messagesIndexSource,
        /router\.replace\((?!"\/messages"\))/,
        "MessagesIndex must not auto-redirect to any channel (it only drops a failed ?userId=)",
    );
    assert.doesNotMatch(
        messagesIndexSource,
        /readChatUi\(\)\.last/,
        "MessagesIndex must not auto-open the last channel",
    );

    // 9.2 ProjectLanding must not auto-redirect to default channel
    assert.doesNotMatch(
        messagesViewsSource,
        /target\s*=\s*inProject\.find/,
        "ProjectLanding must not auto-redirect to default channel",
    );
    assert.doesNotMatch(
        messagesViewsSource,
        /router\.replace\(`\/messages\/\$\{target\.id\}`\)/,
        "ProjectLanding must not auto-redirect to target channel",
    );

    // 9.3 HomePane professional empty state & project-aware placeholder
    assert.match(
        homePaneSource,
        /Start a conversation[\s\S]*Message a teammate[\s\S]*title="Unread"/,
        "HomePane shows what needs you (Unread; recent ones live in the sidebar), and first-time users get a way to start (round 2 #38, #39)",
    );
    assert.match(
        homePaneSource,
        /<ProjectBadge project=\{project\} size="sm"/,
        "HomePane must render ProjectBadge when a project is chosen",
    );
    assert.match(
        homePaneSource,
        /Browse channels/,
        "HomePane must offer 'Browse channels' action when a project is chosen",
    );
    assert.match(
        homePaneSource,
        /New message/,
        "HomePane must offer 'New message' action",
    );
});

test("Section 10 (Direct Message Minimal Redesign & Icon Cleanup) contracts", () => {
    const conversationViewSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/ConversationView.tsx"),
        "utf8",
    );

    // 10.1 DM Intro must not render redundant 72px avatar or duplicate h2 name
    assert.doesNotMatch(
        conversationViewSource,
        /<UserAvatar identity=\{channel\.dm_user\} size=\{72\}/,
        "DM Intro must not render bloated 72px profile picture",
    );
    assert.doesNotMatch(
        conversationViewSource,
        /<h2 className="mt-3 text-\[24px\] font-semibold">/,
        "DM Intro must not render duplicate 24px bold recipient name",
    );
    assert.doesNotMatch(
        conversationViewSource,
        />View profile<\/Link>/,
        "DM Intro must not render redundant 'View profile' button inside chat stream",
    );

    // 10.2 Header for 1-to-1 DMs must not render group Users icon
    assert.match(
        conversationViewSource,
        /channel\.kind === "dm" \? \(\s*<button type="button" onClick=\{\(\) => openDetails\("about"\)\}/,
        "1-to-1 DM header must render a dedicated details trigger for the recipient",
    );
    assert.match(
        conversationViewSource,
        /<PresenceAvatar identity=\{channel\.dm_user\} userId=\{channel\.dm_user\?\.id\}/,
        "1-to-1 DM header avatar must integrate the presence badge directly on the avatar",
    );

    // 10.3 DM Intro minimal text notice
    assert.match(
        conversationViewSource,
        /This is the very beginning of your direct message history with/,
        "DM Intro must render a minimal single-line text notice without redundant elements",
    );

    // 10.4 Away text removed from DM header
    assert.doesNotMatch(
        conversationViewSource,
        /dmOnline \? "Active" : "Away"/,
        "DM header must not render textual 'Away' or 'Active' label, relying cleanly on the avatar status pip",
    );
});

test("Section 11 (Slack-Exact About Section Layout & Channel Name Editing) contracts", () => {
    const detailsPaneSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/messages/DetailsPane.tsx"),
        "utf8",
    );
    // 11.1 One About card: name, topic, description, notifications, project, created
    assert.match(
        detailsPaneSource,
        /divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"/,
        "DetailsPane About tab must render details grouped with divide-y dividers, not separate floating card boxes",
    );
    assert.match(
        detailsPaneSource,
        /label="Channel name"[\s\S]*prefix="#"/,
        "DetailsPane must render # prefix before channel name",
    );
    assert.match(
        detailsPaneSource,
        /Default channel/,
        "DetailsPane must display Default channel badge when channel.is_default is true",
    );

    // 11.2 Each row edits in place; admins rename (including default channels), validated
    assert.match(
        detailsPaneSource,
        /label="Channel name"[\s\S]*editable=\{canEdit\}[\s\S]*CHAT_CHANNEL_NAME_PATTERN\.test\(v\)/,
        "Admins edit the channel name in place, validated against the naming pattern",
    );
    assert.doesNotMatch(
        detailsPaneSource,
        /EditFieldModal/,
        "No edit modal: About rows edit in place",
    );

    // 11.3 Rows for Topic, Description, Notifications, Created; ID with copy; Leave/Archive at the bottom
    assert.match(
        detailsPaneSource,
        /label="Topic"[\s\S]*label="Description"[\s\S]*<NotifyRow/,
        "DetailsPane must render Topic, Description and Notifications rows",
    );
    assert.match(
        detailsPaneSource,
        /Created[\s\S]*createdDate/,
        "DetailsPane must render Created row with creator name and date",
    );
    assert.match(
        detailsPaneSource,
        /ID: \{channel\.id\}[\s\S]*copyWithToast\(channel\.id, "ID copied"\)/,
        "DetailsPane must render ID footer with copy button",
    );
    assert.doesNotMatch(
        detailsPaneSource,
        /"pins", "settings"/,
        "Details has About and Members only; pins and settings live in the conversation",
    );
});


test("Section 12 (Messages reorganization, 96-item plan) contracts", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const sections = read("src/components/messages/ChatSections.tsx");
    const views = read("src/components/messages/MessagesViews.tsx");
    const row = read("src/components/messages/MessageRow.tsx");
    const conversation = read("src/components/messages/ConversationView.tsx");
    const thread = read("src/components/messages/ThreadPane.tsx");
    const timeline = read("src/components/messages/Timeline.tsx");
    const switcher = read("src/components/messages/QuickSwitcher.tsx");
    const migration = read("drizzle/0187_chat_reorganize.sql");

    // A. Inbox replaces Activity + Threads; Saved and Drafts sit beside it.
    assert.match(sections, /href="\/messages\/inbox"[\s\S]*href="\/messages\/saved"[\s\S]*href="\/messages\/drafts"/, "Sidebar top group: Inbox, Saved, Drafts");
    assert.match(read("next.config.ts"), /source: '\/messages\/activity', destination: '\/messages\/inbox'/, "Activity redirects to the Inbox");
    assert.match(read("next.config.ts"), /source: '\/messages\/:channelId\/thread\/:seq', destination: '\/messages\/:channelId\?thread=:seq'/, "Old thread links open the thread drawer");
    assert.match(views, /\{ id: "threads", label: "Threads" \}[\s\S]*\{ id: "reactions", label: "Reactions" \}/, "Inbox filters include Threads and Reactions");
    assert.match(views, /markInboxRead\(\{ all: true, scope \}\)/, "Inbox has Mark all read, scoped to the open tab");
    assert.match(sections, /data\?\.inbox_unread/, "The Inbox badge counts unread Inbox items (same rule as the list)");

    // B. Sidebar: switcher header, unreads filter, row menus, drafts markers.
    assert.match(sections, /function ProjectSwitcher[\s\S]*All projects/, "Project switcher header with an All projects mode");
    assert.match(sections, /onClick=\{onToggleUnreads\}\s*aria-pressed=\{unreadsOnly\}/, "Unreads filter is a visible toggle in the sidebar header (plan #66)");
    assert.doesNotMatch(sections, /role="menuitemcheckbox"/, "Unreads filter is no longer buried in ⋯");
    assert.doesNotMatch(sections, /aria-label="Search messages and conversations"/, "No local search box: the app header search covers it");
    assert.match(sections, /function HoverMenu[\s\S]*Options for/, "Desktop rows have a hover ⋯ menu");
    assert.match(sections, /saveAccountUi\(\{ collapsed: next \}\)[\s\S]*saveAccountUi\(\{ unreadsOnly: !current \}\)/, "Collapsed sections and the Unreads filter follow the account");

    // C/D. Search, shared tabs, Files.
    assert.match(conversation, /\/messages\/search\?in=\$\{channelId\}/, "Search in this conversation from the header");
    assert.match(conversation, /<FilesView channelId=\{channelId\}/, "Files tab");
    assert.match(conversation, /hideCanvas\(true\)[\s\S]*Canvas tab hidden for you/, "Closing the canvas tab hides it for you only");

    // E/F. Timeline and message actions.
    assert.match(timeline, /new message\{unreadAtOpen\.count === 1 && !unreadAtOpen\.more \? "" : "s"\} since \{formatChatTime\(unreadAtOpen\.since, "at"\)\}/, "Unread banner: N (or N+) new messages since a day and time (round 2 #129, #130)");
    assert.match(timeline, /title="Jump to a date"/, "Day labels jump to a date");
    assert.match(row, /"Mark unread"[\s\S]*"Create task"[\s\S]*"Copy text"|"Copy text"[\s\S]*"Mark unread"[\s\S]*"Create task"/, "Message menu: copy text, mark unread, create task");
    assert.match(row, /listReactors/, "Reaction tooltips name who reacted");
    assert.match(row, /deferredFeedback\("Message deleted"/, "Deleting your own message uses the shared active Undo clock");

    // H. Threads: follow, participants, new-replies divider, virtualized.
    assert.match(thread, /setThreadFollow\(/, "Follow / Unfollow a thread");
    assert.match(thread, /New replies/, "New replies divider");
    assert.match(thread, /<Virtuoso/, "Thread replies are virtualized");

    // K. Switcher: recents, unjoined channels, search row.
    assert.match(switcher, /Channels you can join[\s\S]*searchRow/, "Switcher lists joinable channels and a Search messages row");

    // Server: tables are RLS'd with SELECT-only policies, written by server actions.
    for (const table of ["chat_saved", "chat_channel_tabs", "chat_scheduled_messages"]) {
        assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} has RLS`);
        assert.match(migration, new RegExp(`ON public\\.${table} FOR SELECT TO authenticated`), `${table} has a SELECT-only policy`);
    }
});

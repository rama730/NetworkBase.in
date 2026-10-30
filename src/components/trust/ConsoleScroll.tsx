/** The scrolling body for console pages other than the Inbox, whose panes scroll on their own (R3). */
export function ConsoleScroll({ children }: { children: React.ReactNode }) {
    return <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter px-4 md:px-6"><div className="pb-16">{children}</div></div>
}

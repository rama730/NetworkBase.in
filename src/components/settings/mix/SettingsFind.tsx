"use client";

import { Search } from "@/components/ui/icons";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { FIND_EXTRAS, searchSettings, type FindEntry } from "@/lib/settings/find";
import { sectionFromElementId } from "@/lib/settings/navigation";

/** Every setting on the page that can be found: groups and rows carry `data-find` with their name. */
function readIndex(): FindEntry[] {
  const seen = new Set<string>();
  const entries: FindEntry[] = [];
  document.querySelectorAll<HTMLElement>("[data-settings-document] [data-find][id]").forEach((element) => {
    const section = sectionFromElementId(element.id);
    if (!section || seen.has(element.id)) return;
    seen.add(element.id);
    entries.push({ id: element.id, section: SETTINGS_SECTION_META[section].title, title: element.dataset.find ?? "", keywords: `${element.dataset.findKeys ?? ""} ${FIND_EXTRAS[element.id] ?? ""}` });
  });
  return entries;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return <>{text.split(pattern).map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>))}</>;
}

/** "Find a setting" (settings mix): type, arrow to a result, Enter jumps there. "/" anywhere on the page focuses it. */
export function SettingsFind({ onJump }: { onJump: (elementId: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<FindEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = searchSettings(index, query);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const choose = (entry: FindEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    setQuery("");
    onJump(entry.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (results.length) setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      if (query) setQuery(""); else inputRef.current?.blur();
      setOpen(false);
    }
  };
  const showing = open && query.trim().length > 0;

  return (
    <>
      <label className="nbs-find">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Find a setting</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Find a setting"
          autoComplete="off"
          value={query}
          onFocus={() => { setIndex(readIndex()); setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">/</kbd>
      </label>
      <div id={listId} role="listbox" aria-label="Settings that match" className="nbs-results" hidden={!showing}>
        {showing && !results.length ? <div className="nbs-none">Nothing matches “{query.trim()}”</div> : null}
        {showing ? results.map((entry, i) => (
          <div key={entry.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(entry)}>
            <span>{entry.section} ›</span>
            <b><Highlight text={entry.title} query={query} /></b>
          </div>
        )) : null}
      </div>
    </>
  );
}

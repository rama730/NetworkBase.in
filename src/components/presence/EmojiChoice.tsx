"use client";

import { useState } from "react";
import { Smile } from "@/components/ui/icons";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isStatusEmoji } from "@/lib/presence/model";

// ponytail: a curated grid + "type or paste any emoji" (the OS picker covers the
// rest). upgrade: a searchable full emoji picker if people ask for one.
const COMMON = [
  "📅", "🗓️", "🎧", "💻", "🏡", "🚌", "🚗", "✈️",
  "🌴", "🏖️", "🤒", "🤧", "🩺", "🍽️", "☕", "🍕",
  "🎯", "🚀", "🏃", "⏸️", "🔕", "😴", "🧘", "🎉",
  "📚", "✍️", "🔍", "🛠️", "🐛", "💡", "🙋", "👀",
  "🔥", "✅", "⏳", "🌙", "🎤", "📞", "🤝", "❤️",
];

/** Emoji button for a status: common picks, or any emoji typed or pasted. */
export function EmojiChoice({ value, onChange, label = "Choose an emoji" }: { value: string | null; onChange: (emoji: string | null) => void; label?: string }) {
  const [typed, setTyped] = useState("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className="grid size-10 flex-none place-items-center rounded-md bg-muted text-[22px] leading-none hover:bg-muted/70">
        {value ? <span className="font-[system-ui]">{value}</span> : <Smile size={20} className="text-muted-foreground" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {COMMON.map((emoji) => (
            <DropdownMenuItem key={emoji} onSelect={() => onChange(emoji)} aria-label={`Use ${emoji}`} className="size-9 justify-center p-0 text-[20px] font-[system-ui]">
              {emoji}
            </DropdownMenuItem>
          ))}
        </div>
        <form
          className="mt-2 flex items-center gap-1.5 border-t border-border pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isStatusEmoji(typed.trim())) {
              onChange(typed.trim());
              setTyped("");
            }
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Any emoji (⌃⌘Space)"
            aria-label="Type or paste any emoji"
            maxLength={16}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[15px]"
          />
          <button type="submit" disabled={!isStatusEmoji(typed.trim())} className="h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-40">Use</button>
        </form>
        {value ? (
          <DropdownMenuItem onSelect={() => onChange(null)} className="mt-1 justify-center text-[13px] text-muted-foreground">Remove emoji</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { TerminalBlock } from "@/components/ui/terminal-block";

type Props = {
  language?: string;
  code: string;
};

const SHELLS = new Set(["bash", "sh", "zsh", "shell", "console", "terminal", "powershell", "ps1", "cmd"]);

/** A code block in a message: shells read as commands, everything else as code with line numbers (report A9.9). */
export function CodeSnippetBlock({ language = "text", code }: Props) {
  const lang = language.replace(/^language-/, "").toLowerCase();
  const lineCount = code.replace(/\n$/, "").split("\n").length;
  return (
    <TerminalBlock
      className="my-2"
      variant={SHELLS.has(lang) ? "command" : "code"}
      label={SHELLS.has(lang) ? "Terminal" : lang && lang !== "text" ? lang : "Code"}
      lines={!SHELLS.has(lang) && lineCount >= 3}
    >
      {code}
    </TerminalBlock>
  );
}

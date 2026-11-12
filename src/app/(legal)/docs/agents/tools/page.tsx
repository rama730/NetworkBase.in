import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { TIER_WORDS, toolReference } from "@/lib/agents/tool-reference";

// Report D20 (M4c): every agent tool, generated from the same definitions as the MCP servers (and /llms.txt).

export const metadata: Metadata = {
  title: "Agent tools",
  description: "Every tool an AI agent can use on NetworkBase, its arguments, and which ones wait for your yes.",
};

export default function AgentToolsPage() {
  const groups = toolReference();
  return (
    <LegalDocumentPage
      eyebrow="Docs · AI agents"
      title="Agent tools"
      summary="What an AI agent connected to NetworkBase can do. A core set is always loaded; the rest come in packs the agent loads when it needs them. Changes that matter wait for your yes."
      version="2.1"
      sections={groups.map((g, i) => ({
        id: g.pack,
        title: `${i + 1}. ${g.pack === "core" ? "Core (always loaded)" : `${g.pack[0]!.toUpperCase()}${g.pack.slice(1)} pack`}`,
        content: (
          <>
            <p>{g.pack === "core" ? "Loaded in every session." : `Loaded with networkbase_more_tools: ${g.holds}.`}</p>
            <dl className="space-y-4">
              {g.tools.map((t) => (
                <div key={t.name}>
                  <dt className="font-mono text-[13px] font-semibold">{t.name}</dt>
                  <dd className="space-y-1">
                    <p>{t.description}</p>
                    <p className="text-[13px] text-muted-foreground">{TIER_WORDS[t.tier]}</p>
                    {t.args.length ? (
                      <ul className="list-disc pl-5 text-[13px]">
                        {t.args.map((a) => (
                          <li key={a.name}><code>{a.name}</code> ({a.type}{a.required ? ", required" : ""}){a.description ? `: ${a.description}` : ""}</li>
                        ))}
                      </ul>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ),
      })).concat([{
        id: "more",
        title: `${groups.length + 1}. More`,
        content: <p>How agents sign in and what they may do: <Link href="/docs/agents">AI agents</Link>. The same list for AI readers: <a href="/llms.txt">llms.txt</a>.</p>,
      }])}
    />
  );
}

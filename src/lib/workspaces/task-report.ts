/** A report posted from the CLI or an agent (`nb task report`, report A9.8): "**Report** summary", then check lines. */
export type ParsedReport = { summary: string; checks: Array<{ ok: boolean; name: string; note: string | null }>; output: string | null };

export function parseReport(content: string): ParsedReport | null {
  if (!content.startsWith("**Report**")) return null;
  const [head = "", ...rest] = content.split("\n");
  const checks: ParsedReport["checks"] = [];
  const other: string[] = [];
  let output: string | null = null;
  const fence = rest.join("\n").match(/```[a-z]*\n([\s\S]*?)```/);
  if (fence) output = fence[1] ?? null;
  for (const line of (fence ? rest.join("\n").replace(fence[0], "") : rest.join("\n")).split("\n")) {
    const m = /^- ([✓✗]) (.+?)(?: — (.+))?$/.exec(line.trim());
    if (m) checks.push({ ok: m[1] === "✓", name: m[2]!, note: m[3] ?? null });
    else if (line.trim()) other.push(line.trim());
  }
  return { summary: [head.replace("**Report**", "").trim(), ...other].filter(Boolean).join("\n"), checks, output };
}


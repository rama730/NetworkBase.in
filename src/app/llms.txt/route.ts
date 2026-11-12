import { llmsText } from "@/lib/agents/tool-reference";

// Report D20 (M4c): NetworkBase for AI readers, generated from the MCP tool definitions at build time.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

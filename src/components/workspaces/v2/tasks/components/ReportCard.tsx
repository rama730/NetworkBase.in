import { TerminalBlock } from "@/components/ui/terminal-block";
import { parseReport, type ParsedReport } from "@/lib/workspaces/task-report";

export { parseReport };

export function ReportCard({ report }: { report: ParsedReport }) {
  return (
    <div className="mt-1 space-y-2 rounded-[5px] border border-border bg-card p-3">
      <p className="nb-micro">Report</p>
      {report.summary ? <p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{report.summary}</p> : null}
      {report.checks.length ? (
        <ul className="space-y-1">
          {report.checks.map((c, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[13px]">
              <span className="nb-status shrink-0" data-tone={c.ok ? "success" : "danger"}>{c.ok ? "pass" : "fail"}</span>
              <span className="text-foreground">{c.name}</span>
              {c.note ? <span className="text-muted-foreground">{c.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {report.output ? <TerminalBlock variant="output" label="Output" collapseAfter={8}>{report.output}</TerminalBlock> : null}
    </div>
  );
}

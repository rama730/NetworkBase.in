'use client';


export function SplitDiffViewer({
  leftTitle,
  leftContent,
  rightTitle,
  rightContent,
}: {
  leftTitle: string;
  leftContent: string;
  rightTitle: string;
  rightContent: string;
}) {
  const leftLines = leftContent ? leftContent.split("\n") : [];
  const rightLines = rightContent ? rightContent.split("\n") : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-lg overflow-hidden border-zinc-200 dark:border-zinc-800 text-xs font-mono">
      <div className="flex flex-col border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800">
        <div className="bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
          <span>{leftTitle}</span>
          <span className="text-[11px] text-zinc-500">{leftLines.length} lines</span>
        </div>
        <div className="max-h-72 overflow-y-auto overflow-x-auto p-2 space-y-0.5 bg-zinc-50 dark:bg-zinc-950">
          {leftLines.length === 0 ? (
            <p className="p-2 text-zinc-400 italic">(File absent)</p>
          ) : (
            leftLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50">
                <span className="w-8 text-right select-none text-zinc-400 shrink-0">{idx + 1}</span>
                <span className="whitespace-pre break-all">{line || " "}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex flex-col">
        <div className="bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
          <span>{rightTitle}</span>
          <span className="text-[11px] text-zinc-500">{rightLines.length} lines</span>
        </div>
        <div className="max-h-72 overflow-y-auto overflow-x-auto p-2 space-y-0.5 bg-zinc-50 dark:bg-zinc-950">
          {rightLines.length === 0 ? (
            <p className="p-2 text-zinc-400 italic">(File absent)</p>
          ) : (
            rightLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50">
                <span className="w-8 text-right select-none text-zinc-400 shrink-0">{idx + 1}</span>
                <span className="whitespace-pre break-all">{line || " "}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

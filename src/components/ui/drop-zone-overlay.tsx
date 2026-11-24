'use client';

import { Upload } from '@/components/ui/icons';

interface DropZoneOverlayProps {
    visible: boolean;
}

export function DropZoneOverlay({ visible }: DropZoneOverlayProps) {
    if (!visible) return null;
    return (
        <div className="absolute inset-0 z-50 m-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-background/80 backdrop-blur-none transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms] ease-out">
            <div className="pointer-events-none flex flex-col items-center gap-4 text-primary animate-in zoom-in-95 fade-in duration-[180ms]">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-8 ring-primary/5">
                    <Upload className="h-8 w-8" />
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <h3 className="text-xl font-semibold tracking-tight">Drop files to send</h3>
                    <p className="text-sm text-muted-foreground">Release to add them as attachments</p>
                </div>
            </div>
        </div>
    );
}

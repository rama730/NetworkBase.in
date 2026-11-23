"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Rocket, FileText } from "lucide-react";
import { PixelBurst } from "@/components/ui/PixelBurst";

interface ProjectOnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectTitle: string;
    roleTitle?: string;
    onViewTasks: () => void;
    onViewDocs: () => void;
}

export function WorkspaceOnboardingModal({
    isOpen,
    onClose,
    projectTitle,
    roleTitle,
    onViewTasks,
    onViewDocs
}: ProjectOnboardingModalProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-card border-border text-foreground">
                <div className="p-6">
                    <DialogHeader>
                        <div className="relative mx-auto mb-4 flex size-12 items-center justify-center rounded-[6px] bg-primary/10">
                            <Rocket className="size-6 text-primary" />
                            {isOpen ? <PixelBurst /> : null}
                        </div>
                        <DialogTitle className="text-center text-xl font-semibold text-foreground">
                            Welcome to the Team
                        </DialogTitle>
                        <DialogDescription className="text-center text-muted-foreground mt-2">
                            You are now an official member of <span className="font-semibold text-foreground">{projectTitle}</span>
                            {roleTitle && <span> as a <span className="font-semibold text-primary">{roleTitle}</span></span>}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="mt-8 space-y-4">
                        <div className="p-4 bg-muted/30 rounded-lg border border-border flex gap-3">
                            <div className="mt-1">
                                <CheckCircle2 className="w-5 h-5 text-[var(--status-success)]" />
                            </div>
                            <div>
                                <h4 className="font-medium text-sm text-foreground">Access granted</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    You can now view internal documents, tasks, and sprint boards.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={onViewTasks}
                                className="p-4 bg-card hover:bg-muted/40 border border-border rounded-lg transition-[color,background-color,border-color,box-shadow,opacity,transform] hover:scale-[1.02] text-left group"
                            >
                                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                                    <CheckCircle2 className="w-4 h-4 text-primary" />
                                </div>
                                <span className="font-semibold text-sm text-foreground block">My tasks</span>
                                <span className="text-xs text-muted-foreground">View your assignments</span>
                            </button>

                            <button 
                                onClick={onViewDocs}
                                className="p-4 bg-card hover:bg-muted/40 border border-border rounded-lg transition-[color,background-color,border-color,box-shadow,opacity,transform] hover:scale-[1.02] text-left group"
                            >
                                <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-amber-500/20 transition-colors">
                                    <FileText className="w-4 h-4 text-amber-500" />
                                </div>
                                <span className="font-semibold text-sm text-foreground block">Read docs</span>
                                <span className="text-xs text-muted-foreground">Get up to speed</span>
                            </button>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 bg-muted/20 border-t border-border sm:justify-center">
                    <Button onClick={onClose} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                        Dismiss
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

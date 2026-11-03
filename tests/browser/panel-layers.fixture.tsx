import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Student check 2: the task panel sits at the 200/201 layer (TaskDetailPanel); what it opens must land above it.
function Panel() {
    const [confirm, setConfirm] = useState(false)
    return (
        <Dialog open>
            <DialogContent presentation="right-drawer" overlayClassName="z-[200] bg-black/60" className="z-[201] right-0 top-0 h-full w-[580px] bg-card p-6">
                <DialogTitle>Lab 1</DialogTitle>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button">Select status</button></DropdownMenuTrigger>
                    <DropdownMenuContent><DropdownMenuItem>In progress</DropdownMenuItem></DropdownMenuContent>
                </DropdownMenu>
                <Select>
                    <SelectTrigger aria-label="Priority"><SelectValue placeholder="Medium" /></SelectTrigger>
                    <SelectContent><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
                <button type="button" onClick={() => setConfirm(true)}>Delete</button>
                <Dialog open={confirm} onOpenChange={setConfirm}>
                    <DialogContent><DialogTitle>Delete Lab 1?</DialogTitle><button type="button">Confirm delete</button></DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    )
}

createRoot(document.getElementById('root')!).render(<Panel />)

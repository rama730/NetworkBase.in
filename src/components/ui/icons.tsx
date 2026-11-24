import type { JSX, ReactNode, Ref, SVGProps } from 'react'
import { ICON_CELLS, type IconKey } from '@/lib/icon-cells'
import { cn } from '@/lib/utils'

// The app's icons: pixel drawings on whole-pixel cells, under the names the app used with Lucide.
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
    size?: number | string
    /** Kept for call sites written for line icons; pixel icons have no stroke. */
    strokeWidth?: number | string
    absoluteStrokeWidth?: boolean
    /** Fill the inside cells from the bottom up, row by row (a like landing). */
    rise?: boolean
    ref?: Ref<SVGSVGElement>
}
export type IconComponent = ((props: IconProps) => ReactNode) & { displayName?: string }

const CLASS_SIZE = /(?:^|\s)(?:size|h)-(?:(\d+(?:\.5)?)|\[(\d+)px\])(?=\s|$)/g
const NAMED_SIZE: Record<string, number> = { 'nb-empty-state-icon': 24 }

/** The box an icon is drawn for: its size prop, else its size class, else 16 (menus and buttons size icons at 16). */
export function iconBox(size: IconProps['size'], className?: string, style?: IconProps['style']): number {
    const n = Number(size ?? (typeof style?.width === 'number' ? style.width : NaN))
    if (Number.isFinite(n) && n > 0) return Math.round(n)
    let px = 0
    for (const m of className?.matchAll(CLASS_SIZE) ?? []) px = m[1] ? Number(m[1]) * 4 : Number(m[2])
    if (px) return px
    for (const [name, value] of Object.entries(NAMED_SIZE)) if (className?.split(/\s+/).includes(name)) return value
    return 16
}

type Geometry = { box: number; out: string; inside: string }
// globalThis: this module also exports an icon named Map.
const cache = new globalThis.Map<string, Geometry>()

/** Cell size and offset for a box: 6x6 at 12px and under, else 7x7 at 2px (14-23), 3px (24-31), 4px (32-39)... */
export function iconGeometry(key: IconKey, requested: number): Geometry {
    const id = key + ':' + requested
    const hit = cache.get(id)
    if (hit) return hit
    const [main, small] = ICON_CELLS[key]
    const useSmall = requested <= 13 && !!small
    // An icon with no 6x6 drawing is never drawn under 14px: it takes 14 there instead.
    const box = requested <= 13 && !small ? 14 : requested
    const rows = (useSmall ? small : main)!.split('/')
    const n = rows.length
    const cell = useSmall ? Math.max(1, Math.floor(box / 6)) : box < 16 ? Math.floor(box / 7) : Math.floor(box / 8)
    const pad = Math.floor((box - n * cell) / 2)
    const lit = (r: number, c: number) => rows[r]?.[c] === '#'
    // Inside cells: off cells the outside can't reach. They take the svg's fill, so fill-current or a fill colour paints them.
    const outside = new Set<number>()
    const stack: number[] = []
    for (let i = 0; i < n; i++) for (const [r, c] of [[0, i], [n - 1, i], [i, 0], [i, n - 1]] as const) if (!lit(r, c)) stack.push(r * n + c)
    while (stack.length) {
        const v = stack.pop()!
        if (outside.has(v)) continue
        outside.add(v)
        const r = Math.floor(v / n), c = v % n
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const rr = r + dr, cc = c + dc
            if (rr >= 0 && cc >= 0 && rr < n && cc < n && !lit(rr, cc) && !outside.has(rr * n + cc)) stack.push(rr * n + cc)
        }
    }
    const runs = (on: (r: number, c: number) => boolean) => {
        let d = ''
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (!on(r, c) || (c > 0 && on(r, c - 1))) continue
            let len = 1
            while (c + len < n && on(r, c + len)) len++
            d += `M${pad + c * cell} ${pad + r * cell}h${len * cell}v${cell}h-${len * cell}z`
        }
        return d
    }
    const geometry = { box, out: runs(lit), inside: runs((r, c) => !lit(r, c) && !outside.has(r * n + c)) }
    cache.set(id, geometry)
    return geometry
}

function pixelIcon(key: IconKey, name: string): IconComponent {
    const Icon = ({ size, strokeWidth, absoluteStrokeWidth, rise, className, style, fill, color, children, ...rest }: IconProps) => {
        const requested = iconBox(size, className, style)
        const g = iconGeometry(key, requested)
        const named = rest['aria-label'] || rest['aria-labelledby'] || rest.role || children
        const forced = g.box !== requested
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width={g.box}
                height={g.box}
                viewBox={`0 0 ${g.box} ${g.box}`}
                fill={fill ?? 'none'}
                shapeRendering="crispEdges"
                aria-hidden={named ? undefined : true}
                {...rest}
                className={cn('nb-pi', `nb-pi-${key}`, rise && 'nb-pi-rise', className)}
                style={forced || color ? { ...style, ...(forced ? { width: g.box, height: g.box } : null), ...(color ? { color } : null) } : style}
            >
                {g.inside ? <path className="nb-pi-in" d={g.inside} /> : null}
                <path fill="currentColor" d={g.out} />
                {children}
            </svg>
        )
    }
    Icon.displayName = name
    return Icon
}

type Node = [keyof JSX.IntrinsicElements, Record<string, string>]
// Brand marks stay as their line drawings (Lucide, ISC licence, Copyright (c) Lucide Contributors): brands' rules forbid redrawing logos.
function brandIcon(nodes: Node[], name: string, key: string): IconComponent {
    const Icon = ({ size, strokeWidth, absoluteStrokeWidth, rise, className, style, children, ...rest }: IconProps) => {
        const box = iconBox(size, className, style)
        const named = rest['aria-label'] || rest['aria-labelledby'] || rest.role || children
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg" width={box} height={box} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden={named ? undefined : true} {...rest}
                className={cn('nb-pi', `nb-pi-${key}`, className)} style={style}
            >
                {nodes.map(([Tag, attrs], i) => <Tag key={i} {...attrs} />)}
                {children}
            </svg>
        )
    }
    Icon.displayName = name
    return Icon
}

export const ALargeSmall: IconComponent = pixelIcon('text-size', 'ALargeSmall')
export const AlarmClock: IconComponent = pixelIcon('alarm', 'AlarmClock')
export const AlertCircle: IconComponent = pixelIcon('error', 'AlertCircle')
export const AlertTriangle: IconComponent = pixelIcon('warning', 'AlertTriangle')
export const Archive: IconComponent = pixelIcon('archive', 'Archive')
export const ArchiveRestore: IconComponent = pixelIcon('archive', 'ArchiveRestore')
export const ArrowDown: IconComponent = pixelIcon('arrow-down', 'ArrowDown')
export const ArrowDownToLine: IconComponent = pixelIcon('arrow-down-to-line', 'ArrowDownToLine')
export const ArrowDownWideNarrow: IconComponent = pixelIcon('sort', 'ArrowDownWideNarrow')
export const ArrowLeft: IconComponent = pixelIcon('arrow-left', 'ArrowLeft')
export const ArrowRight: IconComponent = pixelIcon('arrow-right', 'ArrowRight')
export const ArrowUp: IconComponent = pixelIcon('arrow-up', 'ArrowUp')
export const ArrowUpDown: IconComponent = pixelIcon('arrow-up-down', 'ArrowUpDown')
export const ArrowUpToLine: IconComponent = pixelIcon('arrow-up-to-line', 'ArrowUpToLine')
export const AtSign: IconComponent = pixelIcon('at-sign', 'AtSign')
export const AudioLines: IconComponent = pixelIcon('audio-lines', 'AudioLines')
export const BadgeCheck: IconComponent = pixelIcon('badge-check', 'BadgeCheck')
export const Ban: IconComponent = pixelIcon('ban', 'Ban')
export const BarChart2: IconComponent = pixelIcon('chart', 'BarChart2')
export const BarChart3: IconComponent = pixelIcon('chart', 'BarChart3')
export const Bell: IconComponent = pixelIcon('bell', 'Bell')
export const BellDot: IconComponent = pixelIcon('bell', 'BellDot')
export const BellOff: IconComponent = pixelIcon('bell-off', 'BellOff')
export const BellRing: IconComponent = pixelIcon('bell', 'BellRing')
export const Binary: IconComponent = pixelIcon('binary', 'Binary')
export const Bitcoin: IconComponent = brandIcon([["path",{"d":"M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727"}]], 'Bitcoin', 'bitcoin')
export const Blocks: IconComponent = pixelIcon('grid', 'Blocks')
export const Bold: IconComponent = pixelIcon('bold', 'Bold')
export const BookOpen: IconComponent = pixelIcon('book', 'BookOpen')
export const BookOpenText: IconComponent = pixelIcon('book', 'BookOpenText')
export const Bookmark: IconComponent = pixelIcon('bookmark', 'Bookmark')
export const BookmarkCheck: IconComponent = pixelIcon('bookmark', 'BookmarkCheck')
export const Bot: IconComponent = pixelIcon('bot', 'Bot')
export const Box: IconComponent = pixelIcon('box', 'Box')
export const Braces: IconComponent = pixelIcon('code', 'Braces')
export const Briefcase: IconComponent = pixelIcon('briefcase', 'Briefcase')
export const BriefcaseBusiness: IconComponent = pixelIcon('briefcase', 'BriefcaseBusiness')
export const Bug: IconComponent = pixelIcon('bug', 'Bug')
export const Building2: IconComponent = pixelIcon('building', 'Building2')
export const Calendar: IconComponent = pixelIcon('calendar', 'Calendar')
export const CalendarClock: IconComponent = pixelIcon('calendar', 'CalendarClock')
export const CalendarDays: IconComponent = pixelIcon('calendar', 'CalendarDays')
export const CalendarRange: IconComponent = pixelIcon('calendar', 'CalendarRange')
export const Camera: IconComponent = pixelIcon('camera', 'Camera')
export const ChartGantt: IconComponent = pixelIcon('gantt', 'ChartGantt')
export const Check: IconComponent = pixelIcon('check', 'Check')
export const CheckCheck: IconComponent = pixelIcon('check-double', 'CheckCheck')
export const CheckCircle: IconComponent = pixelIcon('check-circle', 'CheckCircle')
export const CheckCircle2: IconComponent = pixelIcon('check-circle', 'CheckCircle2')
export const CheckIcon: IconComponent = pixelIcon('check', 'CheckIcon')
export const CheckSquare: IconComponent = pixelIcon('checkbox', 'CheckSquare')
export const ChevronDown: IconComponent = pixelIcon('chevron-down', 'ChevronDown')
export const ChevronDownIcon: IconComponent = pixelIcon('chevron-down', 'ChevronDownIcon')
export const ChevronLeft: IconComponent = pixelIcon('chevron-left', 'ChevronLeft')
export const ChevronRight: IconComponent = pixelIcon('chevron-right', 'ChevronRight')
export const ChevronRightIcon: IconComponent = pixelIcon('chevron-right', 'ChevronRightIcon')
export const ChevronUp: IconComponent = pixelIcon('chevron-up', 'ChevronUp')
export const ChevronUpIcon: IconComponent = pixelIcon('chevron-up', 'ChevronUpIcon')
export const ChevronsLeft: IconComponent = pixelIcon('chevrons-left', 'ChevronsLeft')
export const ChevronsRight: IconComponent = pixelIcon('chevrons-right', 'ChevronsRight')
export const Circle: IconComponent = pixelIcon('dot', 'Circle')
export const CircleDot: IconComponent = pixelIcon('dot', 'CircleDot')
export const CircleHelp: IconComponent = pixelIcon('help', 'CircleHelp')
export const CircleIcon: IconComponent = pixelIcon('dot', 'CircleIcon')
export const CircleUser: IconComponent = pixelIcon('user', 'CircleUser')
export const Clapperboard: IconComponent = pixelIcon('video', 'Clapperboard')
export const ClipboardCheck: IconComponent = pixelIcon('tasks', 'ClipboardCheck')
export const ClipboardList: IconComponent = pixelIcon('tasks', 'ClipboardList')
export const Clock: IconComponent = pixelIcon('clock', 'Clock')
export const Clock3: IconComponent = pixelIcon('clock', 'Clock3')
export const Cloud: IconComponent = pixelIcon('cloud', 'Cloud')
export const CloudUpload: IconComponent = pixelIcon('upload', 'CloudUpload')
export const Code: IconComponent = pixelIcon('code', 'Code')
export const Code2: IconComponent = pixelIcon('code', 'Code2')
export const Columns2: IconComponent = pixelIcon('columns', 'Columns2')
export const Compass: IconComponent = pixelIcon('compass', 'Compass')
export const Copy: IconComponent = pixelIcon('copy', 'Copy')
export const CopyPlus: IconComponent = pixelIcon('copy', 'CopyPlus')
export const CornerDownLeft: IconComponent = pixelIcon('corner-down-left', 'CornerDownLeft')
export const CornerDownRight: IconComponent = pixelIcon('corner-down-right', 'CornerDownRight')
export const Crown: IconComponent = pixelIcon('crown', 'Crown')
export const Database: IconComponent = pixelIcon('database', 'Database')
export const Dot: IconComponent = pixelIcon('dot', 'Dot')
export const Download: IconComponent = pixelIcon('download', 'Download')
export const DraftingCompass: IconComponent = pixelIcon('drafting-compass', 'DraftingCompass')
export const Edit2: IconComponent = pixelIcon('edit', 'Edit2')
export const Edit3: IconComponent = pixelIcon('edit', 'Edit3')
export const Eraser: IconComponent = pixelIcon('eraser', 'Eraser')
export const ExternalLink: IconComponent = pixelIcon('external-link', 'ExternalLink')
export const Eye: IconComponent = pixelIcon('eye', 'Eye')
export const EyeOff: IconComponent = pixelIcon('eye-off', 'EyeOff')
export const Facebook: IconComponent = brandIcon([["path",{"d":"M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"}]], 'Facebook', 'facebook')
export const File: IconComponent = pixelIcon('file', 'File')
export const FileArchive: IconComponent = pixelIcon('file-archive', 'FileArchive')
export const FileAudio: IconComponent = pixelIcon('file-audio', 'FileAudio')
export const FileBadge: IconComponent = pixelIcon('file-badge', 'FileBadge')
export const FileCode: IconComponent = pixelIcon('file-code', 'FileCode')
export const FileCode2: IconComponent = pixelIcon('file-code', 'FileCode2')
export const FileDiff: IconComponent = pixelIcon('file-diff', 'FileDiff')
export const FileDown: IconComponent = pixelIcon('download', 'FileDown')
export const FileImage: IconComponent = pixelIcon('file-image', 'FileImage')
export const FileJson: IconComponent = pixelIcon('file-json', 'FileJson')
export const FileOutput: IconComponent = pixelIcon('download', 'FileOutput')
export const FilePlus2: IconComponent = pixelIcon('file-plus', 'FilePlus2')
export const FileQuestion: IconComponent = pixelIcon('file-question', 'FileQuestion')
export const FileSpreadsheet: IconComponent = pixelIcon('file-spreadsheet', 'FileSpreadsheet')
export const FileText: IconComponent = pixelIcon('file-text', 'FileText')
export const FileType2: IconComponent = pixelIcon('file-type', 'FileType2')
export const FileUp: IconComponent = pixelIcon('upload', 'FileUp')
export const FileVideo: IconComponent = pixelIcon('file-video', 'FileVideo')
export const Files: IconComponent = pixelIcon('file', 'Files')
export const Film: IconComponent = pixelIcon('video', 'Film')
export const Filter: IconComponent = pixelIcon('filter', 'Filter')
export const Flag: IconComponent = pixelIcon('flag', 'Flag')
export const Flame: IconComponent = pixelIcon('flame', 'Flame')
export const Folder: IconComponent = pixelIcon('folder', 'Folder')
export const FolderDown: IconComponent = pixelIcon('download', 'FolderDown')
export const FolderInput: IconComponent = pixelIcon('folder-input', 'FolderInput')
export const FolderKanban: IconComponent = pixelIcon('folder-kanban', 'FolderKanban')
export const FolderOpen: IconComponent = pixelIcon('folder', 'FolderOpen')
export const FolderPlus: IconComponent = pixelIcon('folder-plus', 'FolderPlus')
export const FolderTree: IconComponent = pixelIcon('tree', 'FolderTree')
export const FolderUp: IconComponent = pixelIcon('upload', 'FolderUp')
export const Forward: IconComponent = pixelIcon('share', 'Forward')
export const GalleryVerticalEnd: IconComponent = pixelIcon('gallery', 'GalleryVerticalEnd')
export const Gamepad2: IconComponent = pixelIcon('gamepad', 'Gamepad2')
export const Gauge: IconComponent = pixelIcon('gauge', 'Gauge')
export const Gavel: IconComponent = pixelIcon('scale', 'Gavel')
export const GitBranch: IconComponent = pixelIcon('git-branch', 'GitBranch')
export const GitCommitHorizontal: IconComponent = pixelIcon('git-commit', 'GitCommitHorizontal')
export const GitCompare: IconComponent = pixelIcon('file-diff', 'GitCompare')
export const GitGraph: IconComponent = pixelIcon('git-commit', 'GitGraph')
export const GitMerge: IconComponent = pixelIcon('git-merge', 'GitMerge')
export const GitPullRequest: IconComponent = pixelIcon('git-pull-request', 'GitPullRequest')
export const Github: IconComponent = brandIcon([["path",{"d":"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"}],["path",{"d":"M9 18c-4.51 2-5-2-7-2"}]], 'Github', 'github')
export const Globe: IconComponent = pixelIcon('globe', 'Globe')
export const Globe2: IconComponent = pixelIcon('globe', 'Globe2')
export const GraduationCap: IconComponent = pixelIcon('graduation-cap', 'GraduationCap')
export const Grid: IconComponent = pixelIcon('grid', 'Grid')
export const GripVertical: IconComponent = pixelIcon('grip', 'GripVertical')
export const Handshake: IconComponent = pixelIcon('users', 'Handshake')
export const HardDrive: IconComponent = pixelIcon('hard-drive', 'HardDrive')
export const Hash: IconComponent = pixelIcon('hash', 'Hash')
export const Heading1: IconComponent = pixelIcon('heading-1', 'Heading1')
export const Heading2: IconComponent = pixelIcon('heading-2', 'Heading2')
export const Heading3: IconComponent = pixelIcon('heading-3', 'Heading3')
export const Headphones: IconComponent = pixelIcon('headphones', 'Headphones')
export const Heart: IconComponent = pixelIcon('heart', 'Heart')
export const HeartPulse: IconComponent = pixelIcon('heart', 'HeartPulse')
export const HelpCircle: IconComponent = pixelIcon('help', 'HelpCircle')
export const History: IconComponent = pixelIcon('history', 'History')
export const Home: IconComponent = pixelIcon('home', 'Home')
export const House: IconComponent = pixelIcon('home', 'House')
export const Image: IconComponent = pixelIcon('image', 'Image')
export const ImageIcon: IconComponent = pixelIcon('image', 'ImageIcon')
export const ImageOff: IconComponent = pixelIcon('image-off', 'ImageOff')
export const ImagePlus: IconComponent = pixelIcon('image', 'ImagePlus')
export const Images: IconComponent = pixelIcon('image', 'Images')
export const Inbox: IconComponent = pixelIcon('inbox', 'Inbox')
export const Info: IconComponent = pixelIcon('info', 'Info')
export const Instagram: IconComponent = brandIcon([["rect",{"width":"20","height":"20","x":"2","y":"2","rx":"5","ry":"5"}],["path",{"d":"M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"}],["line",{"x1":"17.5","x2":"17.51","y1":"6.5","y2":"6.5"}]], 'Instagram', 'instagram')
export const Italic: IconComponent = pixelIcon('italic', 'Italic')
export const IterationCcw: IconComponent = pixelIcon('refresh', 'IterationCcw')
export const KeyRound: IconComponent = pixelIcon('key', 'KeyRound')
export const Keyboard: IconComponent = pixelIcon('keyboard', 'Keyboard')
export const Landmark: IconComponent = pixelIcon('landmark', 'Landmark')
export const Laptop: IconComponent = pixelIcon('laptop', 'Laptop')
export const Layers: IconComponent = pixelIcon('layers', 'Layers')
export const Layout: IconComponent = pixelIcon('layout', 'Layout')
export const LayoutDashboard: IconComponent = pixelIcon('layout', 'LayoutDashboard')
export const LayoutGrid: IconComponent = pixelIcon('grid', 'LayoutGrid')
export const LayoutTemplate: IconComponent = pixelIcon('layout', 'LayoutTemplate')
export const Lightbulb: IconComponent = pixelIcon('lightbulb', 'Lightbulb')
export const Link: IconComponent = pixelIcon('link', 'Link')
export const Link2: IconComponent = pixelIcon('link', 'Link2')
export const Link2Off: IconComponent = pixelIcon('link-off', 'Link2Off')
export const LinkIcon: IconComponent = pixelIcon('link', 'LinkIcon')
export const Linkedin: IconComponent = brandIcon([["path",{"d":"M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"}],["rect",{"width":"4","height":"12","x":"2","y":"9"}],["circle",{"cx":"4","cy":"4","r":"2"}]], 'Linkedin', 'linkedin')
export const List: IconComponent = pixelIcon('list', 'List')
export const ListChecks: IconComponent = pixelIcon('tasks', 'ListChecks')
export const ListFilter: IconComponent = pixelIcon('filter', 'ListFilter')
export const ListOrdered: IconComponent = pixelIcon('list-ordered', 'ListOrdered')
export const ListTodo: IconComponent = pixelIcon('tasks', 'ListTodo')
export const ListTree: IconComponent = pixelIcon('tree', 'ListTree')
export const Lock: IconComponent = pixelIcon('lock', 'Lock')
export const LockKeyhole: IconComponent = pixelIcon('lock', 'LockKeyhole')
export const LogIn: IconComponent = pixelIcon('log-in', 'LogIn')
export const LogOut: IconComponent = pixelIcon('log-out', 'LogOut')
export const Mail: IconComponent = pixelIcon('mail', 'Mail')
export const MailOpen: IconComponent = pixelIcon('mail-open', 'MailOpen')
export const Map: IconComponent = pixelIcon('route', 'Map')
export const MapPin: IconComponent = pixelIcon('map-pin', 'MapPin')
export const Maximize: IconComponent = pixelIcon('maximize', 'Maximize')
export const Maximize2: IconComponent = pixelIcon('maximize', 'Maximize2')
export const Megaphone: IconComponent = pixelIcon('megaphone', 'Megaphone')
export const Menu: IconComponent = pixelIcon('menu', 'Menu')
export const MessageCircle: IconComponent = pixelIcon('message', 'MessageCircle')
export const MessageSquare: IconComponent = pixelIcon('message', 'MessageSquare')
export const MessageSquareQuote: IconComponent = pixelIcon('quote', 'MessageSquareQuote')
export const MessageSquareText: IconComponent = pixelIcon('message', 'MessageSquareText')
export const MessagesSquare: IconComponent = pixelIcon('message', 'MessagesSquare')
export const Mic: IconComponent = pixelIcon('mic', 'Mic')
export const Minimize: IconComponent = pixelIcon('minimize', 'Minimize')
export const Minimize2: IconComponent = pixelIcon('minimize', 'Minimize2')
export const Minus: IconComponent = pixelIcon('minus', 'Minus')
export const MinusCircle: IconComponent = pixelIcon('close-circle', 'MinusCircle')
export const Monitor: IconComponent = pixelIcon('monitor', 'Monitor')
export const Moon: IconComponent = pixelIcon('moon', 'Moon')
export const MoreHorizontal: IconComponent = pixelIcon('more', 'MoreHorizontal')
export const MoreVertical: IconComponent = pixelIcon('more-vertical', 'MoreVertical')
export const Music: IconComponent = pixelIcon('music', 'Music')
export const Music2: IconComponent = pixelIcon('music', 'Music2')
export const Newspaper: IconComponent = pixelIcon('newspaper', 'Newspaper')
export const Package: IconComponent = pixelIcon('box', 'Package')
export const Palette: IconComponent = pixelIcon('palette', 'Palette')
export const PanelLeftClose: IconComponent = pixelIcon('panel-left', 'PanelLeftClose')
export const PanelLeftOpen: IconComponent = pixelIcon('panel-left', 'PanelLeftOpen')
export const PanelRight: IconComponent = pixelIcon('panel-right', 'PanelRight')
export const PanelRightOpen: IconComponent = pixelIcon('panel-right', 'PanelRightOpen')
export const PanelsTopLeft: IconComponent = pixelIcon('layout', 'PanelsTopLeft')
export const Paperclip: IconComponent = pixelIcon('paperclip', 'Paperclip')
export const Pause: IconComponent = pixelIcon('pause', 'Pause')
export const PenLine: IconComponent = pixelIcon('edit', 'PenLine')
export const Pencil: IconComponent = pixelIcon('edit', 'Pencil')
export const PencilRuler: IconComponent = pixelIcon('drafting-compass', 'PencilRuler')
export const PictureInPicture2: IconComponent = pixelIcon('picture-in-picture', 'PictureInPicture2')
export const Pin: IconComponent = pixelIcon('pin', 'Pin')
export const PinOff: IconComponent = pixelIcon('pin-off', 'PinOff')
export const Play: IconComponent = pixelIcon('play', 'Play')
export const Plug: IconComponent = pixelIcon('plug', 'Plug')
export const Plus: IconComponent = pixelIcon('plus', 'Plus')
export const Presentation: IconComponent = pixelIcon('presentation', 'Presentation')
export const Printer: IconComponent = pixelIcon('printer', 'Printer')
export const Quote: IconComponent = pixelIcon('quote', 'Quote')
export const Redo2: IconComponent = pixelIcon('redo', 'Redo2')
export const RefreshCcw: IconComponent = pixelIcon('refresh', 'RefreshCcw')
export const RefreshCw: IconComponent = pixelIcon('refresh', 'RefreshCw')
export const Repeat: IconComponent = pixelIcon('refresh', 'Repeat')
export const Rocket: IconComponent = pixelIcon('rocket', 'Rocket')
export const RotateCcw: IconComponent = pixelIcon('undo', 'RotateCcw')
export const RotateCw: IconComponent = pixelIcon('refresh', 'RotateCw')
export const Route: IconComponent = pixelIcon('route', 'Route')
export const Save: IconComponent = pixelIcon('save', 'Save')
export const Scale: IconComponent = pixelIcon('scale', 'Scale')
export const Scan: IconComponent = pixelIcon('scan', 'Scan')
export const ScrollText: IconComponent = pixelIcon('newspaper', 'ScrollText')
export const Search: IconComponent = pixelIcon('search', 'Search')
export const SearchX: IconComponent = pixelIcon('search', 'SearchX')
export const Send: IconComponent = pixelIcon('send', 'Send')
export const SendHorizontal: IconComponent = pixelIcon('send', 'SendHorizontal')
export const Settings: IconComponent = pixelIcon('settings', 'Settings')
export const Shapes: IconComponent = pixelIcon('shapes', 'Shapes')
export const Share2: IconComponent = pixelIcon('share', 'Share2')
export const Shield: IconComponent = pixelIcon('shield', 'Shield')
export const ShieldAlert: IconComponent = pixelIcon('error', 'ShieldAlert')
export const ShieldCheck: IconComponent = pixelIcon('shield', 'ShieldCheck')
export const ShieldOff: IconComponent = pixelIcon('shield-off', 'ShieldOff')
export const ShoppingBag: IconComponent = pixelIcon('shopping-bag', 'ShoppingBag')
export const Shuffle: IconComponent = pixelIcon('shuffle', 'Shuffle')
export const Siren: IconComponent = pixelIcon('siren', 'Siren')
export const Slash: IconComponent = pixelIcon('slash', 'Slash')
export const Sliders: IconComponent = pixelIcon('sliders', 'Sliders')
export const SlidersHorizontal: IconComponent = pixelIcon('sliders', 'SlidersHorizontal')
export const Smartphone: IconComponent = pixelIcon('smartphone', 'Smartphone')
export const Smile: IconComponent = pixelIcon('smile', 'Smile')
export const SmilePlus: IconComponent = pixelIcon('smile', 'SmilePlus')
export const Sparkles: IconComponent = pixelIcon('sparkles', 'Sparkles')
export const Square: IconComponent = pixelIcon('square', 'Square')
export const SquareArrowOutUpRight: IconComponent = pixelIcon('external-link', 'SquareArrowOutUpRight')
export const SquareCheck: IconComponent = pixelIcon('checkbox', 'SquareCheck')
export const SquarePen: IconComponent = pixelIcon('edit', 'SquarePen')
export const Star: IconComponent = pixelIcon('star', 'Star')
export const StarOff: IconComponent = pixelIcon('star-off', 'StarOff')
export const Strikethrough: IconComponent = pixelIcon('strikethrough', 'Strikethrough')
export const Sun: IconComponent = pixelIcon('sun', 'Sun')
export const Table: IconComponent = pixelIcon('table', 'Table')
export const Tablet: IconComponent = pixelIcon('tablet', 'Tablet')
export const Tag: IconComponent = pixelIcon('tag', 'Tag')
export const Target: IconComponent = pixelIcon('target', 'Target')
export const Tent: IconComponent = pixelIcon('tent', 'Tent')
export const Terminal: IconComponent = pixelIcon('terminal', 'Terminal')
export const Timer: IconComponent = pixelIcon('timer', 'Timer')
export const Trash2: IconComponent = pixelIcon('trash', 'Trash2')
export const TriangleAlert: IconComponent = pixelIcon('warning', 'TriangleAlert')
export const Twitch: IconComponent = brandIcon([["path",{"d":"M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"}]], 'Twitch', 'twitch')
export const Type: IconComponent = pixelIcon('type', 'Type')
export const Undo2: IconComponent = pixelIcon('undo', 'Undo2')
export const Upload: IconComponent = pixelIcon('upload', 'Upload')
export const UploadCloud: IconComponent = pixelIcon('upload', 'UploadCloud')
export const User: IconComponent = pixelIcon('user', 'User')
export const UserCheck: IconComponent = pixelIcon('user-check', 'UserCheck')
export const UserCog: IconComponent = pixelIcon('user-x', 'UserCog')
export const UserMinus: IconComponent = pixelIcon('user-minus', 'UserMinus')
export const UserPlus: IconComponent = pixelIcon('user-plus', 'UserPlus')
export const UserRound: IconComponent = pixelIcon('user', 'UserRound')
export const UserRoundPlus: IconComponent = pixelIcon('user-plus', 'UserRoundPlus')
export const UserX: IconComponent = pixelIcon('user-x', 'UserX')
export const Users: IconComponent = pixelIcon('users', 'Users')
export const UsersRound: IconComponent = pixelIcon('users', 'UsersRound')
export const Video: IconComponent = pixelIcon('video', 'Video')
export const VideoOff: IconComponent = pixelIcon('video-off', 'VideoOff')
export const Volume1: IconComponent = pixelIcon('volume', 'Volume1')
export const Volume2: IconComponent = pixelIcon('volume', 'Volume2')
export const VolumeOff: IconComponent = pixelIcon('mute', 'VolumeOff')
export const VolumeX: IconComponent = pixelIcon('mute', 'VolumeX')
export const WifiOff: IconComponent = pixelIcon('wifi-off', 'WifiOff')
export const Workflow: IconComponent = pixelIcon('workflow', 'Workflow')
export const X: IconComponent = pixelIcon('close', 'X')
export const XCircle: IconComponent = pixelIcon('close-circle', 'XCircle')
export const XIcon: IconComponent = pixelIcon('close', 'XIcon')
export const Zap: IconComponent = pixelIcon('zap', 'Zap')
export const ZoomIn: IconComponent = pixelIcon('zoom-in', 'ZoomIn')
export const ZoomOut: IconComponent = pixelIcon('zoom-out', 'ZoomOut')

import { AtSign, Briefcase, Camera, Globe, Mail, Megaphone, Mic, Music2, PenLine, Users, Video, type IconComponent } from "@/components/ui/icons";

/** Report 38.8 part 7 (A2.7): channels show a small mark beside their name, never the mark alone. */
export const CHANNEL_ICONS: Record<string, IconComponent> = { AtSign, Briefcase, Camera, Globe, Mail, Megaphone, Mic, Music2, PenLine, Users, Video };
export const channelIcon = (name: string): IconComponent => CHANNEL_ICONS[name] ?? Globe;

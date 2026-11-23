import { AtSign, Briefcase, Camera, Globe, Mail, Megaphone, Mic, Music2, PenLine, Users, Video, type LucideIcon } from "lucide-react";

/** Report 38.8 part 7 (A2.7): channels show a small mark beside their name, never the mark alone. */
export const CHANNEL_ICONS: Record<string, LucideIcon> = { AtSign, Briefcase, Camera, Globe, Mail, Megaphone, Mic, Music2, PenLine, Users, Video };
export const channelIcon = (name: string): LucideIcon => CHANNEL_ICONS[name] ?? Globe;

import {
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Dices,
  FolderOpen,
  Flame,
  Goal,
  Handshake,
  House,
  Image as ImageIcon,
  KeyRound,
  Maximize2,
  Medal,
  Megaphone,
  Mic,
  Minimize2,
  Minus,
  Monitor,
  Plus,
  Printer,
  Save,
  Settings,
  Smartphone,
  Star,
  TrendingUp,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
  Hand,
  CircleCheck,
  CircleDot,
  MessageCircle,
  type LucideProps,
} from "lucide-react";
import type { ReactionKind } from "@/lib/realtime";

// One place that decides which glyphs the UI uses (Lucide, ISC licence — see
// THIRD-PARTY-NOTICES.md). Named, closed set: components say what the icon
// MEANS, not which Lucide component it is, and tree-shaking keeps the bundle
// to exactly these.
const icons = {
  award: Award,
  back: ArrowLeft,
  next: ArrowRight,
  check: Check,
  chevronDown: ChevronDown,
  close: X,
  code: KeyRound,
  commentary: MessageCircle,
  download: Download,
  fullscreen: Maximize2,
  exitFullscreen: Minimize2,
  home: House,
  image: ImageIcon,
  less: Minus,
  more: Plus,
  live: CircleDot,
  megaphone: Megaphone,
  medal: Medal,
  mic: Mic,
  phone: Smartphone,
  print: Printer,
  random: Dices,
  save: Save,
  screen: Monitor,
  settings: Settings,
  soundOn: Volume2,
  soundOff: VolumeX,
  star: Star,
  templates: FolderOpen,
  trophy: Trophy,
  quick: Zap,
  // commentator headline kinds
  kickoff: Clapperboard,
  result: CircleCheck,
  trend: TrendingUp,
  draw: Handshake,
  upset: Flame,
  goal: Goal,
  // spectator cheers
  clap: Hand,
} as const;

export type IconName = keyof typeof icons;

export interface IconProps extends Omit<LucideProps, "ref"> {
  name: IconName;
}

/** Decorative by default (aria-hidden): the visible text or the button's
 * aria-label carries the meaning. */
export function Icon({ name, size = 18, strokeWidth = 1.9, className, ...rest }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}

/** Spectator cheers: the wire carries the kind ("clap" | "fire" | "goal"), the
 * glyph is chosen here at render time, so old and new clients interoperate. */
export const reactionIcon: Record<ReactionKind, IconName> = {
  clap: "clap",
  fire: "upset",
  goal: "megaphone",
};

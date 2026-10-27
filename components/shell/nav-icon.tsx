import {
  Building2Icon,
  ClipboardCheckIcon,
  FactoryIcon,
  LayoutDashboardIcon,
  Settings2Icon,
  SettingsIcon,
  ShieldUserIcon,
  SparklesIcon,
  TagsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavIconName } from "./nav";

const ICONS: Readonly<Record<NavIconName, LucideIcon>> = {
  inspections: ClipboardCheckIcon,
  admin: SettingsIcon,
  dashboard: LayoutDashboardIcon,
  users: UsersIcon,
  // A person in a shield: who may see and do what. Not the Users page's Admin shield (ShieldCheckIcon).
  roles: ShieldUserIcon,
  manufacturers: FactoryIcon,
  clients: Building2Icon,
  defects: TagsIcon,
  // Neither the Admin tab's gear nor the sliders on Steri-AI Settings' General pill.
  settings: Settings2Icon,
  ai: SparklesIcon,
};

/** A nav entry's icon. Decorative: the label next to it names the entry. */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className={className} />;
}

// The icon that goes with each result state. Shapes differ as well as
// colours, so a status never depends on colour alone.
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type { Status } from "@/lib/design/status";

export const STATUS_ICON: Readonly<Record<Status, LucideIcon>> = {
  pass: CircleCheckIcon,
  fail: CircleXIcon,
  warn: TriangleAlertIcon,
  hold: CirclePauseIcon,
  info: InfoIcon,
  not_done: CircleDashedIcon,
};

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon aria-hidden className={className} />;
}

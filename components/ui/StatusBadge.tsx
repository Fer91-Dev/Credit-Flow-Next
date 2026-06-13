import { cn } from "@/lib/utils";

export type BadgeVariant = "success" | "primary" | "warning" | "destructive" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  className?: string;
}

const styles: Record<BadgeVariant, string> = {
  success:     "bg-success/10 text-success border-success/20",
  primary:     "bg-primary/10 text-primary border-primary/20",
  warning:     "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  muted:       "bg-muted/60 text-muted-foreground border-border",
};

export function StatusBadge({ label, variant = "muted", className }: StatusBadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      styles[variant],
      className
    )}>
      {label}
    </span>
  );
}

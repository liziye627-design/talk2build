import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      default: "border-line bg-sunken text-body",
      a: "border-transparent bg-ok-soft text-ok",
      b: "border-transparent bg-brand-soft text-brand",
      alexa: "border-transparent bg-brand-soft text-brand",
      ok: "border-transparent bg-ok-soft text-ok",
      danger: "border-transparent bg-danger-soft text-danger",
      muted: "border-transparent bg-sunken text-muted",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
  {
    variants: {
      variant: {
        default: "border-white/15 bg-white/5 text-[#c9d0da]",
        a: "border-[#7ddec8]/30 bg-[#7ddec8]/10 text-[#7ddec8]",
        b: "border-[#e7b15a]/30 bg-[#e7b15a]/10 text-[#e7b15a]",
        alexa: "border-[#9eb6ff]/30 bg-[#9eb6ff]/10 text-[#9eb6ff]",
        ok: "border-[#5ddeaf]/30 bg-[#5ddeaf]/10 text-[#5ddeaf]",
        danger: "border-[#ff6d6d]/40 bg-[#ff6d6d]/10 text-[#ff8d8d]",
        muted: "border-white/10 bg-transparent text-[#9aa3b2]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

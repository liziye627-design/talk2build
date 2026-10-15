import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7b15a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e13] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-[#e7b15a] text-[#1a1206] hover:bg-[#f0c27a]",
        secondary: "bg-white/8 text-[#f3efe6] hover:bg-white/12 border border-white/10",
        ghost: "text-[#f3efe6] hover:bg-white/8",
        danger: "bg-[#ff6d6d] text-[#2a0d0d] hover:bg-[#ff8b8b]",
        outline: "border border-white/15 bg-transparent text-[#f3efe6] hover:bg-white/6",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

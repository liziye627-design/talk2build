import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-card outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

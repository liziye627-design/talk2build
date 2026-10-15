import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-full border border-white/10 bg-white/5 px-4 text-sm text-[#f3efe6] outline-none placeholder:text-[#8b93a1] focus:border-[#e7b15a]/60",
        className,
      )}
      {...props}
    />
  );
}

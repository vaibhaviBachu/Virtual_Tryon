import * as React from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium tracking-wide text-neutral-600 dark:border-neutral-700 dark:text-neutral-300",
        className
      )}
      {...props}
    />
  );
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui-style class-merging helper used by every UI primitive in components/ui. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

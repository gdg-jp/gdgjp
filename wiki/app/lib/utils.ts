import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional Tailwind class names while resolving conflicting utilities.
 *
 * Shared UI primitives use this rather than concatenating class strings so
 * callers can safely override their defaults.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

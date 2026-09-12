import { Direction as RDirection } from "radix-ui";
import type { ComponentProps } from "react";

export type DirectionProviderProps = ComponentProps<typeof RDirection.Provider>;

export function DirectionProvider(props: DirectionProviderProps) {
  return <RDirection.Provider {...props} />;
}

export const Direction = DirectionProvider;
export const useDirection = RDirection.useDirection;

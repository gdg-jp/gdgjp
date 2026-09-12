import { Direction as RDirection } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
export function DirectionProvider(props) {
  return _jsx(RDirection.Provider, { ...props });
}
export const Direction = DirectionProvider;
export const useDirection = RDirection.useDirection;

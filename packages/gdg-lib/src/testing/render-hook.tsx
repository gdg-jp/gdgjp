import { act } from "react";
import { createRoot } from "react-dom/client";

type Holder<Result> = { current: Result };

export function renderHook<Props, Result>(hook: (props: Props) => Result, initialProps: Props) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const result = {} as Holder<Result>;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ props }: { props: Props }) {
    result.current = hook(props);
    return null;
  }
  act(() => root.render(<Probe props={initialProps} />));
  return {
    result,
    rerender(props: Props) {
      act(() => root.render(<Probe props={props} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

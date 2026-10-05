import type React from "react";
import type { ShareSubject } from "./types";

interface KeyboardDeps {
  isListOpen: boolean;
  activeIndex: number;
  candidateRows: ShareSubject[];
  screen: "overview" | "grant";
  setIsListOpen: (open: boolean) => void;
  setActiveIndex: (updater: (index: number) => number) => void;
  setScreen: (screen: "overview" | "grant") => void;
  chooseCandidate: (subject: ShareSubject) => void;
  close: () => void;
}

/** Combobox + dialog keyboard handling for `ShareDialog`. */
export function createShareKeyboardHandlers(deps: KeyboardDeps) {
  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const { isListOpen, activeIndex, candidateRows } = deps;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      deps.setIsListOpen(true);
      deps.setActiveIndex((index) => Math.min(index + 1, Math.max(candidateRows.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      deps.setIsListOpen(true);
      deps.setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home" && isListOpen) {
      event.preventDefault();
      deps.setActiveIndex(() => 0);
    } else if (event.key === "End" && isListOpen) {
      event.preventDefault();
      deps.setActiveIndex(() => Math.max(candidateRows.length - 1, 0));
    } else if (event.key === "Enter" && isListOpen && candidateRows[activeIndex]) {
      event.preventDefault();
      deps.chooseCandidate(candidateRows[activeIndex]);
    }
  }

  function handleEscapeKeyDown(event: Event) {
    event.preventDefault();
    if (deps.isListOpen) deps.setIsListOpen(false);
    else if (deps.screen === "grant") deps.setScreen("overview");
    else deps.close();
  }

  return { handleInputKeyDown, handleEscapeKeyDown };
}

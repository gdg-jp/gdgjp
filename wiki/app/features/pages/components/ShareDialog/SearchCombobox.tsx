import { Loader2, UsersRound } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MotionPresence } from "~/components/ui/motion";
import { Avatar } from "./avatar";
import { SelectedChips } from "./chips";
import { listboxRole, optionRole } from "./types";
import type { ShareDialogController } from "./use-share-dialog";

/** The people/chapter search box + candidate listbox shared by both screens. */
export function SearchCombobox({ c }: { c: ShareDialogController }) {
  const {
    t,
    searchAreaRef,
    searchInputHeight,
    isListOpen,
    selected,
    removeSelection,
    inputRef,
    query,
    setQuery,
    setIsListOpen,
    setActiveIndex,
    handleInputKeyDown,
    listboxId,
    activeOptionId,
    candidatesFetcher,
    candidateRows,
    activeIndex,
    chooseCandidate,
  } = c;

  return (
    <div ref={searchAreaRef} className="relative">
      <div ref={searchInputHeight.containerRef} className="overflow-hidden">
        <div
          ref={searchInputHeight.contentRef}
          className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border bg-background px-2 py-1 shadow-sm transition-[border-color,box-shadow] duration-150 ${isListOpen ? "border-ring ring-2 ring-ring/20" : "border-input"}`}
        >
          <SelectedChips
            selected={selected}
            onRemove={removeSelection}
            removeLabel={(subject) => t("wiki.share_remove_subject", { name: subject.label })}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsListOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setIsListOpen(true)}
            onKeyDown={handleInputKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isListOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            placeholder={
              selected.length ? t("wiki.share_add_more") : t("wiki.share_search_placeholder")
            }
            className="min-w-44 flex-1 border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <MotionPresence
        present={isListOpen}
        distance={-8}
        enterDuration={260}
        exitDuration={180}
        reducedDuration={180}
        reducedOpacity={0}
        scale={0.92}
        transformOrigin="top center"
        className="absolute left-0 right-0 z-10 mt-1"
      >
        <div
          id={listboxId}
          role={listboxRole}
          tabIndex={-1}
          aria-label={t("wiki.share_search_placeholder")}
          className="max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl shadow-content-primary/10"
        >
          {candidatesFetcher.state !== "idle" && candidateRows.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
              <Loader2 className="animate-spin motion-reduce:animate-none" size={16} />
              {t("wiki.share_loading_candidates")}
            </p>
          ) : candidateRows.length ? (
            candidateRows.map((subject, index) => (
              <Button
                id={`${listboxId}-${index}`}
                key={`${subject.type}:${subject.key}`}
                variant="ghost"
                size="default"
                role={optionRole}
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseCandidate(subject)}
                className={`h-auto w-full justify-start gap-3 rounded-none px-4 py-2.5 text-left ${activeIndex === index ? "bg-accent" : ""}`}
              >
                <Avatar subject={subject} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{subject.label}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {subject.secondary}
                  </span>
                </span>
                {subject.type === "chapter" && (
                  <UsersRound
                    className="text-muted-foreground"
                    size={18}
                    aria-label={t("wiki.share_chapter")}
                  />
                )}
              </Button>
            ))
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              {t("wiki.share_no_candidates")}
            </p>
          )}
        </div>
      </MotionPresence>
    </div>
  );
}

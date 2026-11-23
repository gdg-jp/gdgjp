import { type Extension, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { getCursors, setLocalCursor, subscribe } from "./remote-cursors-store";

const remoteCursorEffect = StateEffect.define<null>();

class CursorWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "remote-cursor";
    wrapper.style.borderLeft = `2px solid ${this.color}`;

    const tag = document.createElement("span");
    tag.className = "remote-cursor-label";
    tag.style.backgroundColor = this.color;
    tag.textContent = this.label;
    wrapper.appendChild(tag);
    return wrapper;
  }

  eq(other: CursorWidget): boolean {
    return this.color === other.color && this.label === other.label;
  }
}

export function remoteCursorsExtension(editorId: string): Extension {
  const lang = editorId.replace("editor-", "") as "ja" | "en";

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private unsubscribe: () => void;

      constructor(private view: EditorView) {
        this.decorations = this.buildDecorations();
        this.unsubscribe = subscribe(editorId, () => {
          this.view.dispatch({ effects: remoteCursorEffect.of(null) });
        });
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(remoteCursorEffect)))
        ) {
          this.decorations = this.buildDecorations();
        }
      }

      buildDecorations(): DecorationSet {
        const cursors = getCursors(editorId);
        const docLen = this.view.state.doc.length;
        const widgets: { pos: number; widget: CursorWidget }[] = [];

        for (const c of cursors) {
          if (c.activeLang !== lang) continue;
          const pos = Math.min(c.cursorPos, docLen);
          widgets.push({ pos, widget: new CursorWidget(c.color, c.userName) });
        }

        widgets.sort((a, b) => a.pos - b.pos);

        return Decoration.set(
          widgets.map((w) => Decoration.widget({ widget: w.widget, side: 1 }).range(w.pos)),
        );
      }

      destroy() {
        this.unsubscribe();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export function localCursorReporter(editorId: string): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.selectionSet) {
      setLocalCursor(editorId, update.state.selection.main.head);
    }
  });
}

import { generateJSON } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Extensions used across editor + JSON generation
// ---------------------------------------------------------------------------

const extensions = [
  StarterKit,
  Image,
  Link.configure({ openOnClick: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TipTapEditorProps {
  initialMarkdown?: string;
  initialJson?: string;
  onChange: (json: string) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TipTapEditor({
  initialMarkdown = "",
  initialJson,
  onChange,
  readOnly = false,
}: TipTapEditorProps) {
  const editor = useEditor({
    extensions,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(JSON.stringify(e.getJSON()));
    },
  });

  // Load from TipTap JSON directly when initialJson is provided.
  useEffect(() => {
    if (!editor || !initialJson) return;
    try {
      editor.commands.setContent(JSON.parse(initialJson), { emitUpdate: false });
    } catch {
      /* ignore malformed JSON */
    }
  }, [editor, initialJson]);

  // Convert markdown → TipTap JSON on mount / when initialMarkdown changes.
  // emitUpdate: false prevents setContent from triggering the onUpdate/onChange handler.
  // Only runs when initialJson is not provided.
  useEffect(() => {
    if (!editor || initialJson) return;
    void Promise.resolve(marked.parse(initialMarkdown)).then((html) => {
      try {
        const clean = DOMPurify.sanitize(html);
        const json = generateJSON(clean, extensions);
        editor.commands.setContent(json);
      } catch {
        editor.commands.setContent(initialMarkdown);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, initialMarkdown, initialJson]);

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white ${readOnly ? "" : "focus-within:ring-2 focus-within:ring-blue-500"}`}
    >
      {!readOnly && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-2 py-1">
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBold().run()}
            active={editor?.isActive("bold")}
            title="Bold"
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            active={editor?.isActive("italic")}
            title="Italic"
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleCode().run()}
            active={editor?.isActive("code")}
            title="Code"
          >
            <code>{"<>"}</code>
          </ToolbarButton>
          <span className="mx-1 text-gray-300">|</span>
          {[1, 2, 3].map((level) => (
            <ToolbarButton
              key={level}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .toggleHeading({ level: level as 1 | 2 | 3 })
                  .run()
              }
              active={editor?.isActive("heading", { level })}
              title={`Heading ${level}`}
            >
              H{level}
            </ToolbarButton>
          ))}
          <span className="mx-1 text-gray-300">|</span>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            active={editor?.isActive("bulletList")}
            title="Bullet List"
          >
            •
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            active={editor?.isActive("orderedList")}
            title="Ordered List"
          >
            1.
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            active={editor?.isActive("codeBlock")}
            title="Code Block"
          >
            {"```"}
          </ToolbarButton>
        </div>
      )}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-4 py-3 focus:outline-none [&_.ProseMirror]:min-h-32 [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 text-sm transition-colors ${
        active ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

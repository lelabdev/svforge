import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyTiptapLink,
  removeTiptapLink,
} from "../packages/tiptap/templates/src/lib/components/svforge/tiptap/link-actions";

function createEditor() {
  const chain = {
    focus: vi.fn(function (this: typeof chain) {
      return this;
    }),
    setLink: vi.fn(function (this: typeof chain) {
      return this;
    }),
    unsetLink: vi.fn(function (this: typeof chain) {
      return this;
    }),
    run: vi.fn(),
  };
  return { editor: { chain: vi.fn(() => chain) }, chain };
}

describe("Tiptap link editor actions (#476)", () => {
  it("does not use the blocking native browser prompt", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapEditor.svelte",
      ),
      "utf8",
    );
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("tiptap_link_prompt");
  });

  it("focuses the editor and applies the entered URL", () => {
    const { editor, chain } = createEditor();
    applyTiptapLink(editor, "https://example.com/article");

    expect(editor.chain).toHaveBeenCalledOnce();
    expect(chain.focus).toHaveBeenCalledOnce();
    expect(chain.setLink).toHaveBeenCalledWith({
      href: "https://example.com/article",
    });
    expect(chain.unsetLink).not.toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalledOnce();
  });

  it("focuses the editor and removes the selected link without deleting its text", () => {
    const { editor, chain } = createEditor();
    removeTiptapLink(editor);

    expect(editor.chain).toHaveBeenCalledOnce();
    expect(chain.focus).toHaveBeenCalledOnce();
    expect(chain.unsetLink).toHaveBeenCalledOnce();
    expect(chain.setLink).not.toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalledOnce();
  });

  it("does nothing when the editor is not mounted", () => {
    expect(() => applyTiptapLink(null, "https://example.com")).not.toThrow();
    expect(() => removeTiptapLink(undefined)).not.toThrow();
  });
});

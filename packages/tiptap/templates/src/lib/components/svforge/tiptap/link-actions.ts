interface LinkCommandChain {
  focus(): LinkCommandChain;
  setLink(attributes: { href: string }): LinkCommandChain;
  unsetLink(): LinkCommandChain;
  run(): unknown;
}

interface LinkEditor {
  chain(): LinkCommandChain;
}

export function applyTiptapLink(
  editor: LinkEditor | null | undefined,
  href: string,
): void {
  editor?.chain().focus().setLink({ href }).run();
}

export function removeTiptapLink(editor: LinkEditor | null | undefined): void {
  editor?.chain().focus().unsetLink().run();
}

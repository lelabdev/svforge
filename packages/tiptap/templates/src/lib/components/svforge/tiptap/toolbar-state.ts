export interface ToolbarState {
	activeFormats: string[];
	activeHeading: string[];
	activeLists: string[];
	activeBlocks: string[];
	activeLink: boolean;
}

interface EditorStateReader {
	isActive: (type: string) => boolean;
	getAttributes: (type: string) => { level?: unknown };
}

const EMPTY_TOOLBAR_STATE: ToolbarState = {
	activeFormats: [],
	activeHeading: [],
	activeLists: [],
	activeBlocks: [],
	activeLink: false
};

/** Map the current Tiptap selection to the toolbar's controlled toggle values. */
export function getToolbarState(editor?: EditorStateReader | null): ToolbarState {
	if (!editor) return EMPTY_TOOLBAR_STATE;

	const activeFormats = ['bold', 'italic', 'underline', 'strike'].filter((mark) => editor.isActive(mark));
	const headingLevel = editor.getAttributes('heading')?.level;
	const activeHeading =
		editor.isActive('heading') && typeof headingLevel === 'number' && [1, 2, 3].includes(headingLevel)
			? [String(headingLevel)]
			: [];

	return {
		activeFormats,
		activeHeading,
		activeLists: ['bulletList', 'orderedList'].filter((list) => editor.isActive(list)),
		activeBlocks: ['blockquote', 'codeBlock'].filter((block) => editor.isActive(block)),
		activeLink: editor.isActive('link')
	};
}

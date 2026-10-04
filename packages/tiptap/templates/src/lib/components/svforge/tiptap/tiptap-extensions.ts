/**
 * SVForge Tiptap Extensions
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { clampHeadingLevel } from './render-tiptap';

// ============================================================
// Visual Heading - semantic heading element styled by Tailwind Typography
// ============================================================

export interface VisualHeadingOptions {
	HTMLAttributes: Record<string, string>;
	levels: number[];
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		visualHeading: {
			setVisualHeading: (attributes: { level: number }) => ReturnType;
			toggleVisualHeading: (attributes: { level: number }) => ReturnType;
			unsetVisualHeading: () => ReturnType;
		};
	}
}

export const VisualHeading = Node.create<VisualHeadingOptions>({
	name: 'heading',

	addOptions() {
		return {
			HTMLAttributes: {},
			levels: [1, 2, 3, 4, 5, 6]
		};
	},

	content: 'inline*',
	group: 'block',
	defining: true,

	addAttributes() {
		return {
			level: {
				default: 1,
				rendered: false
			}
		};
	},

	parseHTML() {
		return this.options.levels.map((level) => ({
			tag: `h${level}`,
			attrs: { level }
		}));
	},

	renderHTML({ node, HTMLAttributes }) {
		const level = clampHeadingLevel(node.attrs.level);
		return [`h${level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},

	addCommands() {
		return {
			setVisualHeading:
				(attributes) =>
				({ commands }) => {
					if (!this.options.levels.includes(attributes.level)) {
						return false;
					}
					return commands.setNode(this.name, attributes);
				},
			toggleVisualHeading:
				(attributes) =>
				({ commands }) => {
					if (!this.options.levels.includes(attributes.level)) {
						return false;
					}
					return commands.toggleNode(this.name, 'paragraph', attributes);
				},
			unsetVisualHeading:
				() =>
				({ commands }) => {
					return commands.setNode('paragraph');
				}
		};
	}
});

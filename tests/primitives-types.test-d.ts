/**
 * #321 — Type-level contract tests for the primitives (run by vitest's
 * typecheck pass — no runtime assertions here).
 *
 * The contracts live in plain TypeScript (primitives/types.ts) so these
 * imports resolve without Svelte tooling.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes } from 'svelte/elements';
import type {
	AnchorProps,
	ButtonOrAnchorProps,
	ButtonProps,
	TableColumn,
	TableProps,
	TableRowKey
} from '../packages/svforge/templates/base/src/lib/components/svforge/primitives/types';

const snippet = null as unknown as Snippet;
/** What a snippet call returns — the branded render object Snippet requires. */
const snippetReturn = null as unknown as ReturnType<typeof snippet>;

interface UserRow {
	id: string;
	name: string;
	role: string;
}

describe('Button union contract (#321)', () => {
	it('button branch: href must be empty-string-or-undefined — exactly the runtime discriminant', () => {
		expectTypeOf<ButtonProps['href']>().toEqualTypeOf<'' | undefined>();
		expectTypeOf<ButtonProps['type']>().toEqualTypeOf<
			'button' | 'submit' | 'reset' | undefined
		>();
	});

	it('anchor branch: href is a required non-empty string, button `type` is not accepted', () => {
		expectTypeOf<AnchorProps['href']>().toEqualTypeOf<string>();
		expectTypeOf<AnchorProps['type']>().toEqualTypeOf<undefined>();
	});

	it('the union discriminates on href presence', () => {
		expectTypeOf<Extract<ButtonOrAnchorProps, { href: string }>>().toEqualTypeOf<AnchorProps>();
		expectTypeOf<Extract<ButtonOrAnchorProps, { href?: '' }>>().toEqualTypeOf<ButtonProps>();
	});

	it('a plain action button assigns to the button branch', () => {
		const props: ButtonProps = { type: 'submit', children: snippet };
		expectTypeOf(props.variant).toEqualTypeOf<
			'filled' | 'outlined' | 'tonal' | 'ghost' | undefined
		>();
		expectTypeOf(props.name).toEqualTypeOf<string | null | undefined>();
	});

	it('a link-styled control assigns to the anchor branch', () => {
		const props: AnchorProps = { href: '/showcase', children: snippet };
		expectTypeOf(props.rel).toEqualTypeOf<HTMLAnchorAttributes['rel']>();
		expectTypeOf(props.target).toEqualTypeOf<HTMLAnchorAttributes['target']>();
	});

	it("href='' keeps FULL button semantics — types match the runtime button branch", () => {
		// Previously a spurious type error: the union typed `href=''` as the
		// anchor branch while the runtime rendered a <button> (#321).
		const emptyHref: ButtonOrAnchorProps = { href: '', type: 'submit', children: snippet };
		expectTypeOf(emptyHref.type).toEqualTypeOf<'button' | 'submit' | 'reset' | undefined>();
	});

	it('a non-empty href forbids button `type` — the branches stay exclusive', () => {
		// @ts-expect-error — with a real href only the anchor branch applies, and it rejects button semantics.
		const _mismatch: ButtonOrAnchorProps = { href: 'https://x', type: 'submit', children: snippet };
	});

	it('the anchor branch REQUIRES href', () => {
		// @ts-expect-error — `href` is mandatory on the anchor branch.
		const _noHref: AnchorProps = { children: snippet };
		expectTypeOf<AnchorProps['href']>().toEqualTypeOf<string>();
	});

	it('button branch rejects anchor-only attributes', () => {
		// @ts-expect-error — `target` is anchor-only; the button branch rejects it.
		const buttonWithTarget: ButtonProps = { children: snippet, target: '_blank' };
		expectTypeOf(buttonWithTarget.type).toEqualTypeOf<'button' | 'submit' | 'reset' | undefined>();
	});

	it('anchor branch rejects button-only attributes', () => {
		// @ts-expect-error — `form` is button-only; the anchor branch rejects it.
		const anchorWithForm: AnchorProps = { href: '/x', children: snippet, form: 'f' };
		// @ts-expect-error — `type` is button-only too: a link is still a link.
		const _anchorWithType: AnchorProps = { href: '/x', children: snippet, type: 'submit' };
		expectTypeOf(anchorWithForm.href).toEqualTypeOf<string>();
	});

	it('shared state props exist on both branches', () => {
		expectTypeOf<ButtonOrAnchorProps['loading']>().toEqualTypeOf<boolean | undefined>();
		expectTypeOf<ButtonOrAnchorProps['disabled']>().toEqualTypeOf<boolean | undefined>();
		expectTypeOf<ButtonOrAnchorProps['loadingLabel']>().toEqualTypeOf<string | undefined>();
	});

	it('anchor branch carries a VISUAL disabled/loading state (#321)', () => {
		// Anchors never get a native disabled attribute — the branch models the
		// visual state (aria-disabled + reduced styling) instead.
		const props: AnchorProps = { href: '/x', children: snippet, disabled: true, loading: true };
		expectTypeOf(props.disabled).toEqualTypeOf<boolean | undefined>();
		expectTypeOf(props.loading).toEqualTypeOf<boolean | undefined>();
	});
});

describe('Table generic row contract (#321)', () => {
	it('the row type flows from `rows` into the cell renderer', () => {
		const props: TableProps<UserRow> = {
			columns: [{ key: 'name', label: 'Name' }],
			rows: [{ id: 'u1', name: 'Alice', role: 'Dev' }],
			rowKey: 'id',
			children: (context) => {
				expectTypeOf(context.row).toEqualTypeOf<UserRow>();
				expectTypeOf(context.col).toEqualTypeOf<TableColumn>();
				return snippetReturn;
			}
		};
		expectTypeOf(props.rows).toEqualTypeOf<UserRow[]>();
	});

	it('object rows REQUIRE a rowKey — there is no index fallback', () => {
		// @ts-expect-error — object rows without `rowKey` violate the contract.
		const missing: TableProps<UserRow> = {
			columns: [{ key: 'name', label: 'Name' }],
			rows: [{ id: 'u1', name: 'Alice', role: 'Dev' }]
		};
		expectTypeOf(missing.columns).toEqualTypeOf<TableColumn[]>();
	});

	it('rowKey accepts a field name or a typed key function', () => {
		const field: TableProps<UserRow> = { columns: [], rows: [], rowKey: 'id' };
		const fn: TableProps<UserRow> = {
			columns: [],
			rows: [],
			rowKey: (row) => {
				expectTypeOf(row).toEqualTypeOf<UserRow>();
				return row.id;
			}
		};
		expectTypeOf(field.rowKey).toEqualTypeOf<TableRowKey<UserRow>>();
		expectTypeOf(fn.rowKey).toEqualTypeOf<TableRowKey<UserRow>>();
		expectTypeOf<TableRowKey<UserRow>>().toEqualTypeOf<
			'id' | 'name' | 'role' | ((row: UserRow) => string | number)
		>();
	});

	it('primitive rows key on their own value — rowKey must not be passed', () => {
		const primitive: TableProps<string> = { columns: [], rows: ['a', 'b'] };
		// @ts-expect-error — a string row has no field to key on.
		const _withKey: TableProps<string> = { columns: [], rows: ['a'], rowKey: 'id' };
		expectTypeOf(primitive.rows).toEqualTypeOf<string[]>();
		expectTypeOf(primitive.rowKey).toEqualTypeOf<undefined>();
	});

	it('rowKey must accept the row type', () => {
		const mismatched: TableProps<UserRow> = {
			columns: [],
			rows: [],
			// @ts-expect-error — rowKey typed for `number` cannot consume UserRow.
			rowKey: (row: number) => String(row)
		};
		expectTypeOf(mismatched.rows).toEqualTypeOf<UserRow[]>();
	});

	it('caption accepts a string or a snippet', () => {
		const textual: TableProps<UserRow> = { columns: [], rows: [], rowKey: 'id', caption: 'Team' };
		const rich: TableProps<UserRow> = { columns: [], rows: [], rowKey: 'id', caption: snippet };
		expectTypeOf(textual.caption).toEqualTypeOf<string | Snippet | undefined>();
		expectTypeOf(rich.caption).toEqualTypeOf<string | Snippet | undefined>();
	});

	it('table-level attributes stay on the contract (structured table)', () => {
		const props: TableProps<UserRow> = {
			columns: [],
			rows: [],
			rowKey: 'id',
			'aria-label': 'Users',
			id: 'users-table'
		};
		expectTypeOf(props['aria-label']).toEqualTypeOf<string | null | undefined>();
		expectTypeOf(props.id).toEqualTypeOf<string | null | undefined>();
	});
});

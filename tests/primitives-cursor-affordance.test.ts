// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import Checkbox from '../packages/svforge/templates/base/src/lib/components/svforge/primitives/Checkbox.svelte';
import Toggle from '../packages/svforge/templates/base/src/lib/components/svforge/primitives/Toggle.svelte';

/**
 * #594 — the pointer-affordance contract for controls that do NOT go through
 * the shared Button primitive (#591). Skeleton v5 sets `cursor: not-allowed`
 * for disabled controls globally but never `cursor: pointer` for enabled ones,
 * so Checkbox (clickable label) and Switch (control + label) declare both
 * states explicitly.
 *
 * jsdom does not load the Tailwind/Skeleton stylesheet, so this asserts the
 * conditional class contract that produces the real cursor; the generated-app
 * check verifies the computed style end to end.
 */
afterEach(cleanup);

describe('non-Button control affordance (#594)', () => {
	it('checkbox: enabled label is clickable, disabled is not and stays disabled', () => {
		const enabled = render(Checkbox, { props: { label: 'Notify me' } });
		expect(enabled.container.querySelector('label')).toHaveClass('cursor-pointer');

		cleanup();

		const disabled = render(Checkbox, { props: { label: 'Notify me', disabled: true } });
		const label = disabled.container.querySelector('label');
		const input = disabled.container.querySelector('input');
		expect(label).toHaveClass('cursor-not-allowed');
		expect(label).not.toHaveClass('cursor-pointer');
		expect(input).toBeDisabled();
	});

	it('switch: enabled control + label are clickable, disabled advertises nothing', () => {
		const enabled = render(Toggle, { props: { label: 'Dark mode' } });
		expect(enabled.container.querySelector('[data-part="control"]')).toHaveClass('cursor-pointer');
		expect(enabled.container.querySelector('[data-part="label"]')).toHaveClass('cursor-pointer');

		cleanup();

		const disabled = render(Toggle, { props: { label: 'Dark mode', disabled: true } });
		for (const part of ['control', 'label']) {
			const element = disabled.container.querySelector(`[data-part="${part}"]`);
			expect(element).toHaveClass('cursor-not-allowed');
			expect(element).not.toHaveClass('cursor-pointer');
		}
	});
});

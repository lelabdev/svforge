/**
 * Native CLI prompts for the distributed binary.
 * The CLI uses { label, value } choices, but consumers of this prompt port
 * expect the primitive values rather than the choice objects.
 *
 * @typedef {string | {label: string, value: string}} Choice
 */

/** @param {Choice} choice */
function labelOf(choice) {
	return typeof choice === 'string' ? choice : choice.label;
}

/** @param {Choice} choice */
function valueOf(choice) {
	return typeof choice === 'string' ? choice : choice.value;
}

/**
 * @param {(question: string) => Promise<string>} ask
 * @param {(message: string) => void} [log]
 */
export function createCliPrompt(ask, log = console.log) {
	return {
		/** @param {string} message */
		confirm: async (message) => {
			const answer = (await ask(`${message} [y/N] `)).trim().toLowerCase();
			return answer === 'y' || answer === 'yes';
		},
		/** @param {string} message
		 * @param {Choice[]} options
		 */
		select: async (message, options) => {
			if (options.length === 0) throw new Error('Cannot select from an empty list.');
			log(message);
			options.forEach((choice, index) => log(`  ${index + 1}. ${labelOf(choice)}`));
			const answer = Number((await ask('Choose [1]: ')).trim() || '1');
			const selected = Number.isInteger(answer) && answer >= 1 && answer <= options.length ? answer - 1 : 0;
			return valueOf(options[selected]);
		},
		/** @param {string} message
		 * @param {string} [defaultValue]
		 */
		text: async (message, defaultValue) => {
			const answer = (await ask(`${message}${defaultValue ? ` [${defaultValue}]` : ''} `)).trim();
			return answer.length > 0 ? answer : (defaultValue ?? '');
		},
		/** @param {string} message
		 * @param {Choice[]} options
		 */
		multiselect: async (message, options) => {
			log(message);
			options.forEach((choice, index) => log(`  ${index + 1}. ${labelOf(choice)}`));
			const answer = (await ask('Comma-separated numbers (empty = none): ')).trim();
			if (answer.length === 0) return [];
			return answer
				.split(',')
				.map((part) => Number(part.trim()))
				.filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
				.map((n) => valueOf(options[n - 1]));
		}
	};
}

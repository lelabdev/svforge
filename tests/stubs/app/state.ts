// Stub for `$app/state` (#588): template components read the current URL to
// keep the route/query/fragment when switching locale.
export const state = { url: new URL('http://localhost/en/') };

export const page = {
	get url() {
		return state.url;
	}
};

export function __setPageUrl(href: string) {
	state.url = new URL(href);
}

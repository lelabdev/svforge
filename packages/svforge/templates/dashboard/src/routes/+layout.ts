// Dashboard pages depend on per-request sessions, redirects and form actions;
// override the base template's prerender default for the whole route tree.
export const prerender = false;

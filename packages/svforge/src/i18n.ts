/**
 * Scaffolded locales (#239, #547 phase B).
 *
 * The OFFICIAL `sv add paraglide` integration owns the inlang project and the
 * i18n wiring; SVForge only supplies the catalogs (`messages/<locale>.json`)
 * and the FR/EN copy. These constants are the single source for the locales
 * the scaffold requests and for the catalog parity checks.
 */
export const SCAFFOLD_LOCALES = ['fr', 'en'] as const;
export const SCAFFOLD_BASE_LOCALE = SCAFFOLD_LOCALES[0];

/** Non-interactive official Paraglide add-on spec (no demo pages). */
export const PARAGLIDE_ADD_SPEC = `paraglide=languageTags:${SCAFFOLD_LOCALES.join(',')}+demo:no`;

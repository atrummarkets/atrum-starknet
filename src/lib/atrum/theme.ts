/**
 * Theme choice: system, light, or dark.
 *
 * Three states rather than two, because "follow my system" is a real answer and the common
 * two-state toggle silently destroys it — once you have touched the switch there is no way
 * back to tracking the OS, so a laptop that dims at sunset stops doing so.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "atrum-theme";

/**
 * Applied to <html> BEFORE first paint by the inline script in layout.tsx.
 *
 * It has to be inline and synchronous. Anything that runs after hydration paints the default
 * theme first, so a reader who chose light gets a black flash on every navigation — the
 * brighter the theme they picked, the more violent the flash.
 *
 * Kept as a single expression string so what ships is exactly what is reviewed here, rather
 * than whatever a bundler decides to do with a function body it has been asked to stringify.
 */
export const THEME_INIT_SCRIPT = `try{var c=localStorage.getItem("${THEME_KEY}");if(c==="light"||c==="dark")document.documentElement.dataset.theme=c}catch(e){}`;

/** Read the stored choice. Absent, unreadable, or nonsense all mean "follow the system". */
export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Private windows and blocked site data throw on access rather than returning null.
    return "system";
  }
}

/**
 * Write the choice and apply it.
 *
 * "system" REMOVES the attribute rather than setting it to a third value. The CSS resolves
 * the system preference through `prefers-color-scheme` with no attribute present, so leaving
 * one behind would pin the theme to whatever it was when the user asked to stop pinning it.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The theme still applied; it just will not survive a reload. Better than throwing on
    // a click in a private window.
  }
}

/** What "system" currently resolves to, for labelling the control honestly. */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

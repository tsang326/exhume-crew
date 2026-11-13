/**
 * Crew's useTheme().mode is read from `data-theme` on <html>, which carries the colour theme as a
 * prefix (`kiro-dark`, `kiro-light`); only the `emerald` theme gives a bare `dark` / `light`.
 * Anything that is not clearly dark is treated as light.
 */
export function themeMode(raw: string | null | undefined): "dark" | "light" {
  return typeof raw === "string" && /(^|-)dark$/i.test(raw.trim()) ? "dark" : "light";
}

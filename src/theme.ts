export type Theme = "dark" | "light" | "system";
export function applyTheme(value: string) {
  const theme: Theme = ["dark", "light", "system"].includes(value)
    ? (value as Theme)
    : "dark";
  const light =
    theme === "light" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.documentElement.dataset.themePreference = theme;
  try {
    localStorage.setItem("omr-theme", theme);
  } catch {
    /* Private browsing can disallow nonessential theme persistence. */
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", light ? "#f5f7fc" : "#0b1220");
}
export function initializeTheme() {
  let theme = "dark";
  try {
    theme = localStorage.getItem("omr-theme") || "dark";
  } catch {
    /* Use the accessible dark default. */
  }
  applyTheme(theme);
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", () => {
      if (document.documentElement.dataset.themePreference === "system")
        applyTheme("system");
    });
}

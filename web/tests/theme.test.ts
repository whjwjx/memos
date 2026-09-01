import { afterEach, describe, expect, it } from "vitest";
import { loadTheme, THEME_OPTIONS } from "@/utils/theme";

const THEME_STYLE_ID = "instance-theme";

afterEach(() => {
  document.getElementById(THEME_STYLE_ID)?.remove();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.remove();
  localStorage.clear();
});

describe("theme utilities", () => {
  it("exposes GitHub light and dark themes", () => {
    expect(THEME_OPTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "github", label: "GitHub Light" }),
        expect.objectContaining({ value: "github-dark", label: "GitHub Dark" }),
      ]),
    );
  });

  it("loads the GitHub light theme stylesheet", () => {
    loadTheme("github");

    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("memos-theme")).toBe("github");
  });

  it("loads the GitHub dark theme as a dark color scheme", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);

    loadTheme("github-dark");

    expect(document.documentElement.getAttribute("data-theme")).toBe("github-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(meta.content).toBe("#0d1117");
  });
});

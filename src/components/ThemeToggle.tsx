"use client";

/**
 * The theme control. Three states, because "follow my system" is an answer.
 *
 * Rendered as a segmented control rather than a single cycling button: a lone icon that
 * changes meaning on click cannot show you that a third option exists, and cannot show which
 * one is active without you having to reason about whether the icon is the current state or
 * the thing it will switch to. Three labels, one selected, no ambiguity.
 */
import { useEffect, useState } from "react";

import {
  applyThemeChoice,
  readThemeChoice,
  systemPrefersDark,
  type ThemeChoice,
} from "@/lib/atrum/theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  // Starts null, not "system": the stored choice cannot be read during server rendering, and
  // guessing would render one state and then correct it — which is a visible flicker on the
  // one control whose whole job is to not flicker.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  const [systemDark, setSystemDark] = useState(true);

  useEffect(() => {
    setChoice(readThemeChoice());
    setSystemDark(systemPrefersDark());

    // The OS preference can change while the page is open — at sunset, or on a manual flip.
    // Under "Auto" the CSS follows it on its own; this listener exists only to keep the
    // label underneath honest about what Auto currently means.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyThemeChoice(next);
  }

  return (
    <div className="theme-toggle">
      <div className="theme-seg" role="group" aria-label="Colour theme">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="theme-seg-btn"
            // Reserved before the choice is known, so the control does not resize on hydrate.
            aria-pressed={choice === null ? undefined : choice === o.value}
            data-active={choice === o.value ? "true" : undefined}
            onClick={() => pick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {choice === "system" && (
        <span className="theme-hint">
          Following your device — {systemDark ? "dark" : "light"} right now
        </span>
      )}
    </div>
  );
}

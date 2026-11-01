// Field help and Simple/Advanced mode, added to a page after it renders.
//
// - Every field listed in guide.help gets an ⓘ button beside its label that
//   opens a short explanation underneath.
// - Fields listed in guide.advanced are hidden in Simple mode. They keep
//   their values, so results don't change; if any differ from the page's
//   defaults, the mode bar says so and offers to show them.
// The mode is one setting for the whole app.

export interface FieldGuide {
  /** Input name → plain-language help. */
  help: Record<string, string>;
  /** Input names (their labels hide) or CSS selectors, hidden in Simple mode. */
  advanced?: string[];
}

type Mode = "simple" | "advanced";

const MODE_KEY = "rf-toolkit:mode";
const MODE_EVENT = "rf-toolkit:mode-change";
let helpCounter = 0;

export function getMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function setMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage blocked: the mode lasts until the page reloads.
  }
  window.dispatchEvent(new CustomEvent(MODE_EVENT));
}

/** Defaults minus fields the page sets by itself (so they don't read as "changed"). */
export function withoutKeys(values: Record<string, string>, ...keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !keys.includes(k)));
}

const isSelector = (key: string) => /^[.#[]/.test(key);
const controlFor = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`);

/** Wrap the label's leading text (or text element) so a button can sit beside it. */
function labelHead(label: HTMLLabelElement): HTMLElement {
  const existing = label.querySelector<HTMLElement>(":scope > .label-head");
  if (existing) return existing;
  const head = document.createElement("span");
  head.className = "label-head";
  const first = label.firstChild;
  if (first && (first.nodeType === Node.TEXT_NODE || (first instanceof HTMLElement && !first.querySelector("input, select")))) {
    if (first.nodeType === Node.TEXT_NODE) first.textContent = first.textContent?.trim() ?? "";
    label.insertBefore(head, first);
    head.append(first);
  } else {
    label.prepend(head);
  }
  return head;
}

export function enhanceFields(root: HTMLElement, guide: FieldGuide, defaults: Record<string, string> = {}): void {
  // Help buttons.
  for (const [name, text] of Object.entries(guide.help)) {
    const label = controlFor(root, name)?.closest("label");
    if (!label || label.querySelector(":scope > .label-head .help-btn")) continue;
    const head = labelHead(label);
    const id = `field-help-${++helpCounter}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "help-btn";
    button.textContent = "i";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", id);
    button.setAttribute("aria-label", `What is ${head.textContent?.trim() || "this"}?`);
    const help = document.createElement("span");
    help.className = "field-help";
    help.id = id;
    help.hidden = true;
    help.textContent = text;
    head.append(button);
    label.append(help);
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = help.hidden;
      help.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });
  }

  // Simple/Advanced.
  const keys = guide.advanced ?? [];
  if (!keys.length) return;
  const hideable = keys.flatMap((key) =>
    isSelector(key)
      ? [...root.querySelectorAll<HTMLElement>(key)]
      : [controlFor(root, key)?.closest<HTMLElement>("label")].filter((el): el is HTMLElement => !!el),
  );

  const bar = document.createElement("div");
  bar.className = "mode-bar";
  bar.innerHTML = `
    <div class="seg" role="group" aria-label="Fields to show">
      <button type="button" data-mode="simple">Simple</button>
      <button type="button" data-mode="advanced">Advanced</button>
    </div>
    ${root.querySelector(".results") ? '<button type="button" class="secondary jump-btn">Results ↓</button>' : ""}
    <span class="mode-note" hidden></span>`;
  root.prepend(bar);
  bar.querySelector(".jump-btn")?.addEventListener("click", () => root.querySelector(".results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const note = bar.querySelector<HTMLElement>(".mode-note")!;

  const changedAdvanced = () =>
    keys
      .filter((key) => !isSelector(key) && key in defaults)
      .filter((key) => {
        const control = controlFor(root, key);
        return control && control.value !== defaults[key];
      })
      .map((key) => {
        // The label's own words, without the ⓘ button's letter.
        const head = controlFor(root, key)?.closest("label")?.querySelector(".label-head");
        const words = head ? [...head.childNodes].filter((n) => !(n instanceof HTMLElement && n.classList.contains("help-btn"))) : [];
        return words.map((n) => n.textContent).join("").trim() || key;
      });

  const refresh = () => {
    const mode = getMode();
    for (const el of hideable) el.classList.toggle("mode-hidden", mode === "simple");
    for (const b of bar.querySelectorAll<HTMLButtonElement>("button[data-mode]")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    }
    const changed = mode === "simple" ? changedAdvanced() : [];
    note.hidden = !changed.length;
    if (changed.length) {
      note.innerHTML = "";
      note.append(
        `${changed.length} hidden ${changed.length === 1 ? "setting is" : "settings are"} changed from the default and still ${changed.length === 1 ? "applies" : "apply"}: ${changed.join(", ")}. `,
      );
      const show = document.createElement("button");
      show.type = "button";
      show.className = "link-btn";
      show.textContent = "Show them";
      show.addEventListener("click", () => setMode("advanced"));
      note.append(show);
    }
  };

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
    if (b) setMode(b.dataset.mode as Mode);
  });
  // Keep the "changed" note current as values change.
  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);
  const onModeChange = () => {
    if (!root.isConnected) {
      window.removeEventListener(MODE_EVENT, onModeChange);
      return;
    }
    refresh();
  };
  window.addEventListener(MODE_EVENT, onModeChange);
  refresh();
}

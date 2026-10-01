(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.Terminology = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Japanese-first terminology/help layer (#185 F, spec #184 §6). Every technical item is shown as
  // "日本語ラベル / English term ⓘ"; the ⓘ control is a real <button> so its help opens on mouse
  // hover, keyboard focus and touch/tap alike. Unknown keys are shown visibly as unsupported
  // technical items instead of silently leaking a raw internal key as if it were a label.

  const escapeHtml = (value) => `${value}`.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const createTerminology = (dictionary) => {
    if (dictionary?.schemaVersion !== "1" || dictionary?.kind !== "browser-pack-terminology" || typeof dictionary.terms !== "object") {
      throw new TypeError("Unsupported terminology dictionary");
    }
    const terms = dictionary.terms;

    /** Label record for a key; unknown keys come back flagged `unsupported`. */
    const term = (key) => {
      const entry = Object.prototype.hasOwnProperty.call(terms, key) ? terms[key] : null;
      if (entry) return { key, ja: entry.ja, en: entry.en, short: entry.short, long: entry.long ?? null, unsupported: false };
      return { key, ja: "未対応の項目", en: key, short: "この項目の説明はまだ用意されていません（内部名をそのまま表示しています）。", long: null, unsupported: true };
    };

    let counter = 0;
    /**
     * Accessible label HTML. The help button carries `aria-describedby` to a role="tooltip" node; the
     * UI toggles `data-open` on hover, focus and click/tap (see `bindHelp`).
     */
    const labelHtml = (key, options = {}) => {
      const t = term(key);
      counter += 1;
      const id = `${options.idPrefix ?? "help"}-${counter}`;
      return `<span class="term${t.unsupported ? " term-unsupported" : ""}" data-term="${escapeHtml(key)}">`
        + `<span class="term-ja">${escapeHtml(t.ja)}</span>`
        + `<span class="term-sep"> / </span><span class="term-en" lang="en">${escapeHtml(t.en)}</span>`
        + `<button type="button" class="term-help" aria-label="${escapeHtml(`${t.ja}の説明`)}" aria-describedby="${id}" aria-expanded="false">ⓘ</button>`
        + `<span class="term-tip" role="tooltip" id="${id}" hidden>${escapeHtml(t.short)}${t.long ? `<br>${escapeHtml(t.long)}` : ""}</span>`
        + `</span>`;
    };

    /** Attach hover/focus/tap behaviour to every help button under `container`. */
    const bindHelp = (container) => {
      const set = (button, open) => {
        const tip = button.nextElementSibling;
        if (!tip) return;
        tip.hidden = !open;
        button.setAttribute("aria-expanded", open ? "true" : "false");
      };
      for (const button of container.querySelectorAll(".term-help")) {
        if (button.dataset.bound === "1") continue;
        button.dataset.bound = "1";
        button.addEventListener("mouseenter", () => set(button, true));
        button.addEventListener("mouseleave", () => { if (button.dataset.pinned !== "1") set(button, false); });
        button.addEventListener("focus", () => set(button, true));
        button.addEventListener("blur", () => { button.dataset.pinned = "0"; set(button, false); });
        // tap/click pins the help open (touch has no hover); a second tap closes it
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const pinned = button.dataset.pinned === "1";
          button.dataset.pinned = pinned ? "0" : "1";
          set(button, !pinned);
        });
        button.addEventListener("keydown", (event) => { if (event.key === "Escape") { button.dataset.pinned = "0"; set(button, false); } });
      }
    };

    const valueLabel = (group, value) => term(`${group}.${value}`);

    return { term, labelHtml, bindHelp, valueLabel, keys: () => Object.keys(terms).sort() };
  };

  return { createTerminology, escapeHtml };
});

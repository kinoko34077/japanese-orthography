(function (root, factory) {
  const terminology = typeof module === "object" && module.exports ? require("./terminology.js") : root.Terminology;
  const api = factory(terminology);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyPlayground = api;
  if (typeof document !== "undefined" && typeof module === "undefined") api.boot(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Terminology) {
  "use strict";

  // Diagnostic Pages UI (#185 G). Rendering is a set of pure string functions (testable without a
  // DOM); `boot` wires them to the page and to the transform worker. Copy always uses the worker's
  // plain `renderedText`, so highlight markup and diagnostic labels can never enter copied text.

  const { escapeHtml } = Terminology;
  const CERTAINTY_CLASS = { unique: "diag-unique", conditional: "diag-conditional", unresolved: "diag-unresolved" };
  const CERTAINTY_TEXT = { unique: "✓ 一意確定", conditional: "◆ 条件付き確定", unresolved: "! 未解決" };

  /**
   * Result HTML: rendered text with one focusable, labelled element per diagnostic span. With
   * `inspect` (辞書情報表示, #196 H) recognized-but-unchanged units are also focusable, with a
   * neutral affordance that carries no certainty colour.
   */
  const renderResultHtml = (result, options = {}) => {
    let html = "";
    let at = 0;
    const text = result.renderedText;
    const marks = [
      ...result.spans.map((span) => ({ kind: "span", item: span })),
      ...(options.inspect ? (result.units ?? []).map((unit) => ({ kind: "unit", item: unit })) : [])
    ].sort((a, b) => a.item.renderedStart - b.item.renderedStart);
    for (const { kind, item } of marks) {
      if (item.renderedStart < at) continue;
      html += escapeHtml(text.slice(at, item.renderedStart));
      const body = escapeHtml(text.slice(item.renderedStart, item.renderedEnd));
      if (kind === "span") {
        const label = `${CERTAINTY_TEXT[item.certainty]}：「${item.sourceText}」→「${item.renderedText}」`;
        html += `<mark class="diag ${CERTAINTY_CLASS[item.certainty]}" role="button" tabindex="0" aria-pressed="false"`
          + ` data-ref="${escapeHtml(item.detailRef)}" data-certainty="${item.certainty}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${body}</mark>`;
      } else {
        const label = `辞書情報：「${item.sourceText}」（${item.resolved ? "語が確定" : `候補 ${item.candidateCount} 件`}・変更なし）`;
        html += `<span class="diag lexeme" role="button" tabindex="0" aria-pressed="false" data-ref="${escapeHtml(item.detailRef)}"`
          + ` aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${body}</span>`;
      }
      at = item.renderedEnd;
    }
    html += escapeHtml(text.slice(at));
    return html || '<p class="muted">（結果は空です）</p>';
  };

  const renderSummaryHtml = (result) => {
    const c = result.counts ?? { unique: 0, conditional: 0, unresolved: 0 };
    return [
      `<span class="count diag-unique">✓ 一意確定 ${c.unique}</span>`,
      `<span class="count diag-conditional">◆ 条件付き確定 ${c.conditional}</span>`,
      `<span class="count diag-unresolved">! 未解決 ${c.unresolved}</span>`,
      `<span class="muted">語の候補 ${result.lexicalMatchCount ?? 0} 件を確認</span>`
    ].join("");
  };

  const list = (values, render = (v) => `<code>${escapeHtml(v)}</code>`) =>
    values && values.length ? `<ul>${values.map((v) => `<li>${render(v)}</li>`).join("")}</ul>` : '<span class="muted">なし</span>';

  const renderCandidate = (terms, c) => {
    const parts = [`<strong>${escapeHtml(c.output)}</strong>`];
    if (c.reason) parts.push(`理由: ${terms.labelHtml(`reason.${c.reason}`)}`);
    if (c.basis) parts.push(`方法: ${escapeHtml(terms.term(`basis.${c.basis}`).ja)}`);
    if (c.authority) parts.push(`根拠: ${escapeHtml(terms.term(`authority.${c.authority}`).ja)}`);
    if (c.fact?.id) parts.push(`事実: <code>${escapeHtml(c.fact.id)}</code>${c.fact.sourceCandidate ? "（出典上の別案）" : ""}`);
    if (c.rule?.id) parts.push(`規則: <code>${escapeHtml(c.rule.id)}</code>`);
    if (c.provenance) parts.push(`出典: ${(c.provenance.sourceRefs ?? []).map((s) => `<code>${escapeHtml(s)}</code>`).join(" ")}`);
    if (c.evidence?.programCount > c.evidence.programs.length) parts.push(`Program証拠: ${c.evidence.programs.length}/${c.evidence.programCount} 件（追加取得可能）`);
    return parts.join("<br>");
  };

  /** Detail inspector HTML, every field labelled Japanese-first via the terminology layer. */
  const renderDetailHtml = (terms, detail) => {
    const row = (key, value) => `<dt>${terms.labelHtml(key)}</dt><dd>${value}</dd>`;
    const certainty = terms.term(`certainty.${detail.certainty}`);
    return `<p><span class="badge ${CERTAINTY_CLASS[detail.certainty]}">${escapeHtml(certainty.ja)}</span> `
      + `「${escapeHtml(detail.sourceText)}」→「${escapeHtml(detail.renderedText)}」</p>`
      + `<p class="muted">${escapeHtml(certainty.short)}</p>`
      + "<dl>"
      + row("status", escapeHtml(terms.term(`status.${detail.status}`).ja))
      + row("lexicalIdentity", detail.lexicalIdentity ? `<code>${escapeHtml(detail.lexicalIdentity)}</code>` : '<span class="muted">一つに決まりません</span>')
      + row("lexicalCandidates", list(detail.lexicalCandidates))
      + row("readings", `現代: ${detail.readings.modern.length ? detail.readings.modern.map(escapeHtml).join("、") : "—"}<br>歴史的: ${detail.readings.historical.length ? detail.readings.historical.map(escapeHtml).join("、") : "—"}`)
      + row("morphologyContext", escapeHtml(detail.morphologyContext.note))
      + row("basis", detail.basis ? escapeHtml(terms.term(`basis.${detail.basis}`).ja) : '<span class="muted">なし</span>')
      + row("authority", escapeHtml(terms.term(`authority.${detail.authority}`).ja))
      + row("ruleChain", list(detail.ruleChain))
      + row("acceptedCandidates", list(detail.acceptedCandidates, (c) => renderCandidate(terms, c)))
      + row("rejectedCandidates", list(detail.rejectedCandidates, (c) => renderCandidate(terms, c)))
      + row("reasonCode", list(detail.reasonCodes, (r) => terms.labelHtml(`reason.${r}`)))
      + row("retainedDistinctions", Object.keys(detail.retainedDistinctions).length ? list(Object.entries(detail.retainedDistinctions).map(([k, v]) => `${k}: ${v}`)) : '<span class="muted">なし</span>')
      + row("provenance", `${escapeHtml(terms.term("provenance.sourceRefs").ja)}: ${list(detail.provenance.sourceRefs)}${escapeHtml(terms.term("provenance.evidenceRefs").ja)}: ${list(detail.provenance.evidenceRefs)}`)
      + row("compatibilityAgreement", escapeHtml(detail.compatibilityAgreement.note))
      + row("profileEffects", `${escapeHtml(terms.term(`profile.${detail.profileEffects.profileId}`).ja)}（時代: ${escapeHtml(detail.profileEffects.period ?? "—")}）`)
      + row("range", `原文 ${detail.range.start}–${detail.range.end} / 結果 ${detail.range.renderedStart}–${detail.range.renderedEnd}`)
      + "</dl>";
  };

  /** Inspector for a recognized unit (#196 H): what the dictionary knows, even when nothing changed. */
  const renderUnitDetailHtml = (terms, detail) => {
    const row = (key, value) => `<dt>${terms.labelHtml(key)}</dt><dd>${value}</dd>`;
    const yesNo = (v) => (v ? "はい" : "いいえ");
    const r = detail.recognition;
    const morph = detail.morphologyContext;
    const lexemeHtml = (l) => `<code>${escapeHtml(l.lexicalIdentity)}</code>`
      + `<br>${escapeHtml(terms.term("lexicalForms").ja)}: ${l.forms.length ? l.forms.map((f) => `${escapeHtml(f.surface)}${f.flags.filter((x) => x !== "listed").map((x) => `<span class="hint">［${escapeHtml(terms.term(`formFlag.${x}`).ja)}］</span>`).join("")}`).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("readings.modern").ja)}: ${l.readings.modern.length ? l.readings.modern.map(escapeHtml).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("readings.historical").ja)}: ${l.readings.historical.length ? l.readings.historical.map((h) => `${escapeHtml(h.surface ?? "")}《${escapeHtml(h.reading)}》${h.route ? `（${escapeHtml(terms.term(`route.${h.route}`).ja)}）` : ""}`).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("morphology").ja)}: ${l.morphology.length ? l.morphology.map((m) => escapeHtml([m.partOfSpeech.join("・"), m.conjugationType, m.conjugationForm].filter(Boolean).join(" / "))).join("；") : "—"}`;
    return `<p><span class="badge lexeme">${escapeHtml(terms.term("recognition.recognized").ja)}</span> 「${escapeHtml(detail.sourceText)}」</p>`
      + `<p class="muted">${escapeHtml(terms.term("recognition").short)}</p>`
      + "<dl>"
      + row("recognition", `${escapeHtml(terms.term("recognition.resolved").ja)}: ${yesNo(r.resolved)} ／ ${escapeHtml(terms.term("recognition.changed").ja)}: ${yesNo(r.changed)}`)
      + row("lexicalIdentity", detail.lexicalIdentity ? `<code>${escapeHtml(detail.lexicalIdentity)}</code>` : '<span class="muted">一つに決まりません</span>')
      + row("lexicalCandidates", list(detail.lexemes, (l) => lexemeHtml(l)))
      + row("readings", detail.reading ? escapeHtml(detail.reading) : '<span class="muted">一つに決まりません</span>')
      + row("morphologyContext", morph.available ? escapeHtml([morph.partOfSpeech.join("・"), morph.conjugationType, morph.conjugationForm].filter(Boolean).join(" / ")) : escapeHtml(morph.note))
      + row("inflection", detail.inflection ? `${escapeHtml(detail.inflection.baseSurface)}（${escapeHtml(detail.inflection.conjugationForm)}）` : '<span class="muted">なし</span>')
      + row("candidates", list(detail.candidateForms))
      + row("readings.historical", detail.historical?.kana ? escapeHtml(detail.historical.kana) : '<span class="muted">なし</span>')
      + row("provenance", `${escapeHtml(terms.term("provenance.sourceRefs").ja)}: ${list(detail.provenance.sourceRefs)}${escapeHtml(terms.term("provenance.evidenceRefs").ja)}: ${list(detail.provenance.evidenceRefs)}`)
      + row("profileEffects", `${escapeHtml(terms.term(`profile.${detail.profileEffects.profileId}`).ja)}（時代: ${escapeHtml(detail.profileEffects.period ?? "—")}）`)
      + row("renderMode", escapeHtml(terms.term(`renderMode.${detail.renderMode}`).ja))
      + row("range", `原文 ${detail.range.start}–${detail.range.end}`)
      + "</dl>";
  };

  const renderPolicyHtml = (terms, policySection, profileId) => {
    const p = policySection?.policy ?? {};
    return `<dl><dt>プロファイル</dt><dd>${escapeHtml(terms.term(`profile.${profileId}`).ja)} — ${escapeHtml(terms.term(`profile.${profileId}`).short)}</dd>`
      + `<dt>対象の時代</dt><dd>${escapeHtml(p.period ?? "—")}</dd>`
      + `<dt>無効にしている規則</dt><dd>${(p.disabledRuleIds ?? []).length ? (p.disabledRuleIds ?? []).map((r) => `<code>${escapeHtml(r)}</code>`).join(" ") : "なし"}</dd></dl>`
      + '<p class="muted">この版では、プロファイルの切り替えで規則の使い分けを行います（個別の規則の切り替えは今後対応予定です）。</p>';
  };

  /** Text placed on the clipboard: the plain converted text only. */
  const copyText = (result) => result.renderedText;

  // ---- page wiring --------------------------------------------------------------------------------
  const boot = (win) => {
    const doc = win.document;
    const $ = (id) => doc.getElementById(id);
    const status = (text, kind = "info", retry = null) => {
      const el = $("status");
      el.className = `status${kind === "error" ? " error" : ""}`;
      el.textContent = text;
      if (retry) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = "再読み込み";
        button.addEventListener("click", retry);
        el.appendChild(button);
      }
    };
    let terms = null;
    let client = null;
    let current = null;
    let selected = null;

    const profile = () => doc.querySelector('input[name="profile"]:checked').value;
    const renderMode = () => {
      const checked = doc.querySelector('input[name="renderMode"]:checked');
      return checked && !checked.disabled && !$("render-modes").hidden ? checked.value : "plain";
    };
    const manifestUrl = new URL("browser-pack/manifest.json", win.location.href).href;

    const showDetail = async (ref, el) => {
      if (!current) return;
      if (selected) selected.setAttribute("aria-pressed", "false");
      selected = el;
      el.setAttribute("aria-pressed", "true");
      const panel = $("detail");
      panel.hidden = false;
      $("detail-body").innerHTML = '<p class="muted">詳細を読み込み中…</p>';
      try {
        const reply = await client.detail(current.requestId, ref);
        $("detail-body").innerHTML = reply.detail.kind === "unit" ? renderUnitDetailHtml(terms, reply.detail) : renderDetailHtml(terms, reply.detail);
        terms.bindHelp($("detail-body"));
      } catch (error) {
        $("detail-body").innerHTML = `<p class="muted">詳細を表示できませんでした: ${escapeHtml(error.message)}</p>`;
      }
    };

    const convert = async () => {
      const text = $("source").value;
      status("変換中…");
      try {
        const reply = await client.transform(text, profile(), renderMode());
        if (reply.stale) return;
        current = reply;
        $("result").innerHTML = renderResultHtml(reply.result, { inspect: $("inspect")?.checked });
        $("summary").innerHTML = renderSummaryHtml(reply.result);
        $("copy").disabled = false;
        $("detail").hidden = true;
        status(`変換しました（${reply.elapsedMs} ms）。`);
      } catch (error) {
        status(`変換できませんでした: ${error.message}`, "error", recover);
      }
    };

    const loadPolicy = async () => {
      try {
        const reply = await client.open();
        const manifest = await (await win.fetch(manifestUrl, { cache: "no-cache" })).json();
        const profileSection = manifest.sections.find((s) => s.kind === "profile-policy" && s.profileId === profile());
        const policy = profileSection ? await (await win.fetch(new URL(profileSection.path, manifestUrl))).json() : null;
        pruneCache(manifest);
        // output format (Ruby) is shown only when the pack's engine supports it (#196 E)
        const modes = reply.renderModes ?? ["plain"];
        $("render-modes").hidden = modes.length < 2;
        for (const radio of doc.querySelectorAll('input[name="renderMode"]')) radio.disabled = !modes.includes(radio.value);
        $("policy").innerHTML = renderPolicyHtml(terms, policy, profile());
        terms.bindHelp($("policy"));
        status(`準備完了（辞書 ${reply.packDigest.slice(0, 12)}…）。文章を入力して「変換」を押してください。`);
        return true;
      } catch (error) {
        status(`辞書データを読み込めませんでした: ${error.message}`, "error", recover);
        return false;
      }
    };

    // Service worker (#185 H): only site files and content-addressed pack sections are cached;
    // text typed by the user is never stored.
    const sw = win.navigator.serviceWorker;
    const pruneCache = (manifest) => {
      const base = new URL(manifestUrl, win.location.href);
      const keep = manifest.sections.map((s) => { const u = new URL(s.path, base); u.searchParams.set("v", s.sha256); return u.href; });
      sw?.controller?.postMessage({ type: "prune", keep });
    };
    const clearCache = async () => {
      try {
        if (win.caches) for (const name of await win.caches.keys()) await win.caches.delete(name);
        status("キャッシュを消去しました。辞書データを再取得します。");
        await recover();
      } catch (error) {
        status(`キャッシュを消去できませんでした: ${error.message}`, "error");
      }
    };
    if (sw && win.location.protocol !== "file:") sw.register("sw.js").catch(() => { /* caching is optional */ });
    $("clear-cache")?.addEventListener("click", clearCache);

    const recover = async () => {
      client.restart();
      if (await loadPolicy()) await convert();
    };

    const start = async () => {
      try {
        const dictionary = await (await win.fetch(new URL("terminology-ja.json", win.location.href), { cache: "no-cache" })).json();
        terms = Terminology.createTerminology(dictionary);
      } catch (error) {
        status(`用語集を読み込めませんでした: ${error.message}`, "error", () => win.location.reload());
        return;
      }
      client = win.WorkerClient.createWorkerClient({ createWorker: () => new win.Worker("runtime/browser-transform-worker.js"), manifestUrl });
      if (await loadPolicy()) await convert();
    };

    $("convert").addEventListener("click", convert);
    $("inspect")?.addEventListener("change", () => {
      if (current) $("result").innerHTML = renderResultHtml(current.result, { inspect: $("inspect").checked });
    });
    for (const radio of doc.querySelectorAll('input[name="renderMode"]')) radio.addEventListener("change", () => convert());
    for (const radio of doc.querySelectorAll('input[name="profile"]')) radio.addEventListener("change", () => { loadPolicy().then((ok) => ok && convert()); });
    let timer = null;
    $("source").addEventListener("input", () => {
      if (!$("auto").checked) return;
      win.clearTimeout(timer);
      timer = win.setTimeout(convert, 400);
    });
    $("copy").addEventListener("click", async () => {
      if (!current) return;
      try {
        await win.navigator.clipboard.writeText(copyText(current.result));
        status("変換結果（プレーンテキスト）をコピーしました。");
      } catch {
        status("コピーできませんでした。結果を選択して手動でコピーしてください。", "error");
      }
    });
    const activate = (event) => {
      const el = event.target.closest?.(".diag[data-ref]");
      if (!el) return;
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showDetail(el.dataset.ref, el);
    };
    $("result").addEventListener("click", activate);
    $("result").addEventListener("keydown", activate);
    $("detail-close").addEventListener("click", () => {
      $("detail").hidden = true;
      if (selected) { selected.setAttribute("aria-pressed", "false"); selected.focus(); }
    });
    doc.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("detail").hidden) $("detail-close").click(); });
    start();
  };

  return { renderResultHtml, renderSummaryHtml, renderDetailHtml, renderPolicyHtml, renderUnitDetailHtml, copyText, boot, CERTAINTY_TEXT };
});

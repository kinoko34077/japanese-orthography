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

  // Pages v2 (#277): 通常利用のclean resultを主表示とし、診断と技術情報は必要時だけ開く。
  // Copyは常にWorkerのrenderedTextだけを使用し、表示用markupや診断labelを混入させない。

  const { escapeHtml } = Terminology;
  const CERTAINTY_CLASS = { unique: "diag-unique", conditional: "diag-conditional", unresolved: "diag-unresolved" };
  const CERTAINTY_TEXT = { unique: "✓ 一意確定", conditional: "◆ 条件付き確定", unresolved: "! 未解決" };
  const RENDER_MODE_MAP = {
    none: { implicit: "plain", explicit: "plain" },
    whole: { implicit: "ruby-whole-implicit", explicit: "ruby-whole-explicit" },
    components: { implicit: "ruby-components-implicit", explicit: "ruby-components-explicit" }
  };

  const renderModeFromControls = (target, notation) => {
    if (!Object.prototype.hasOwnProperty.call(RENDER_MODE_MAP, target)) {
      throw new RangeError(`unknown Ruby target ${target}`);
    }
    if (!["implicit", "explicit"].includes(notation)) {
      throw new RangeError(`unknown Ruby notation ${notation}`);
    }
    return RENDER_MODE_MAP[target][notation];
  };

  const readBrowserCacheState = async (win) => {
    const online = win?.navigator?.onLine !== false;
    if (!win?.caches || typeof win.caches.open !== "function") {
      return { available: false, online, sectionCount: 0, reuse: false };
    }
    try {
      const cache = await win.caches.open("browser-pack-sections");
      const keys = typeof cache.keys === "function" ? await cache.keys() : [];
      const sectionCount = Array.isArray(keys) ? keys.length : 0;
      return { available: true, online, sectionCount, reuse: sectionCount > 0 };
    } catch {
      return { available: false, online, sectionCount: 0, reuse: false };
    }
  };

  const renderResultHtml = (result, options = {}) => {
    const text = result.renderedText ?? "";
    if (!options.diagnostic) {
      return text ? escapeHtml(text) : '<p class="muted">（結果は空です）</p>';
    }

    let html = "";
    let at = 0;
    const marks = [
      ...(result.spans ?? []).map((span) => ({ kind: "span", item: span })),
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

  const renderSummaryHtml = (result, options = {}) => {
    const c = result.counts ?? { unique: 0, conditional: 0, unresolved: 0 };
    if (options.diagnostic) {
      return [
        `<span class="count diag-unique">✓ 一意確定 ${c.unique}</span>`,
        `<span class="count diag-conditional">◆ 条件付き確定 ${c.conditional}</span>`,
        `<span class="count diag-unresolved">! 未解決 ${c.unresolved}</span>`,
        `<span class="muted">認識候補 ${result.lexicalMatchCount ?? 0} 件</span>`
      ].join("");
    }
    const changed = (result.spans ?? []).filter((span) => span.changed).length;
    return [
      `<span class="count count-neutral">変換 ${changed}</span>`,
      `<span class="count count-warning">条件付き ${c.conditional}</span>`,
      `<span class="count${c.unresolved ? " count-alert" : " count-neutral"}">未解決 ${c.unresolved}</span>`
    ].join("");
  };

  const list = (values, render = (v) => `<code>${escapeHtml(v)}</code>`) =>
    values && values.length ? `<ul>${values.map((v) => `<li>${render(v)}</li>`).join("")}</ul>` : '<span class="muted">なし</span>';

  const renderCandidate = (terms, candidate) => {
    const parts = [`<strong>${escapeHtml(candidate.output)}</strong>`];
    if (candidate.reason) parts.push(`理由: ${terms.labelHtml(`reason.${candidate.reason}`)}`);
    if (candidate.basis) parts.push(`方法: ${escapeHtml(terms.term(`basis.${candidate.basis}`).ja)}`);
    if (candidate.authority) parts.push(`根拠: ${escapeHtml(terms.term(`authority.${candidate.authority}`).ja)}`);
    if (candidate.fact?.id) parts.push(`事実: <code>${escapeHtml(candidate.fact.id)}</code>${candidate.fact.sourceCandidate ? "（出典上の別案）" : ""}`);
    if (candidate.rule?.id) parts.push(`規則: <code>${escapeHtml(candidate.rule.id)}</code>`);
    if (candidate.provenance) parts.push(`出典: ${(candidate.provenance.sourceRefs ?? []).map((s) => `<code>${escapeHtml(s)}</code>`).join(" ")}`);
    if (candidate.evidence && candidate.evidence.programCount > candidate.evidence.programs.length) {
      parts.push(`Program証拠: ${candidate.evidence.programs.length}/${candidate.evidence.programCount} 件（追加取得可能）`);
    }
    return parts.join("<br>");
  };

  const renderDetailHtml = (terms, detail) => {
    const row = (key, value) => `<dt>${terms.labelHtml(key)}</dt><dd>${value}</dd>`;
    const certainty = terms.term(`certainty.${detail.certainty}`);
    const modern = detail.readings?.modern?.length ? detail.readings.modern.map(escapeHtml).join("、") : "—";
    const historical = detail.readings?.historical?.length ? detail.readings.historical.map(escapeHtml).join("、") : "—";

    const overview = `<div class="detail-overview">`
      + `<p><span class="badge ${CERTAINTY_CLASS[detail.certainty]}">${escapeHtml(certainty.ja)}</span> `
      + `「${escapeHtml(detail.sourceText)}」→「${escapeHtml(detail.renderedText)}」</p>`
      + `<p class="muted">${escapeHtml(certainty.short)}</p>`
      + "<dl>"
      + row("status", escapeHtml(terms.term(`status.${detail.status}`).ja))
      + row("readings", `現代: ${modern}<br>歴史的: ${historical}`)
      + "</dl></div>";

    const diagnostics = `<details class="detail-diagnostics" open><summary>診断情報</summary><dl>`
      + row("morphologyContext", escapeHtml(detail.morphologyContext.note))
      + row("basis", detail.basis ? escapeHtml(terms.term(`basis.${detail.basis}`).ja) : '<span class="muted">なし</span>')
      + row("authority", escapeHtml(terms.term(`authority.${detail.authority}`).ja))
      + row("acceptedCandidates", list(detail.acceptedCandidates, (candidate) => renderCandidate(terms, candidate)))
      + row("rejectedCandidates", list(detail.rejectedCandidates, (candidate) => renderCandidate(terms, candidate)))
      + row("reasonCode", list(detail.reasonCodes, (reason) => terms.labelHtml(`reason.${reason}`)))
      + "</dl></details>";

    const technical = `<details class="detail-technical"><summary>技術情報</summary><dl>`
      + row("lexicalIdentity", detail.lexicalIdentity ? `<code>${escapeHtml(detail.lexicalIdentity)}</code>` : '<span class="muted">一つに決まりません</span>')
      + row("lexicalCandidates", list(detail.lexicalCandidates))
      + row("ruleChain", list(detail.ruleChain))
      + row("retainedDistinctions", Object.keys(detail.retainedDistinctions ?? {}).length
        ? list(Object.entries(detail.retainedDistinctions).map(([key, value]) => `${key}: ${value}`))
        : '<span class="muted">なし</span>')
      + row("provenance", `${escapeHtml(terms.term("provenance.sourceRefs").ja)}: ${list(detail.provenance.sourceRefs)}`
        + `${escapeHtml(terms.term("provenance.evidenceRefs").ja)}: ${list(detail.provenance.evidenceRefs)}`)
      + row("compatibilityAgreement", escapeHtml(detail.compatibilityAgreement.note))
      + row("profileEffects", `${escapeHtml(terms.term(`profile.${detail.profileEffects.profileId}`).ja)}（時代: ${escapeHtml(detail.profileEffects.period ?? "—")}）`)
      + row("range", `原文 ${detail.range.start}–${detail.range.end} / 結果 ${detail.range.renderedStart}–${detail.range.renderedEnd}`)
      + "</dl></details>";

    return overview + diagnostics + technical;
  };

  const renderUnitDetailHtml = (terms, detail) => {
    const row = (key, value) => `<dt>${terms.labelHtml(key)}</dt><dd>${value}</dd>`;
    const yesNo = (value) => (value ? "はい" : "いいえ");
    const recognition = detail.recognition;
    const morph = detail.morphologyContext;
    const lexemeHtml = (lexeme) => `<code>${escapeHtml(lexeme.lexicalIdentity)}</code>`
      + `<br>${escapeHtml(terms.term("lexicalForms").ja)}: ${lexeme.forms.length ? lexeme.forms.map((form) => `${escapeHtml(form.surface)}${form.flags.filter((flag) => flag !== "listed").map((flag) => `<span class="hint">［${escapeHtml(terms.term(`formFlag.${flag}`).ja)}］</span>`).join("")}`).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("readings.modern").ja)}: ${lexeme.readings.modern.length ? lexeme.readings.modern.map(escapeHtml).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("readings.historical").ja)}: ${lexeme.readings.historical.length ? lexeme.readings.historical.map((historical) => `${escapeHtml(historical.surface ?? "")}《${escapeHtml(historical.reading)}》${historical.route ? `（${escapeHtml(terms.term(`route.${historical.route}`).ja)}）` : ""}`).join("、") : "—"}`
      + `<br>${escapeHtml(terms.term("morphology").ja)}: ${lexeme.morphology.length ? lexeme.morphology.map((item) => escapeHtml([item.partOfSpeech.join("・"), item.conjugationType, item.conjugationForm].filter(Boolean).join(" / "))).join("；") : "—"}`;

    const overview = `<div class="detail-overview"><p><span class="badge lexeme">${escapeHtml(terms.term("recognition.recognized").ja)}</span> 「${escapeHtml(detail.sourceText)}」</p>`
      + `<p class="muted">${escapeHtml(terms.term("recognition").short)}</p><dl>`
      + row("recognition", `${escapeHtml(terms.term("recognition.resolved").ja)}: ${yesNo(recognition.resolved)} ／ ${escapeHtml(terms.term("recognition.changed").ja)}: ${yesNo(recognition.changed)}`)
      + row("readings", detail.reading ? escapeHtml(detail.reading) : '<span class="muted">一つに決まりません</span>')
      + row("readings.historical", detail.historical?.kana ? escapeHtml(detail.historical.kana) : '<span class="muted">なし</span>')
      + "</dl></div>";

    const diagnostics = `<details class="detail-diagnostics" open><summary>辞書・診断情報</summary><dl>`
      + row("lexicalCandidates", list(detail.lexemes, (lexeme) => lexemeHtml(lexeme)))
      + row("morphologyContext", morph.available ? escapeHtml([morph.partOfSpeech.join("・"), morph.conjugationType, morph.conjugationForm].filter(Boolean).join(" / ")) : escapeHtml(morph.note))
      + row("inflection", detail.inflection ? `${escapeHtml(detail.inflection.baseSurface)}（${escapeHtml(detail.inflection.conjugationForm)}）` : '<span class="muted">なし</span>')
      + row("candidates", list(detail.candidateForms))
      + "</dl></details>";

    const technical = `<details class="detail-technical"><summary>技術情報</summary><dl>`
      + row("lexicalIdentity", detail.lexicalIdentity ? `<code>${escapeHtml(detail.lexicalIdentity)}</code>` : '<span class="muted">一つに決まりません</span>')
      + row("provenance", `${escapeHtml(terms.term("provenance.sourceRefs").ja)}: ${list(detail.provenance.sourceRefs)}`
        + `${escapeHtml(terms.term("provenance.evidenceRefs").ja)}: ${list(detail.provenance.evidenceRefs)}`)
      + row("profileEffects", `${escapeHtml(terms.term(`profile.${detail.profileEffects.profileId}`).ja)}（時代: ${escapeHtml(detail.profileEffects.period ?? "—")}）`)
      + row("renderMode", escapeHtml(terms.term(`renderMode.${detail.renderMode}`).ja))
      + row("range", `原文 ${detail.range.start}–${detail.range.end}`)
      + "</dl></details>";

    return overview + diagnostics + technical;
  };

  const renderPolicyHtml = (terms, policySection, profileId) => {
    const policy = policySection?.policy ?? {};
    return `<dl><dt>プロファイル</dt><dd>${escapeHtml(terms.term(`profile.${profileId}`).ja)} — ${escapeHtml(terms.term(`profile.${profileId}`).short)}</dd>`
      + `<dt>対象の時代</dt><dd>${escapeHtml(policy.period ?? "—")}</dd>`
      + `<dt>無効にしている規則</dt><dd>${(policy.disabledRuleIds ?? []).length ? (policy.disabledRuleIds ?? []).map((rule) => `<code>${escapeHtml(rule)}</code>`).join(" ") : "なし"}</dd></dl>`
      + '<p class="muted">プロファイルで変換方針を切り替えます。個別規則の手動選択は行いません。</p>';
  };

  const renderEngineInfoHtml = ({ manifest, openReply, result, elapsedMs, cacheState }) => {
    const compilerVersion = manifest?.compilerVersion ?? "—";
    const digest = openReply?.packDigest ? `${openReply.packDigest.slice(0, 12)}…` : "—";
    const mode = result?.executionMode ?? null;
    const engine = mode === "vm-authoritative" ? "Rule Program VM"
      : mode === "parity" ? "Parity検証"
        : mode === "legacy-only" ? "Legacy互換" : "変換後に表示";
    const modes = openReply?.renderModes?.length ? openReply.renderModes.join(" / ") : "plain";
    const startupSections = Number(openReply?.stats?.sectionsLoaded ?? 0);
    const startupBytes = Number(openReply?.stats?.bytesLoaded ?? 0);
    const online = cacheState?.online !== false ? "オンライン" : "オフライン";
    const cache = !cacheState?.available
      ? "利用状況を取得できません"
      : cacheState.reuse
        ? `再利用候補 ${cacheState.sectionCount} section`
        : "初回状態 / 0 section";
    return `<dl><dt>実行パック</dt><dd>BrowserPack v${escapeHtml(compilerVersion)}</dd>`
      + `<dt>辞書ID</dt><dd><code>${escapeHtml(digest)}</code></dd>`
      + `<dt>実行エンジン</dt><dd>${escapeHtml(engine)}</dd>`
      + `<dt>接続状態</dt><dd>${online}</dd>`
      + `<dt>端末キャッシュ</dt><dd>${escapeHtml(cache)}</dd>`
      + `<dt>起動時ロード</dt><dd>起動時 ${startupSections.toLocaleString("ja-JP")} section / ${startupBytes.toLocaleString("ja-JP")} byte</dd>`
      + `<dt>前回の変換</dt><dd>${Number.isFinite(elapsedMs) ? `${elapsedMs} ms` : "—"}</dd>`
      + `<dt>対応出力</dt><dd class="technical-wrap">${escapeHtml(modes)}</dd></dl>`;
  };

  const copyText = (result) => result.renderedText;

  const boot = (win) => {
    const doc = win.document;
    const $ = (id) => doc.getElementById(id);
    const status = (text, kind = "info", retry = null) => {
      const element = $("status");
      element.className = `status${kind === "error" ? " error" : ""}`;
      element.textContent = text;
      if (retry) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = "再読み込み";
        button.addEventListener("click", retry);
        element.appendChild(button);
      }
    };

    let terms = null;
    let client = null;
    let current = null;
    let selected = null;
    let openReply = null;
    let manifest = null;
    let supportedRenderModes = new Set(["plain"]);
    let cacheState = { available: false, online: win.navigator?.onLine !== false, sectionCount: 0, reuse: false };

    const profile = () => doc.querySelector('input[name="profile"]:checked').value;
    const resultView = () => doc.querySelector('input[name="resultView"]:checked')?.value ?? "clean";
    const rubyTarget = () => doc.querySelector('input[name="rubyTarget"]:checked')?.value ?? "none";
    const rubyNotation = () => doc.querySelector('input[name="rubyNotation"]:checked')?.value ?? "implicit";
    const renderMode = () => {
      const mode = renderModeFromControls(rubyTarget(), rubyNotation());
      if (!supportedRenderModes.has(mode)) throw new Error(`この辞書は出力形式 ${mode} に対応していません`);
      return mode;
    };
    const manifestUrl = new URL("browser-pack/manifest.json", win.location.href).href;

    const updateEngineInfo = () => {
      if (!$("engine-info")) return;
      $("engine-info").innerHTML = renderEngineInfoHtml({
        manifest,
        openReply,
        result: current?.result,
        elapsedMs: current?.elapsedMs,
        cacheState
      });
    };

    const syncOutputControls = () => {
      const none = rubyTarget() === "none";
      $("notation-group")?.setAttribute("aria-disabled", none ? "true" : "false");
      for (const radio of doc.querySelectorAll('input[name="rubyNotation"]')) radio.disabled = none;
    };

    const closeDetail = ({ restoreFocus = false } = {}) => {
      $("detail").hidden = true;
      if (selected) {
        selected.setAttribute("aria-pressed", "false");
        if (restoreFocus) selected.focus();
      }
      selected = null;
    };

    const renderCurrent = () => {
      if (!current) return;
      const diagnostic = resultView() === "diagnostic";
      const inspect = diagnostic && Boolean($("inspect")?.checked);
      $("result").innerHTML = renderResultHtml(current.result, { diagnostic, inspect });
      $("summary").innerHTML = renderSummaryHtml(current.result, { diagnostic });
      $("diagnostic-legend").hidden = !diagnostic;
      $("diagnostic-options").hidden = !diagnostic;
      if (!diagnostic) closeDetail();
      updateEngineInfo();
    };

    const showDetail = async (ref, element) => {
      if (!current || resultView() !== "diagnostic") return;
      if (selected) selected.setAttribute("aria-pressed", "false");
      selected = element;
      element.setAttribute("aria-pressed", "true");
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
      if (!client) return;
      status("必要な辞書データを確認し、変換しています…");
      try {
        const reply = await client.transform($("source").value, profile(), renderMode());
        if (reply.stale) return;
        current = reply;
        cacheState = await readBrowserCacheState(win);
        $("copy").disabled = false;
        closeDetail();
        renderCurrent();
        status(`変換しました（${reply.elapsedMs} ms）。`);
      } catch (error) {
        status(`変換できませんでした: ${error.message}`, "error", recover);
      }
    };

    const sw = win.navigator.serviceWorker;
    const pruneCache = (currentManifest) => {
      const base = new URL(manifestUrl, win.location.href);
      const keep = currentManifest.sections.map((section) => {
        const url = new URL(section.path, base);
        url.searchParams.set("v", section.sha256);
        return url.href;
      });
      sw?.controller?.postMessage({ type: "prune", keep });
    };

    const loadPolicy = async () => {
      status("辞書データを準備しています…");
      try {
        cacheState = await readBrowserCacheState(win);
        openReply = await client.open();
        manifest = await (await win.fetch(manifestUrl, { cache: "no-cache" })).json();
        const profileSection = manifest.sections.find((section) => section.kind === "profile-policy" && section.profileId === profile());
        const policy = profileSection ? await (await win.fetch(new URL(profileSection.path, manifestUrl))).json() : null;
        pruneCache(manifest);

        supportedRenderModes = new Set(openReply.renderModes ?? ["plain"]);
        $("render-modes").hidden = supportedRenderModes.size < 2;
        syncOutputControls();
        $("policy").innerHTML = renderPolicyHtml(terms, policy, profile());
        terms.bindHelp($("policy"));
        updateEngineInfo();
        $("convert").disabled = false;
        const cacheNote = cacheState.available
          ? (cacheState.reuse ? `端末キャッシュ ${cacheState.sectionCount} sectionを再利用可能` : "初回状態")
          : "cache状態不明";
        status(`準備完了（${cacheNote} / 辞書 ${openReply.packDigest.slice(0, 12)}…）。`);
        return true;
      } catch (error) {
        status(`辞書データを読み込めませんでした: ${error.message}`, "error", recover);
        return false;
      }
    };

    const clearCache = async () => {
      try {
        if (win.caches) {
          await win.caches.delete("browser-pack-sections");
          await win.caches.delete("browser-pack-shell-v1");
        }
        cacheState = await readBrowserCacheState(win);
        updateEngineInfo();
        status("辞書キャッシュを消去しました。再読み込みします。");
        await recover();
      } catch (error) {
        status(`キャッシュを消去できませんでした: ${error.message}`, "error");
      }
    };

    const recover = async () => {
      const shouldRetryTransform = Boolean(current) || $("auto").checked || $("source").value.length > 0;
      client.restart();
      current = null;
      $("copy").disabled = true;
      $("convert").disabled = true;
      if (await loadPolicy() && shouldRetryTransform) await convert();
    };

    const start = async () => {
      try {
        const dictionary = await (await win.fetch(new URL("terminology-ja.json", win.location.href), { cache: "no-cache" })).json();
        terms = Terminology.createTerminology(dictionary);
      } catch (error) {
        status(`用語集を読み込めませんでした: ${error.message}`, "error", () => win.location.reload());
        return;
      }
      client = win.WorkerClient.createWorkerClient({
        createWorker: () => new win.Worker("runtime/browser-transform-worker.js"),
        manifestUrl
      });
      await loadPolicy();
    };

    if (sw && win.location.protocol !== "file:") sw.register("sw.js").catch(() => {});
    const refreshConnectivity = async () => {
      cacheState = await readBrowserCacheState(win);
      updateEngineInfo();
      if (cacheState.online === false) status("オフラインです。利用可能な端末キャッシュから変換を試みます。");
    };
    win.addEventListener?.("online", refreshConnectivity);
    win.addEventListener?.("offline", refreshConnectivity);
    $("clear-cache")?.addEventListener("click", clearCache);
    $("convert").addEventListener("click", convert);

    $("inspect")?.addEventListener("change", renderCurrent);
    for (const radio of doc.querySelectorAll('input[name="resultView"]')) radio.addEventListener("change", renderCurrent);
    for (const radio of doc.querySelectorAll('input[name="rubyTarget"], input[name="rubyNotation"]')) {
      radio.addEventListener("change", () => {
        syncOutputControls();
        if (current || $("auto").checked) convert();
      });
    }
    for (const radio of doc.querySelectorAll('input[name="profile"]')) {
      radio.addEventListener("change", () => {
        loadPolicy().then((ok) => {
          if (ok && (current || $("auto").checked)) convert();
        });
      });
    }

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
        status("変換結果をコピーしました。");
      } catch {
        status("コピーできませんでした。結果を選択して手動でコピーしてください。", "error");
      }
    });

    const activate = (event) => {
      const element = event.target.closest?.(".diag[data-ref]");
      if (!element) return;
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showDetail(element.dataset.ref, element);
    };
    $("result").addEventListener("click", activate);
    $("result").addEventListener("keydown", activate);
    $("detail-close").addEventListener("click", () => closeDetail({ restoreFocus: true }));
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("detail").hidden) closeDetail({ restoreFocus: true });
    });

    syncOutputControls();
    start();
  };

  return {
    renderModeFromControls,
    readBrowserCacheState,
    renderResultHtml,
    renderSummaryHtml,
    renderDetailHtml,
    renderPolicyHtml,
    renderUnitDetailHtml,
    renderEngineInfoHtml,
    copyText,
    boot,
    CERTAINTY_TEXT
  };
});

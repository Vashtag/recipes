// ═══════════════════════════════════════════════════
//  Recipe extraction from a fetched web page.
//
//  Pure parsing: no network and no app UI. Works in the
//  browser (uses window.DOMParser) and in Node tests
//  (call RecipeExtract.setDomParser with jsdom's).
// ═══════════════════════════════════════════════════
(function (root) {
  "use strict";

  let DomParserCtor = typeof DOMParser !== "undefined" ? DOMParser : null;
  function setDomParser(ctor) { DomParserCtor = ctor; }

  function parseHtml(html) {
    if (!DomParserCtor) throw new Error("No DOMParser available");
    return new DomParserCtor().parseFromString(String(html || ""), "text/html");
  }

  // ── Text helpers ───────────────────────────────────
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
    "TR", "SECTION", "ARTICLE", "BLOCKQUOTE", "HEADER", "FOOTER", "DD", "DT",
  ]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON"]);

  // Text of a DOM node with line breaks at <br> and block boundaries.
  function nodeToText(node) {
    let out = "";
    (function walk(n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      const tag = n.nodeName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return;
      if (tag === "BR") { out += "\n"; return; }
      const block = BLOCK_TAGS.has(tag);
      if (block) out += "\n";
      for (const c of n.childNodes) walk(c);
      if (block) out += "\n";
    })(node);
    return out;
  }

  // Split text into trimmed, whitespace-collapsed, non-empty lines.
  function toLines(text) {
    return String(text || "")
      .replace(/ /g, " ")
      .split(/\n+/)
      .map(l => l.replace(/[ \t\r\f\v]+/g, " ").trim())
      .filter(Boolean);
  }

  // A string that may contain markup and entities, as lines of plain text.
  // Parsing it as HTML decodes every entity exactly once (&#8217; &frac12; ...)
  // and an escaped "&lt;b&gt;" stays literal text instead of becoming a tag.
  function htmlToLines(str) {
    const s = String(str || "");
    if (!/[<&]/.test(s)) return toLines(s);
    const doc = parseHtml(`<!doctype html><body>${s}`);
    return toLines(nodeToText(doc.body));
  }

  // One line of clean text.
  function cleanText(str) { return htmlToLines(str).join(" "); }

  // Plain text for a JSON-LD value: string, number, array or {@value|text|name}.
  function textOf(v) {
    if (v == null || v === false) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
    if (typeof v === "object") return textOf(v["@value"] ?? v.text ?? v.name ?? "");
    return String(v);
  }

  // ── URL helpers ────────────────────────────────────
  const TRACKING_PARAM_RE = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_ga|_gl|yclid|twclid|ttclid|si|ref|ref_src|cmpid|campaign)$/i;

  // Remove tracking parameters and the #fragment; return the original on failure.
  function normalizeSourceUrl(url) {
    try {
      const u = new URL(String(url).trim());
      for (const key of [...u.searchParams.keys()]) {
        if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
      }
      u.hash = "";
      return u.toString();
    } catch {
      return String(url || "").trim();
    }
  }

  // Key used to detect the same recipe saved twice.
  function urlKey(url) {
    try {
      const u = new URL(normalizeSourceUrl(url));
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "").toLowerCase();
      return host + path + (u.search || "");
    } catch {
      return String(url || "").trim().toLowerCase();
    }
  }

  function absoluteUrl(u, base) {
    if (!u) return "";
    try {
      const abs = new URL(String(u).trim(), base || undefined);
      return /^https?:$/.test(abs.protocol) ? abs.toString() : "";
    } catch {
      return "";
    }
  }

  // ── Durations ──────────────────────────────────────
  // "PT1H25M" → "1 hr 25 mins". Non-ISO text is returned cleaned up.
  function formatDuration(v) {
    const s = cleanText(textOf(v));
    if (!s) return "";
    const m = s.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!m) return s;
    const [, , , w, d, h, min, sec] = m.map(x => (x === undefined ? 0 : parseFloat(x)));
    let totalMin = Math.round((w || 0) * 10080 + (d || 0) * 1440 + (h || 0) * 60 + (min || 0) + (sec || 0) / 60);
    if (totalMin <= 0) return "";
    const days = Math.floor(totalMin / 1440); totalMin -= days * 1440;
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const parts = [];
    if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    if (hrs) parts.push(`${hrs} ${hrs === 1 ? "hr" : "hrs"}`);
    if (mins) parts.push(`${mins} ${mins === 1 ? "min" : "mins"}`);
    return parts.join(" ");
  }

  // ── Yield ──────────────────────────────────────────
  // ["4", "4 servings"] → "4 servings" (not "4 4 servings").
  function pickYield(v) {
    const list = [].concat(v ?? []).map(x => cleanText(textOf(x))).filter(Boolean);
    if (!list.length) return "";
    const descriptive = list.find(x => /^\d/.test(x) && /[a-z]/i.test(x));
    return descriptive || list[0];
  }

  // ── Images ─────────────────────────────────────────
  function numberOf(v) {
    if (v == null) return 0;
    if (typeof v === "object") return numberOf(v.value ?? v["@value"]);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Choose the widest image. Width comes from ImageObject.width, else from
  // a "-1200x800." size suffix in the URL; an unsized URL in a list is usually
  // the original upload, so it ranks above the sized thumbnails.
  function pickImage(v, base) {
    const candidates = [];
    (function collect(x) {
      if (!x) return;
      if (typeof x === "string") { candidates.push({ url: x, width: 0 }); return; }
      if (Array.isArray(x)) { x.forEach(collect); return; }
      if (typeof x === "object") {
        const url = textOf(x.url) || textOf(x.contentUrl) || (typeof x["@id"] === "string" && /^https?:|^\//.test(x["@id"]) ? x["@id"] : "");
        if (url) candidates.push({ url, width: numberOf(x.width) });
      }
    })(v);
    let best = null, bestScore = -1;
    for (const c of candidates) {
      const url = absoluteUrl(c.url, base);
      if (!url) continue;
      let score = c.width;
      if (!score) {
        const m = url.match(/[-_](\d{2,4})x(\d{2,4})(?=\.[a-z]{3,4}(?:$|\?))/i);
        score = m ? parseInt(m[1], 10) : (candidates.length > 1 ? 5000 : 1);
      }
      if (score > bestScore) { best = url; bestScore = score; }
    }
    return best || "";
  }

  // ── Lists ──────────────────────────────────────────
  const sectionHeader = name => `— ${name} —`;

  function ingredientLines(v) {
    return [].concat(v ?? []).flatMap(x => htmlToLines(textOf(x)));
  }

  function hasType(node, name) {
    return [].concat(node?.["@type"] ?? []).some(t =>
      String(t).replace(/^.*[/:#]/, "").toLowerCase() === name.toLowerCase());
  }

  // recipeInstructions in any shape: HTML blob, list of strings, HowToStep,
  // HowToSection (nested to any depth), ItemList/ListItem.
  function instructionLines(raw) {
    const out = [];
    (function walk(x) {
      if (x == null || x === "") return;
      if (typeof x === "string") { out.push(...htmlToLines(x)); return; }
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (typeof x !== "object") return;
      if (hasType(x, "HowToSection")) {
        const name = cleanText(textOf(x.name));
        if (name) out.push(sectionHeader(name));
        walk(x.itemListElement ?? x.steps ?? x.step);
        return;
      }
      if (hasType(x, "ListItem") && x.item) { walk(x.item); return; }
      const text = x.text ?? (x.itemListElement || x.step ? null : x.name);
      if (text) out.push(...htmlToLines(textOf(text)));
      if (x.itemListElement) walk(x.itemListElement);
      else if (x.step) walk(x.step);
    })(raw);
    return out.filter(l => l.length > 1);
  }

  function keywordList(v) {
    return [].concat(v ?? []).flatMap(x => textOf(x).split(/[,;|]/)).map(s => cleanText(s)).filter(Boolean);
  }

  // ── Strategy 1: JSON-LD ────────────────────────────
  function parseJsonLdText(text) {
    let t = String(text || "").trim()
      .replace(/^\s*(?:\/\/\s*)?<!\[CDATA\[/, "").replace(/(?:\/\/\s*)?\]\]>\s*$/, "")
      .replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
    try { return JSON.parse(t); } catch { /* retry below */ }
    // Raw control characters (e.g. literal newlines inside strings) are invalid JSON.
    try { return JSON.parse(t.replace(/[\u0000-\u001F]+/g, " ")); } catch { return null; }
  }

  // Every node typed Recipe, wherever it sits: top level, arrays, @graph,
  // mainEntity, mainEntityOfPage, nested @graphs...
  function findRecipeNodes(data) {
    const found = [];
    const seen = new Set();
    (function walk(x, depth) {
      if (!x || typeof x !== "object" || depth > 12 || seen.has(x)) return;
      seen.add(x);
      if (Array.isArray(x)) { x.forEach(y => walk(y, depth + 1)); return; }
      if (hasType(x, "Recipe")) found.push(x);
      for (const [k, v] of Object.entries(x)) {
        if (k === "recipeInstructions" || k === "recipeIngredient") continue;
        if (v && typeof v === "object") walk(v, depth + 1);
      }
    })(data, 0);
    return found;
  }

  function fromJsonLd(node, base) {
    return {
      title: cleanText(textOf(node.name) || textOf(node.headline)),
      image: pickImage(node.image ?? node.thumbnailUrl, base),
      servings: pickYield(node.recipeYield ?? node.yield),
      prepTime: formatDuration(node.prepTime),
      cookTime: formatDuration(node.cookTime),
      totalTime: formatDuration(node.totalTime),
      description: cleanText(textOf(node.description)),
      ingredients: ingredientLines(node.recipeIngredient ?? node.ingredients),
      instructions: instructionLines(node.recipeInstructions),
      tags: [
        ...keywordList(node.recipeCategory),
        ...keywordList(node.recipeCuisine),
        ...keywordList(node.keywords),
      ],
    };
  }

  function extractJsonLd(doc, base) {
    const results = [];
    for (const s of doc.querySelectorAll("script")) {
      if (!/ld\+json/i.test(s.getAttribute("type") || "")) continue;
      const data = parseJsonLdText(s.textContent);
      if (!data) continue;
      for (const node of findRecipeNodes(data)) results.push(fromJsonLd(node, base));
    }
    // Most complete recipe first.
    results.sort((a, b) => score(b) - score(a));
    return results[0] || null;
  }

  function score(r) {
    return (r.title ? 1 : 0) + (r.ingredients.length ? 2 : 0) + (r.instructions.length ? 2 : 0);
  }

  // ── Strategy 2: microdata ──────────────────────────
  function itemValue(el, base) {
    if (el.hasAttribute("content")) return el.getAttribute("content");
    const tag = el.nodeName.toUpperCase();
    if (tag === "META") return el.getAttribute("content") || "";
    if (tag === "IMG" || tag === "SOURCE") return absoluteUrl(el.getAttribute("src") || el.getAttribute("data-src"), base);
    if (tag === "A" || tag === "LINK") return el.getAttribute("href") || "";
    if (tag === "TIME") return el.getAttribute("datetime") || el.textContent;
    return null; // use text
  }

  function extractMicrodata(doc, base) {
    const scope = [...doc.querySelectorAll("[itemscope][itemtype]")]
      .find(el => /schema\.org\/Recipe\/?$/i.test(el.getAttribute("itemtype").trim()));
    if (!scope) return null;

    // Properties of this Recipe only, not of nested items (author, review, ...).
    const props = name => [...scope.querySelectorAll(`[itemprop~="${name}"]`)].filter(el => {
      const owner = el.parentElement && el.parentElement.closest("[itemscope]");
      return owner === scope;
    });
    const firstText = name => {
      for (const el of props(name)) {
        const v = itemValue(el, base);
        const t = v != null ? cleanText(v) : cleanText(nodeToText(el));
        if (t) return t;
      }
      return "";
    };
    const lines = name => props(name).flatMap(el => {
      const v = itemValue(el, base);
      return v != null ? htmlToLines(v) : toLines(nodeToText(el));
    });

    const imageEl = props("image")[0];
    let image = "";
    if (imageEl) {
      const v = itemValue(imageEl, base);
      if (v) image = absoluteUrl(v, base);
      else if (imageEl.hasAttribute("itemscope")) {
        const u = imageEl.querySelector('[itemprop~="url"]');
        image = u ? absoluteUrl(itemValue(u, base) || u.textContent, base) : "";
      }
    }

    // Steps may be HowToStep items whose text is in a nested itemprop="text".
    const instructions = props("recipeInstructions").flatMap(el => {
      if (el.hasAttribute("itemscope")) {
        const t = el.querySelector('[itemprop~="text"]');
        return toLines(nodeToText(t || el));
      }
      const v = itemValue(el, base);
      return v != null ? htmlToLines(v) : toLines(nodeToText(el));
    });

    return {
      title: firstText("name"),
      image,
      servings: pickYield(lines("recipeYield").concat(lines("yield"))),
      prepTime: formatDuration(firstText("prepTime")),
      cookTime: formatDuration(firstText("cookTime")),
      totalTime: formatDuration(firstText("totalTime")),
      description: firstText("description"),
      ingredients: lines("recipeIngredient").concat(lines("ingredients")),
      instructions: instructions.filter(l => l.length > 1),
      tags: [...lines("recipeCategory"), ...lines("recipeCuisine"), ...keywordList(firstText("keywords"))],
    };
  }

  // ── Strategy 3: recipe-plugin markup ───────────────
  // Popular WordPress recipe cards have stable class names even when
  // their JSON-LD is missing or broken by caching/optimisation plugins.
  const PLUGINS = [
    {
      name: "WP Recipe Maker",
      root: ".wprm-recipe-container, .wprm-recipe",
      title: ".wprm-recipe-name",
      ingredientGroups: ".wprm-recipe-ingredient-group",
      groupName: ".wprm-recipe-group-name",
      ingredient: ".wprm-recipe-ingredient",
      instructionGroups: ".wprm-recipe-instruction-group",
      instruction: ".wprm-recipe-instruction-text",
      servings: ".wprm-recipe-servings",
      description: ".wprm-recipe-summary",
      image: ".wprm-recipe-image img",
    },
    {
      name: "Tasty Recipes",
      root: ".tasty-recipes",
      title: ".tasty-recipes-title",
      ingredient: ".tasty-recipes-ingredients li",
      instruction: ".tasty-recipes-instructions li",
      servings: ".tasty-recipes-yield",
      description: ".tasty-recipes-description",
      image: ".tasty-recipes-image img",
    },
    {
      name: "Mediavine Create",
      root: ".mv-create-card, .mv-recipe-card",
      title: ".mv-create-title",
      ingredient: ".mv-create-ingredients li",
      instruction: ".mv-create-instructions li",
      servings: ".mv-create-yield",
      description: ".mv-create-description",
      image: ".mv-create-image img",
    },
    {
      name: "Zip Recipes / generic",
      root: ".zrdn-recipe-container, .recipe-card, .recipe-callout",
      title: ".zrdn-recipe-title, .recipe-card-title, .recipe-title",
      ingredient: ".zrdn-ingredients-list li, .recipe-card-ingredients li, .ingredients li",
      instruction: ".zrdn-instructions-list li, .recipe-card-instructions li, .instructions li",
    },
  ];

  function imgSrc(img, base) {
    if (!img) return "";
    const srcset = img.getAttribute("data-srcset") || img.getAttribute("srcset");
    if (srcset) {
      const best = srcset.split(",").map(s => s.trim().split(/\s+/))
        .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }))
        .sort((a, b) => b.w - a.w)[0];
      if (best && best.u) return absoluteUrl(best.u, base);
    }
    return absoluteUrl(img.getAttribute("data-lazy-src") || img.getAttribute("data-src") || img.getAttribute("src"), base);
  }

  function groupedLines(rootEl, groupSel, nameSel, itemSel) {
    const groups = groupSel ? [...rootEl.querySelectorAll(groupSel)] : [];
    if (groups.length) {
      return groups.flatMap(g => {
        const nameEl = nameSel && g.querySelector(nameSel);
        const name = nameEl ? cleanText(nodeToText(nameEl)) : "";
        const items = [...g.querySelectorAll(itemSel)].map(el => toLines(nodeToText(el)).join(" ")).filter(Boolean);
        if (!items.length) return [];
        return name ? [sectionHeader(name), ...items] : items;
      });
    }
    return [...rootEl.querySelectorAll(itemSel)].map(el => toLines(nodeToText(el)).join(" ")).filter(Boolean);
  }

  function extractPluginMarkup(doc, base) {
    for (const p of PLUGINS) {
      const rootEl = doc.querySelector(p.root);
      if (!rootEl) continue;
      const ingredients = groupedLines(rootEl, p.ingredientGroups, p.groupName, p.ingredient);
      const instructions = groupedLines(rootEl, p.instructionGroups, p.groupName, p.instruction);
      if (!ingredients.length && !instructions.length) continue;
      const q = sel => (sel ? rootEl.querySelector(sel) : null);
      const txt = sel => { const el = q(sel); return el ? cleanText(nodeToText(el)) : ""; };
      return {
        title: txt(p.title),
        image: imgSrc(q(p.image), base),
        servings: txt(p.servings),
        prepTime: "", cookTime: "", totalTime: "",
        description: txt(p.description),
        ingredients,
        instructions,
        tags: [],
      };
    }
    return null;
  }

  // ── Strategy 4: headings followed by lists ─────────
  function listAfterHeading(doc, re) {
    const headings = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,p")]
      .filter(h => h.textContent.length < 60 && re.test(h.textContent.trim()));
    for (const h of headings) {
      // Walk forward through following elements until a list turns up
      // or another heading starts a new section.
      let el = h.closest("h1,h2,h3,h4,h5,h6,p") || h;
      for (let i = 0; i < 6 && el; i++) {
        el = el.nextElementSibling;
        if (!el) break;
        if (/^H[1-6]$/.test(el.nodeName.toUpperCase())) break;
        const list = /^(UL|OL)$/.test(el.nodeName.toUpperCase()) ? el : el.querySelector("ul,ol");
        if (list) {
          const items = [...list.querySelectorAll(":scope > li")].map(li => toLines(nodeToText(li)).join(" ")).filter(Boolean);
          if (items.length >= 2) return items;
        }
      }
    }
    return [];
  }

  function extractHeadingLists(doc) {
    const ingredients = listAfterHeading(doc, /^ingredients?\b/i);
    const instructions = listAfterHeading(doc, /^(instructions?|directions?|method|preparation|steps)\b/i);
    if (!ingredients.length && !instructions.length) return null;
    return { title: "", image: "", servings: "", prepTime: "", cookTime: "", totalTime: "", description: "", ingredients, instructions, tags: [] };
  }

  // ── Strategy 5: meta tags ──────────────────────────
  function meta(doc, key) {
    const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
    return el ? cleanText(el.getAttribute("content")) : "";
  }

  function extractMeta(doc, base) {
    const titleEl = doc.querySelector("title");
    return {
      title: meta(doc, "og:title") || meta(doc, "twitter:title") || (titleEl ? cleanText(titleEl.textContent) : ""),
      image: absoluteUrl(meta(doc, "og:image") || meta(doc, "og:image:url") || meta(doc, "twitter:image"), base),
      servings: "", prepTime: "", cookTime: "", totalTime: "",
      description: meta(doc, "og:description") || meta(doc, "description"),
      ingredients: [], instructions: [], tags: [],
    };
  }

  // ── Blocked / challenge pages ──────────────────────
  const BLOCK_TITLE_RE = /just a moment|attention required|access denied|are you a robot|verify you are human|security check|pardon our interruption|request rejected|403 forbidden|captcha/i;
  const BLOCK_BODY_RE = /cf-browser-verification|challenge-platform|cf_chl_|_Incapsula_Resource|px-captcha|enable javascript and cookies to continue|checking your browser before accessing|g-recaptcha|hcaptcha/i;

  function looksBlocked(html) {
    const h = String(html || "");
    if (/ld\+json/i.test(h) && /"@type"\s*:\s*(?:\[[^\]]*)?"(?:[^"]*[/:])?Recipe"/i.test(h)) return false;
    const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    return BLOCK_TITLE_RE.test(title) || (h.length < 60000 && BLOCK_BODY_RE.test(h));
  }

  // ── Categories ─────────────────────────────────────
  // Words in a recipe's categories, cuisine, keywords or title that suggest
  // one of the app's categories.
  const CATEGORY_HINTS = {
    "Breakfast":   /\b(breakfast|brunch|pancakes?|waffles?|granola|oatmeal|porridge)\b/i,
    "Lunch":       /\blunch(es)?\b/i,
    "Dinner":      /\b(dinners?|main courses?|main dish(es)?|mains?|entr[eé]es?|supper)\b/i,
    "Pasta":       /\b(pasta|spaghetti|lasagn[ae]|penne|linguine|fettuccine|rigatoni|macaroni|orzo|gnocchi|ravioli)\b/i,
    "Soup":        /\b(soups?|stews?|chowders?|bisques?|ash reshteh)\b/i,
    "Salad":       /\bsalads?\b/i,
    "Cookie":      /\bcookies?\b/i,
    "Cake":        /\b(cakes?|cupcakes?|cheesecakes?)\b/i,
    "Sweet Treat": /\b(desserts?|sweets?|treats?|candy|brownies?|bars|fudge|pies?|tarts?|puddings?|ice cream)\b/i,
    "Persian":     /\b(persian|iranian)\b/i,
    "Bread":       /\b(breads?|loaf|loaves|focaccia|baguettes?|rolls|buns|brioche|flatbreads?|bagels?)\b/i,
    "Sourdough":   /\bsourdough\b/i,
    "Vegetarian":  /\b(vegetarian|vegan|meatless|plant[- ]based)\b/i,
  };

  function suggestCategories(recipe, available) {
    const haystack = [...(recipe.tags || []), recipe.title || ""].join(" | ");
    const allowed = available ? new Set(available) : null;
    return Object.entries(CATEGORY_HINTS)
      .filter(([cat, re]) => (!allowed || allowed.has(cat)) && re.test(haystack))
      .map(([cat]) => cat);
  }

  // ── Main entry point ───────────────────────────────
  const FIELDS = ["title", "image", "servings", "prepTime", "cookTime", "totalTime", "description"];
  const LIST_FIELDS = ["ingredients", "instructions", "tags"];

  // Run every strategy and fill each empty field from the next one.
  function extractRecipe(html, sourceUrl, opts = {}) {
    const base = sourceUrl || undefined;
    const doc = parseHtml(html);
    const attempts = [];
    const tryStrategy = (name, fn) => {
      try {
        const r = fn();
        if (r) attempts.push({ name, r });
      } catch { /* a broken strategy must not stop the others */ }
    };
    tryStrategy("json-ld", () => extractJsonLd(doc, base));
    tryStrategy("microdata", () => extractMicrodata(doc, base));
    tryStrategy("plugin", () => extractPluginMarkup(doc, base));
    tryStrategy("headings", () => extractHeadingLists(doc));
    tryStrategy("meta", () => extractMeta(doc, base));

    const merged = { sources: [] };
    for (const f of FIELDS) merged[f] = "";
    for (const f of LIST_FIELDS) merged[f] = [];
    for (const { name, r } of attempts) {
      let used = false;
      for (const f of FIELDS) {
        if (!merged[f] && r[f]) { merged[f] = r[f]; used = true; }
      }
      for (const f of ["ingredients", "instructions"]) {
        if (!merged[f].length && r[f] && r[f].length) { merged[f] = r[f]; used = true; }
      }
      if (r.tags && r.tags.length) merged.tags.push(...r.tags);
      if (used) merged.sources.push(name);
    }
    merged.tags = [...new Set(merged.tags)];
    merged.sourceUrl = normalizeSourceUrl(sourceUrl || "");
    merged.category = suggestCategories(merged, opts.categories);

    const missing = [];
    if (!merged.ingredients.length) missing.push("ingredients");
    if (!merged.instructions.length) missing.push("instructions");
    merged.missing = missing;
    merged.partial = missing.length > 0;
    merged.blocked = looksBlocked(html) && !merged.ingredients.length && !merged.instructions.length;
    merged.found = !!(merged.title || merged.ingredients.length || merged.instructions.length);
    return merged;
  }

  const api = {
    extractRecipe, setDomParser, looksBlocked, normalizeSourceUrl, urlKey,
    formatDuration, pickYield, pickImage, htmlToLines, cleanText,
    instructionLines, findRecipeNodes, suggestCategories,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeExtract = api;
})(typeof window !== "undefined" ? window : globalThis);

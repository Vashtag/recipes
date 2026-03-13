/* =====================================================
   Our Recipes App
   ===================================================== */

// ── State ──────────────────────────────────────────
let recipes = [];          // loaded from GitHub
let currentRecipeId = null; // recipe open in detail view
let editingId = null;       // non-null when editing an existing recipe
let fileSha = null;         // current SHA of recipes.json (needed for GitHub API writes)

// ── Init ───────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupImagePreview();
  buildManualForm();
  checkConfig();
  loadRecipes();

  document.getElementById("search-input").addEventListener("input", renderGrid);
});

function checkConfig() {
  if (!getToken()) {
    showBanner(
      "⚠️ No GitHub token set. Go to <strong>Settings</strong> to add one before saving recipes.",
      "warn"
    );
  } else {
    const banner = document.getElementById("setup-banner");
    if (banner) banner.remove();
  }
}

function showBanner(html, type = "warn") {
  let banner = document.getElementById("setup-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "setup-banner";
    document.getElementById("main-header").after(banner);
  }
  banner.className = `setup-banner setup-banner--${type}`;
  banner.innerHTML = html;
}

// ── Fridge (ingredient-based recipe finder) ────────
function initFridgeView() {
  document.getElementById("fridge-input").focus();
  renderFridgeResults();
}

function renderFridgeResults() {
  const raw = document.getElementById("fridge-input").value.trim().toLowerCase();
  const el = document.getElementById("fridge-results");

  if (!raw) { el.innerHTML = ""; return; }
  if (recipes.length === 0) {
    el.innerHTML = '<p class="fridge-hint">No recipes saved yet.</p>'; return;
  }

  // Split by comma into individual terms
  const terms = raw.split(",").map(t => t.trim()).filter(Boolean);

  // Score each recipe by how many terms appear in its ingredients
  const scored = recipes.map(r => {
    const ings = (r.ingredients || []).join(" ").toLowerCase();
    const matchedTerms = terms.filter(term => ings.includes(term));
    const matchedIngs = (r.ingredients || []).filter(ing =>
      terms.some(term => ing.toLowerCase().includes(term))
    );
    return { r, matchedTerms, matchedIngs };
  }).filter(s => s.matchedTerms.length > 0)
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);

  if (scored.length === 0) {
    el.innerHTML = `<p class="fridge-hint">No recipes found for "${escHtml(raw)}".</p>`; return;
  }

  el.innerHTML = scored.map(({ r, matchedTerms, matchedIngs }) => {
    const label = terms.length > 1
      ? `${matchedTerms.length}/${terms.length} ingredients matched`
      : matchedIngs[0] ? escHtml(matchedIngs[0]) : "";
    return `
      <div class="fridge-result-card" onclick="openRecipe('${r.id}')">
        ${r.image
          ? `<img class="fridge-card-img" src="${escHtml(r.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ""}
        <div class="fridge-card-img fridge-card-img--placeholder" style="${r.image ? "display:none" : ""}">🍽️</div>
        <div class="fridge-card-body">
          <h3>${escHtml(r.title)}</h3>
          <p class="fridge-matched-ings">${label}</p>
        </div>
      </div>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fridge-input").addEventListener("input", renderFridgeResults);
});

// ── Settings ───────────────────────────────────────
function saveSettings() {
  const token = document.getElementById("settings-token").value.trim();
  const branch = document.getElementById("settings-branch").value.trim();

  if (!token && !branch) {
    showSettingsStatus("Nothing to save.", "error"); return;
  }
  if (token) localStorage.setItem("gh_token", token);
  if (branch) localStorage.setItem("gh_branch", branch);

  document.getElementById("settings-token").value = "";
  showSettingsStatus(`Saved! Branch: ${getBranch()}. Loading recipes…`, "ok");
  checkConfig();
  loadRecipes();
}

function clearToken() {
  localStorage.removeItem("gh_token");
  localStorage.removeItem("gh_branch");
  document.getElementById("settings-token").value = "";
  document.getElementById("settings-branch").value = "";
  showSettingsStatus("Token and branch cleared.", "ok");
  checkConfig();
}

function showSettingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  el.textContent = msg;
  el.className = `settings-status settings-status--${type}`;
  el.classList.remove("hidden");
}

function initSettingsView() {
  const hasToken = !!getToken();
  document.getElementById("settings-clear-btn").style.display = hasToken ? "" : "none";
  document.getElementById("settings-status").classList.add("hidden");
  document.getElementById("settings-token").value = "";
  document.getElementById("settings-branch").value = getBranch();
}

// ── GitHub API helpers ─────────────────────────────
const GH_API = "https://api.github.com";

function getToken() {
  return localStorage.getItem("gh_token") || CONFIG.githubToken || "";
}

function getBranch() {
  return localStorage.getItem("gh_branch") || CONFIG.githubBranch || "main";
}

function ghHeaders(write = false) {
  const token = getToken();
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
  // Only add auth if we have a token, or if it's a write operation (required)
  if (token || write) headers.Authorization = `token ${token}`;
  return headers;
}

async function loadRecipes() {
  try {
    const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}?ref=${getBranch()}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 401) {
      showBanner("⚠️ GitHub token is invalid or expired. Go to <strong>⚙️ Settings</strong> to update it.", "warn");
      recipes = []; fileSha = null;
      renderGrid(); return;
    }
    if (res.status === 404) {
      // File doesn't exist yet — that's fine, will be created on first save
      recipes = []; fileSha = null;
      renderGrid(); return;
    }
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
    const data = await res.json();
    fileSha = data.sha;
    recipes = JSON.parse(atob(data.content.replace(/\n/g, "")));
  } catch (e) {
    console.warn("Could not load recipes:", e.message);
    recipes = [];
    fileSha = null;
  }
  renderGrid();
}

async function saveToGitHub() {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(recipes, null, 2))));
  const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}`;
  const body = {
    message: "Update recipes",
    content,
    branch: getBranch(),
  };
  if (fileSha) body.sha = fileSha;

  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try {
      const err = await res.json();
      if (res.status === 401) msg = "Bad credentials — update your token in ⚙️ Settings";
      else if (res.status === 409) msg = "Conflict: someone else saved at the same time. Please reload and try again.";
      else if (res.status === 422) msg = "GitHub rejected the update (422). Check your token permissions (needs Contents: Read & Write).";
      else msg = err.message || msg;
    } catch { /* response wasn't JSON */ }
    throw new Error(msg);
  }
  const data = await res.json();
  fileSha = data.content.sha;
}

// ── Recipe Grid ────────────────────────────────────
function recipeCardHtml(r) {
  return `
    <div class="recipe-card" onclick="openRecipe('${r.id}')">
      ${r.favourite ? `<span class="card-fav-star" title="Favourite">★</span>` : ""}
      ${r.image
        ? `<img class="card-img" src="${escHtml(r.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ""}
      <div class="card-img-placeholder" style="${r.image ? "display:none" : ""}">🍽️</div>
      <div class="card-body">
        ${[].concat(r.category||[]).length ? `<span class="card-category">${[].concat(r.category).map(escHtml).join(", ")}</span>` : ""}
        <h3>${escHtml(r.title)}</h3>
        ${r.sourceUrl ? `<p class="card-source">${sourceDomain(r.sourceUrl)}</p>` : ""}
      </div>
    </div>
  `;
}

function renderGrid() {
  const query = document.getElementById("search-input").value.trim().toLowerCase();
  const grid = document.getElementById("recipe-grid");
  const empty = document.getElementById("empty-state");

  let filtered = recipes;
  if (query) {
    filtered = recipes.filter(r =>
      r.title.toLowerCase().includes(query) ||
      (r.ingredients || []).some(i => i.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = filtered.map(recipeCardHtml).join("");
}

function renderFavouritesView() {
  const grid = document.getElementById("favourites-view-grid");
  const empty = document.getElementById("favourites-empty");
  const favs = recipes.filter(r => r.favourite);
  if (favs.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = favs.map(recipeCardHtml).join("");
}

function sourceDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ── Views ──────────────────────────────────────────
function showView(name) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("active", v.id === `view-${name}`);
    v.classList.toggle("hidden", v.id !== `view-${name}`);
  });

  // Show/hide main header (visible on list and favourites)
  document.getElementById("main-header").style.display = (name === "list" || name === "favourites") ? "" : "none";
  // Search bar only useful on list view
  document.querySelector(".header-search").style.display = name === "list" ? "" : "none";

  // Update nav active state
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "add" && !editingId) resetAddForm();
  if (name === "list") renderGrid();
  if (name === "favourites") renderFavouritesView();
  if (name === "settings") initSettingsView();
  if (name === "fridge") initFridgeView();
}

// ── Tabs (URL / Manual) ────────────────────────────
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-content").forEach(c => {
        c.classList.toggle("active", c.id === `tab-${tab}`);
        c.classList.toggle("hidden", c.id !== `tab-${tab}`);
      });
      // Show edit form immediately for manual tab
      if (tab === "manual") {
        clearEditForm();
        document.getElementById("edit-form").classList.remove("hidden");
      } else {
        document.getElementById("edit-form").classList.add("hidden");
      }
    });
  });
}

// ── Image preview in edit form ─────────────────────
function setupImagePreview() {
  document.getElementById("edit-image").addEventListener("input", function () {
    const preview = document.getElementById("edit-image-preview");
    if (this.value) {
      preview.src = this.value;
      preview.classList.remove("hidden");
    } else {
      preview.classList.add("hidden");
    }
  });
}

// ── Recipe URL Fetch ───────────────────────────────
async function fetchRecipe() {
  const urlInput = document.getElementById("recipe-url");
  const url = urlInput.value.trim();
  const errEl = document.getElementById("fetch-error");
  errEl.classList.add("hidden");

  if (!url) {
    showError(errEl, "Please enter a URL.");
    return;
  }
  try { new URL(url); } catch {
    showError(errEl, "That doesn't look like a valid URL.");
    return;
  }

  setFetchLoading(true);

  try {
    const html = await fetchViaProxy(url);
    const parsed = parseRecipeFromHtml(html, url);
    if (!parsed) {
      throw new Error("Could not find recipe data on this page. Switch to Manual Entry and fill in the details.");
    }
    populateEditForm(parsed);
    document.getElementById("edit-form").classList.remove("hidden");
    if (parsed.partial) {
      showError(errEl, "⚠️ Only the title and image could be extracted from this site. Please fill in the ingredients and instructions below.");
      errEl.style.background = "#2a2e1a";
      errEl.style.color = "#a8c060";
    }
  } catch (e) {
    showError(errEl, e.message);
  } finally {
    setFetchLoading(false);
  }
}

// ── Proxy list (tried in order until one works) ────
const PROXIES = [
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchViaProxy(url) {
  let lastErr = null;
  for (const makeProxy of PROXIES) {
    try {
      const proxyUrl = makeProxy(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) { lastErr = new Error(`Proxy returned ${res.status}`); continue; }
      // allorigins wraps in JSON; codetabs and corsproxy return raw HTML
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        const html = data.contents || data.body || data.html || "";
        if (html) return html;
        lastErr = new Error("Proxy returned empty content"); continue;
      }
      const html = await res.text();
      if (html) return html;
      lastErr = new Error("Proxy returned empty content");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("Could not fetch the page through any proxy. Check your internet connection, or use Manual Entry.");
}

function parseRecipeFromHtml(html, sourceUrl) {
  // ── Strategy 1: JSON-LD structured data ────────────
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdMatches) {
    try {
      let obj = JSON.parse(match[1].replace(/[\u0000-\u001F]/g, " "));
      // Handle @graph arrays (common on WordPress/Yoast sites)
      const candidates = [];
      if (Array.isArray(obj)) candidates.push(...obj);
      else if (obj["@graph"]) candidates.push(...(Array.isArray(obj["@graph"]) ? obj["@graph"] : [obj["@graph"]]));
      else candidates.push(obj);

      for (const node of candidates) {
        const types = [].concat(node["@type"] || []);
        if (types.some(t => String(t).toLowerCase().includes("recipe"))) {
          const result = extractFromJsonLd(node, sourceUrl);
          if (result.title) return result;
        }
      }
    } catch { /* skip malformed */ }
  }

  // ── Strategy 2: HTML microdata (itemprop) ──────────
  const microdataResult = parseMicrodata(html, sourceUrl);
  if (microdataResult && microdataResult.title) return microdataResult;

  // ── Strategy 3: Meta tags (partial — at least gets title/image) ──
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title") || htmlTitle(html);
  const image = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  if (title) {
    return { title: cleanText(title), image: image || "", ingredients: [], instructions: [], servings: "", sourceUrl, partial: true };
  }

  return null;
}

function extractFromJsonLd(data, sourceUrl) {
  const title = cleanText(textOf(data.name));
  const image = bestImageUrl(data.image);
  const servings = cleanText(textOf(data.recipeYield) || textOf(data.yield));

  const ingredients = [].concat(data.recipeIngredient || [])
    .map(v => cleanText(textOf(v))).filter(Boolean);

  let instructions = [];
  const raw = data.recipeInstructions;
  if (!raw) {
    instructions = [];
  } else if (typeof raw === "string") {
    // Sometimes it's a big HTML blob
    instructions = stripHtml(raw).split(/\n+/).map(s => s.trim()).filter(s => s.length > 3);
  } else if (Array.isArray(raw)) {
    instructions = raw.flatMap(step => {
      if (!step) return [];
      if (typeof step === "string") return [cleanText(step)];
      const types = [].concat(step["@type"] || []);
      if (types.some(t => String(t).toLowerCase().includes("howtosection"))) {
        const header = step.name ? [`— ${cleanText(step.name)} —`] : [];
        const items = [].concat(step.itemListElement || []).map(s =>
          cleanText(textOf(s.text || s.name || s))
        ).filter(Boolean);
        return [...header, ...items];
      }
      return [cleanText(textOf(step.text || step.name || step))];
    }).filter(Boolean);
  }

  return { title, image, ingredients, instructions, servings, sourceUrl };
}

function parseMicrodata(html, sourceUrl) {
  // Very lightweight microdata extraction — look for itemprop attributes
  const getItems = (prop) => {
    const matches = [];
    const re = new RegExp(`itemprop=["']${prop}["'][^>]*(?:content=["']([^"']+)["']|>([^<]*)<)`, "gi");
    let m;
    while ((m = re.exec(html)) !== null) matches.push(cleanText(m[1] || m[2] || ""));
    return matches.filter(Boolean);
  };

  const title = getItems("name")[0] || "";
  if (!title) return null;

  const image = getItems("image")[0] || metaContent(html, "og:image") || "";
  const servings = getItems("recipeYield")[0] || getItems("yield")[0] || "";
  const ingredients = getItems("recipeIngredient").concat(getItems("ingredient"));
  const instructions = getItems("recipeInstructions").concat(getItems("step")).flatMap(s =>
    stripHtml(s).split(/\n+/).map(t => t.trim()).filter(t => t.length > 3)
  );

  return { title, image, ingredients, instructions, servings, sourceUrl };
}

// ── Text utilities ─────────────────────────────────
function textOf(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join(" ");
  if (typeof v === "object") return textOf(v["@value"] || v.text || v.name || v.url || "");
  return String(v);
}

function bestImageUrl(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    // Prefer the largest (last in array, common pattern) or one with a url property
    const urls = v.map(bestImageUrl).filter(Boolean);
    return urls[urls.length - 1] || "";
  }
  if (typeof v === "object") return v.url || v["@id"] || "";
  return "";
}

function stripHtml(str) {
  return String(str || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(str) {
  return stripHtml(String(str || ""))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*?)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? cleanText(m[1]) : null;
}

function htmlTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? cleanText(m[1]) : null;
}

function setFetchLoading(on) {
  document.getElementById("fetch-btn").disabled = on;
  document.getElementById("fetch-btn-text").textContent = on ? "Extracting…" : "Extract Recipe";
  document.getElementById("fetch-spinner").classList.toggle("hidden", !on);
}

// ── Edit Form ──────────────────────────────────────
function populateEditForm(data) {
  document.getElementById("edit-title").value = data.title || "";
  document.getElementById("edit-image").value = data.image || "";
  const cats = [].concat(data.category || []);
  document.querySelectorAll("#category-checks input").forEach(cb => {
    cb.checked = cats.includes(cb.value);
  });
  document.getElementById("edit-servings").value = data.servings || "";
  document.getElementById("edit-prep-time").value = data.prepTime || "";
  document.getElementById("edit-cook-time").value = data.cookTime || "";
  document.getElementById("edit-source").value = data.sourceUrl || "";

  const imgPreview = document.getElementById("edit-image-preview");
  if (data.image) {
    imgPreview.src = data.image;
    imgPreview.classList.remove("hidden");
  } else {
    imgPreview.classList.add("hidden");
  }

  document.getElementById("edit-notes").value = data.notes || "";
  renderIngredients(data.ingredients || []);
  renderInstructions(data.instructions || []);
}

function clearEditForm() {
  populateEditForm({ title: "", image: "", servings: "", prepTime: "", cookTime: "", sourceUrl: "", ingredients: [""], instructions: [""] });
}

function buildManualForm() {
  clearEditForm();
}

function renderIngredients(list) {
  const container = document.getElementById("ingredients-list");
  container.innerHTML = "";
  (list.length ? list : [""]).forEach((val, i) => addIngredientRow(val));
}

function renderInstructions(list) {
  const container = document.getElementById("instructions-list");
  container.innerHTML = "";
  (list.length ? list : [""]).forEach((val, i) => addInstructionRow(val));
}

function addIngredientRow(value = "") {
  const container = document.getElementById("ingredients-list");
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `
    <input type="text" placeholder="e.g. 2 cups flour" value="${escHtml(value)}" />
    <button class="remove-row-btn" onclick="removeRow(this)" type="button">✕</button>
  `;
  container.appendChild(row);
}

function addInstructionRow(value = "") {
  const container = document.getElementById("instructions-list");
  const num = container.children.length + 1;
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `
    <span class="row-num">${num}</span>
    <textarea placeholder="Describe step ${num}…" rows="2">${escHtml(value)}</textarea>
    <button class="remove-row-btn" onclick="removeRow(this)" type="button">✕</button>
  `;
  container.appendChild(row);
}

function removeRow(btn) {
  btn.closest(".list-row").remove();
  // Re-number instruction rows
  document.querySelectorAll("#instructions-list .row-num").forEach((el, i) => {
    el.textContent = i + 1;
  });
}

// ── Edit existing recipe ───────────────────────────
function editRecipe() {
  const recipe = recipes.find(r => r.id === currentRecipeId);
  if (!recipe) return;
  editingId = currentRecipeId;

  // Go to add view — resetAddForm is skipped because editingId is set
  showView("add");

  // Programmatically click the Manual tab to activate it and show the form
  document.querySelector(".tab-btn[data-tab='manual']").click();

  // Now populate with the recipe's data (overrides the blank clearEditForm)
  populateEditForm(recipe);

  document.querySelector("#view-add .view-header h2").textContent = "Edit Recipe";
}

// ── Save Recipe ────────────────────────────────────
async function saveRecipe() {
  const errEl = document.getElementById("save-error");
  errEl.classList.add("hidden");

  const title = document.getElementById("edit-title").value.trim();
  if (!title) { showError(errEl, "Please enter a recipe title."); return; }

  const ingredients = [...document.querySelectorAll("#ingredients-list input")]
    .map(i => i.value.trim()).filter(Boolean);
  const instructions = [...document.querySelectorAll("#instructions-list textarea")]
    .map(t => t.value.trim()).filter(Boolean);

  if (ingredients.length === 0) { showError(errEl, "Add at least one ingredient."); return; }
  if (instructions.length === 0) { showError(errEl, "Add at least one instruction step."); return; }

  const isEdit = !!editingId;
  const existing = isEdit ? recipes.find(r => r.id === editingId) : null;

  const recipe = {
    id: isEdit ? editingId : crypto.randomUUID(),
    title,
    image: document.getElementById("edit-image").value.trim(),
    category: [...document.querySelectorAll("#category-checks input:checked")].map(cb => cb.value),
    servings: document.getElementById("edit-servings").value.trim(),
    prepTime: document.getElementById("edit-prep-time").value.trim(),
    cookTime: document.getElementById("edit-cook-time").value.trim(),
    sourceUrl: document.getElementById("edit-source").value.trim(),
    notes: document.getElementById("edit-notes").value.trim(),
    ingredients,
    instructions,
    addedAt: isEdit ? (existing?.addedAt || new Date().toISOString()) : new Date().toISOString(),
  };

  setSaveLoading(true);
  let rollback;
  try {
    await refreshSha();
    if (isEdit) {
      const idx = recipes.findIndex(r => r.id === editingId);
      rollback = { type: "edit", idx, original: recipes[idx] };
      recipes[idx] = recipe;
    } else {
      rollback = { type: "add" };
      recipes.unshift(recipe);
    }
    await saveToGitHub();
    editingId = null;
    showToast(isEdit ? "Recipe updated!" : "Recipe saved!");
    showView("list");
  } catch (e) {
    if (rollback?.type === "edit") recipes[rollback.idx] = rollback.original;
    else if (rollback?.type === "add") recipes.shift();
    showError(errEl, `Could not save: ${e.message}`);
  } finally {
    setSaveLoading(false);
  }
}

async function refreshSha() {
  const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}?ref=${getBranch()}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return; // file doesn't exist yet — first save will create it
  if (res.status === 401) throw new Error("Bad credentials — update your token in ⚙️ Settings");
  if (!res.ok) throw new Error(`GitHub API error ${res.status} while fetching latest data`);
  const data = await res.json();
  fileSha = data.sha;
}

function setSaveLoading(on) {
  document.querySelector(".btn-primary[onclick='saveRecipe()']").disabled = on;
  document.getElementById("save-btn-text").textContent = on ? "Saving…" : "Save Recipe";
  document.getElementById("save-spinner").classList.toggle("hidden", !on);
}

function cancelEdit() {
  showView("list");
}

function resetAddForm() {
  editingId = null;
  document.querySelector("#view-add .view-header h2").textContent = "Add Recipe";
  document.getElementById("recipe-url").value = "";
  document.getElementById("fetch-error").classList.add("hidden");
  document.getElementById("edit-form").classList.add("hidden");

  // Reset to URL tab
  document.querySelectorAll(".tab-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
  document.getElementById("tab-url").classList.add("active");
  document.getElementById("tab-url").classList.remove("hidden");
  document.getElementById("tab-manual").classList.remove("active");
  document.getElementById("tab-manual").classList.add("hidden");
}

// ── Recipe Detail ──────────────────────────────────
function openRecipe(id) {
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;
  currentRecipeId = id;

  document.getElementById("detail-title").textContent = recipe.title;
  const favBtn = document.getElementById("fav-btn");
  favBtn.textContent = recipe.favourite ? "★" : "☆";
  favBtn.classList.toggle("fav-btn--active", !!recipe.favourite);

  const content = document.getElementById("detail-content");
  content.innerHTML = `
    ${recipe.image
      ? `<img class="detail-hero" src="${escHtml(recipe.image)}" alt="${escHtml(recipe.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : ""}
    <div class="detail-hero-placeholder" style="${recipe.image ? "display:none" : ""}">🍽️</div>

    <div class="detail-meta">
      ${[].concat(recipe.category||[]).map(c => `<span class="meta-chip meta-chip--category">${escHtml(c)}</span>`).join("")}
      ${recipe.servings ? `<span class="meta-chip">🍽 ${escHtml(recipe.servings)}</span>` : ""}
      ${recipe.prepTime ? `<span class="meta-chip">⏱ Prep: ${escHtml(recipe.prepTime)}</span>` : ""}
      ${recipe.cookTime ? `<span class="meta-chip">🔥 Cook: ${escHtml(recipe.cookTime)}</span>` : ""}
      ${recipe.addedAt ? `<span class="meta-chip">📅 ${formatDate(recipe.addedAt)}</span>` : ""}
    </div>
    ${recipe.sourceUrl ? `<a class="detail-source-link" href="${escHtml(recipe.sourceUrl)}" target="_blank" rel="noopener">🔗 View original recipe</a>` : ""}

    ${recipe.notes ? `
    <div class="detail-section detail-notes">
      <h3>Notes</h3>
      <p>${escHtml(recipe.notes).replace(/\n/g, "<br>")}</p>
    </div>` : ""}

    <div class="detail-section">
      <h3>Ingredients</h3>
      <div id="ingredients-checklist">
        ${recipe.ingredients.map((ing, i) => `
          <div class="ingredient-item" onclick="toggleIngredient(this)" data-index="${i}">
            <div class="ingredient-cb"></div>
            <span class="ingredient-text">${escHtml(ing)}</span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3>Instructions</h3>
      ${recipe.instructions.map((step, i) => `
        <div class="instruction-step">
          <div class="step-num">${i + 1}</div>
          <div>${escHtml(step)}</div>
        </div>
      `).join("")}
    </div>
  `;

  showView("detail");
}

function toggleIngredient(el) {
  el.classList.toggle("checked");
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

// ── Delete ─────────────────────────────────────────
// ── Favourite ──────────────────────────────────────
async function toggleFavourite() {
  const recipe = recipes.find(r => r.id === currentRecipeId);
  if (!recipe) return;
  recipe.favourite = !recipe.favourite;

  const favBtn = document.getElementById("fav-btn");
  favBtn.textContent = recipe.favourite ? "★" : "☆";
  favBtn.classList.toggle("fav-btn--active", recipe.favourite);

  try {
    await refreshSha();
    await saveToGitHub();
    showToast(recipe.favourite ? "Added to favourites." : "Removed from favourites.");
  } catch (e) {
    recipe.favourite = !recipe.favourite; // rollback
    favBtn.textContent = recipe.favourite ? "★" : "☆";
    favBtn.classList.toggle("fav-btn--active", recipe.favourite);
    showToast(`Could not save: ${e.message}`);
  }
}

function confirmDelete() {
  document.getElementById("delete-modal").classList.remove("hidden");
}

function closeDeleteModal() {
  document.getElementById("delete-modal").classList.add("hidden");
}

async function deleteRecipe() {
  closeDeleteModal();
  const idx = recipes.findIndex(r => r.id === currentRecipeId);
  if (idx === -1) return;

  const removed = recipes.splice(idx, 1);
  try {
    await refreshSha();
    await saveToGitHub();
    showToast("Recipe deleted.");
    showView("list");
  } catch (e) {
    recipes.splice(idx, 0, ...removed); // rollback
    showToast(`Could not delete: ${e.message}`);
  }
}

// ── Utilities ──────────────────────────────────────
function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  requestAnimationFrame(() => { t.classList.add("show"); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 300);
  }, 2500);
}

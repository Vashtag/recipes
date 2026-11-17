/* =====================================================
   Our Recipes App
   ===================================================== */

// ── State ──────────────────────────────────────────
let recipes = [];          // loaded from GitHub
let currentRecipeId = null; // recipe open in detail view
let editingId = null;       // non-null when editing an existing recipe
let fileSha = null;         // current SHA of recipes.json (needed for GitHub API writes)
let mealPlanSha = null;     // current SHA of mealplan.json (needed for GitHub API writes)
let shoppingSha = null;     // current SHA of shopping.json (needed for GitHub API writes)

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
    recipes = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
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

// ── Views ──────────────────────────────────────────
function showView(name) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("active", v.id === `view-${name}`);
    v.classList.toggle("hidden", v.id !== `view-${name}`);
  });

  // Show/hide main header (visible on list and favourites)
  document.getElementById("main-header").style.display = (name === "list" || name === "favourites") ? "" : "none";
  // Search bar only useful on list view
  document.querySelector(".header-search-row").style.display = name === "list" ? "" : "none";

  // Update nav active state
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "add" && !editingId) resetAddForm();
  if (name === "list") renderGrid();
  if (name === "favourites") renderFavouritesView();
  if (name === "settings") initSettingsView();
  if (name === "fridge") initFridgeView();
  if (name === "planner") loadMealPlan().then(renderPlanner);
  if (name === "shopping") loadShoppingList().then(renderShoppingList);
  if (name === "categories") initCategoryView();
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
  const errEl = document.getElementById("fetch-error");
  hideMessage(errEl);

  let url = urlInput.value.trim();
  if (!url) {
    showError(errEl, "Please enter a URL.");
    return;
  }
  // Accept "example.com/recipe" without the scheme.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch {
    showError(errEl, "That doesn't look like a valid URL.");
    return;
  }
  url = RecipeExtract.normalizeSourceUrl(url);
  urlInput.value = url;

  setFetchLoading(true);

  try {
    const html = await fetchViaProxy(url);
    const categories = [...document.querySelectorAll("#category-checks input")].map(cb => cb.value);
    const parsed = RecipeExtract.extractRecipe(html, url, { categories });
    if (!parsed.found) {
      throw new Error("Could not find recipe data on this page. Switch to Manual Entry and fill in the details.");
    }

    const notes = [];
    if (parsed.description) notes.push(parsed.description);
    if (parsed.totalTime && !parsed.cookTime && parsed.totalTime !== parsed.prepTime) {
      notes.push(`Total time: ${parsed.totalTime}`);
    }

    populateEditForm({
      ...parsed,
      notes: notes.join("\n\n"),
      ingredients: parsed.ingredients.length ? parsed.ingredients : [""],
      instructions: parsed.instructions.length ? parsed.instructions : [""],
    });
    document.getElementById("edit-form").classList.remove("hidden");

    const warnings = [];
    const dup = findRecipeBySource(url);
    if (dup) warnings.push(`You already saved this recipe as "${dup.title}".`);
    if (parsed.missing.length) {
      const what = parsed.missing.join(" or ");
      warnings.push(`Couldn't find the ${what} on this page. Please fill ${parsed.missing.length > 1 ? "them" : "it"} in below.`);
    }
    if (warnings.length) {
      showWarning(errEl, warnings.join(" "), dup ? { label: "Open saved copy", onClick: () => openRecipe(dup.id) } : null);
    }
  } catch (e) {
    showError(errEl, e.message);
  } finally {
    setFetchLoading(false);
  }
}

// A saved recipe with the same source link, ignoring tracking params, "www.",
// trailing slashes and the #fragment.
function findRecipeBySource(url) {
  const key = RecipeExtract.urlKey(url);
  return recipes.find(r => r.id !== editingId && r.sourceUrl && RecipeExtract.urlKey(r.sourceUrl) === key) || null;
}

// ── Proxies (raced in parallel; the first usable page wins) ────
// Free public proxies come and go, so several are tried at once. For a
// reliable setup, deploy proxy/worker.js and set CONFIG.corsProxy.
const PROXY_TIMEOUT_MS = 20000;
const PUBLIC_PROXIES = [
  {
    name: "allorigins",
    url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    // Wraps the page in JSON and reports the recipe site's own status code.
    read: async (res) => {
      const data = await res.json();
      const code = data?.status?.http_code;
      if (code && code >= 400) throw new SiteError(code);
      return data.contents || "";
    },
  },
  {
    name: "allorigins raw",
    url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
  {
    name: "codetabs",
    url: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  },
  {
    name: "corsproxy",
    url: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  },
  {
    // Jina Reader loads the page in a real browser, which gets past some
    // sites that turn away the other proxies. Asked for HTML, not Markdown.
    name: "jina",
    url: (u) => `https://r.jina.ai/${u}`,
    init: { headers: { "X-Return-Format": "html" } },
  },
];

function activeProxies() {
  const custom = (typeof CONFIG !== "undefined" && CONFIG.corsProxy || "").trim();
  if (!custom) return PUBLIC_PROXIES;
  const own = {
    name: "your proxy",
    url: (u) => custom.includes("{url}") ? custom.replace("{url}", encodeURIComponent(u)) : custom + encodeURIComponent(u),
  };
  return [own, ...PUBLIC_PROXIES];
}

class SiteError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}
class BlockedError extends Error {}

// Short reason for the error message, e.g. "timed out", "HTTP 403".
function proxyFailureReason(e) {
  if (e instanceof BlockedError) return "bot check page";
  if (e instanceof SiteError) return `HTTP ${e.status}`;
  if (e?.name === "AbortError") return "timed out";
  if (e instanceof TypeError) return "unreachable"; // network or CORS failure
  return e?.message || "failed";
}

async function fetchViaProxy(url) {
  const proxies = activeProxies();
  const controllers = proxies.map(() => new AbortController());
  const failures = [];

  const attempts = proxies.map(async (proxy, i) => {
    const ctrl = controllers[i];
    const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
    try {
      const res = await fetch(proxy.url(url), { ...(proxy.init || {}), signal: ctrl.signal });
      if (!res.ok) throw new SiteError(res.status);
      const html = proxy.read ? await proxy.read(res) : await res.text();
      if (!html || html.length < 200) throw new Error("empty page");
      if (RecipeExtract.looksBlocked(html)) throw new BlockedError("blocked");
      return html;
    } catch (e) {
      failures.push({ name: proxy.name, error: e });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    const html = await Promise.any(attempts);
    controllers.forEach(c => c.abort()); // stop the slower proxies
    return html;
  } catch {
    const detail = failures.map(f => `${f.name}: ${proxyFailureReason(f.error)}`).join(", ");
    console.warn("All proxies failed for", url, failures);
    const errors = failures.map(f => f.error);
    if (errors.some(e => e instanceof BlockedError)) {
      throw new Error(`This site blocks automated access (it showed a bot check instead of the recipe). Use Manual Entry. (${detail})`);
    }
    if (errors.filter(e => e instanceof SiteError && e.status === 404).length >= 2) {
      throw new Error(`That page wasn't found (404). Check the link and try again. (${detail})`);
    }
    throw new Error(`Could not fetch the page through any proxy. The free proxies may be down or rate-limited; try again in a minute, or use Manual Entry. (${detail})`);
  }
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
    sourceUrl: RecipeExtract.normalizeSourceUrl(document.getElementById("edit-source").value.trim()),
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
  hideMessage(document.getElementById("fetch-error"));
  document.getElementById("edit-form").classList.add("hidden");

  // Reset to URL tab
  document.querySelectorAll(".tab-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
  document.getElementById("tab-url").classList.add("active");
  document.getElementById("tab-url").classList.remove("hidden");
  document.getElementById("tab-manual").classList.remove("active");
  document.getElementById("tab-manual").classList.add("hidden");
}

// ── Recipe Scaling ─────────────────────────────────
const SCALE_OPTIONS = [0.5, 1, 1.5, 2, 3];
let currentScale = 1;

const UNICODE_FRACTIONS = {
  "¼": 1/4, "½": 1/2, "¾": 3/4, "⅐": 1/7, "⅑": 1/9, "⅒": 1/10,
  "⅓": 1/3, "⅔": 2/3, "⅕": 1/5, "⅖": 2/5, "⅗": 3/5, "⅘": 4/5,
  "⅙": 1/6, "⅚": 5/6, "⅛": 1/8, "⅜": 3/8, "⅝": 5/8, "⅞": 7/8,
};
const UNI_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

// A single quantity: "1 1/2", "2½", "3/4", "½", "0.25", "2"
const QTY_SRC = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*[${UNI_CHARS}]|\\d+\\s*\\/\\s*\\d+|[${UNI_CHARS}]|\\d+(?:\\.\\d+)?)`;
// A quantity or a range of them: "1 1/2-2", "2 to 3"
const RANGE_SRC = `${QTY_SRC}(?:\\s*(?:-|–|—|to)\\s*${QTY_SRC})?`;
const RANGE_PARTS_RE = new RegExp(`^(${QTY_SRC})(?:\\s*(-|–|—|to)\\s*(${QTY_SRC}))?$`, "i");
// Only scale a number that starts the line, opens a parenthetical, or follows an
// alternative separator — so "2 cups" and "(¼ cup)" scale but "9x13 pan" and
// "2% milk" do not.
const QTY_PREFIX_RE = /(?:^|[\/+(]\s*|\b(?:or|and|plus)\s+)$/i;
const QTY_SUFFIX_SKIP_RE = /^\s*(?:%|°|x\s*\d)/i;
// "1 (14 oz) can beans" — a parenthetical right before a container word is a
// package size, not an amount, so it stays as-is.
const PACKAGE_SIZE_RE = /^[^()]*\)\s*(?:can|jar|tin|box|bag|pkg|package|bottle|container|block|stick|carton|loaf|log)s?\b/i;

// Instructions are prose, so a number there is only treated as an amount when a
// measuring unit follows it. Deliberately excludes minutes/hours/inches/degrees.
const MEASURE_UNITS = [
  "cups?", "c\\.", "tablespoons?", "tbsps?\\.?", "tbs\\.?", "teaspoons?", "tsps?\\.?",
  "fl\\.?\\s*ozs?\\.?", "ozs?\\.?", "ounces?", "lbs?\\.?", "pounds?",
  "g", "gs", "grams?", "kgs?", "kilograms?", "mls?", "millilit(?:er|re)s?",
  "lit(?:er|re)s?", "quarts?", "qts?\\.?", "pints?", "pts?\\.?", "gallons?", "gals?\\.?",
  "sticks?", "cloves?", "sprigs?", "handfuls?", "pinch(?:es)?", "dashes|dash", "scoops?",
];
const UNIT_AFTER_RE = new RegExp(`^\\s*(?:${MEASURE_UNITS.join("|")})\\b`, "i");
// Spelled-out units get their plural fixed up after scaling ("2 tablespoon" →
// "2 tablespoons"). Abbreviations like "tbsp" are left exactly as written.
const PLURAL_UNITS = [
  "cup", "tablespoon", "teaspoon", "ounce", "pound", "gram", "kilogram",
  "millilitre", "milliliter", "litre", "liter", "quart", "pint", "gallon",
  "clove", "stick", "sprig", "handful", "scoop", "slice",
];
const PLURAL_UNIT_AFTER_RE = new RegExp(`^(\\s+)(${PLURAL_UNITS.join("|")})(s?)\\b`, "i");
// "add the flour 1 cup at a time" is a technique, not an amount.
const TECHNIQUE_RE = /^\s*\S+\s+at\s+a\s+time\b/i;
// Words that look like ingredient nouns but never mean one.
const NOT_INGREDIENT_WORDS = new Set([
  "minute", "minutes", "min", "mins", "hour", "hours", "hr", "hrs", "second", "seconds", "sec", "secs",
  "day", "days", "week", "weeks", "degree", "degrees", "inch", "inches", "cm", "mm", "time", "times",
  "batch", "batches", "piece", "pieces", "portion", "portions", "half", "halves", "third", "thirds",
  "quarter", "quarters", "side", "sides", "layer", "layers", "step", "steps", "pan", "pans",
  "oven", "sheet", "sheets", "tray", "trays", "bowl", "bowls", "pot", "pots", "skillet",
  "heat", "medium", "high", "low", "more", "the", "and", "for", "with", "until", "about", "into", "over",
]);

function parseQty(str) {
  const s = String(str).trim();
  let m;
  if ((m = s.match(new RegExp(`^(\\d+)\\s*([${UNI_CHARS}])$`)))) return +m[1] + UNICODE_FRACTIONS[m[2]];
  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];
  if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) return +m[1] + (+m[2]) / (+m[3]);
  if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) return (+m[1]) / (+m[2]);
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

// Render a number the way a recipe would: whole numbers, mixed fractions, or
// a short decimal when no tidy fraction is close enough.
function formatQty(value) {
  if (!isFinite(value) || value < 0) return "";
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (frac < 0.02) return String(whole);

  for (const d of [2, 3, 4, 6, 8, 12, 16]) {
    const n = Math.round(frac * d);
    if (n > 0 && Math.abs(frac - n / d) < 0.02) {
      if (n === d) return String(whole + 1);
      const g = gcd(n, d);
      const num = n / g, den = d / g;
      return whole ? `${whole} ${num}/${den}` : `${num}/${den}`;
    }
  }
  return String(Math.round(value * 100) / 100);
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

// Multiply every quantity in a free-form line ("1 1/2 cups flour") by factor.
// opts.html escapes the result and highlights scaled numbers. opts.nouns turns on
// prose mode: a number is only an amount if a unit or a known ingredient follows.
function scaleText(text, factor, asHtml, opts) {
  const src = String(text || "");
  const esc = s => asHtml ? escHtml(s) : s;
  if (!factor || factor === 1) return esc(src);
  const nouns = opts && opts.nouns;

  const re = new RegExp(RANGE_SRC, "gi");
  let out = "", last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    const before = src.slice(0, m.index);
    const after = src.slice(m.index + m[0].length);
    if (QTY_SUFFIX_SKIP_RE.test(after)) continue;
    if (PACKAGE_SIZE_RE.test(after)) continue;
    if (nouns) {
      if (/[\d.,]$/.test(before) || /\dx$/i.test(before)) continue;  // mid-number, or "9x13"
      if (TECHNIQUE_RE.test(after)) continue;
      if (!UNIT_AFTER_RE.test(after) && !startsWithNoun(after, nouns)) continue;
    } else if (!QTY_PREFIX_RE.test(before)) {
      continue;
    }

    const parts = m[0].match(RANGE_PARTS_RE);
    if (!parts) continue;
    const lo = parseQty(parts[1]);
    if (lo === null) continue;
    let scaled = formatQty(lo * factor);
    let finalValue = lo * factor;
    if (parts[3]) {
      const hi = parseQty(parts[3]);
      if (hi === null) continue;
      finalValue = hi * factor;
      scaled += `${parts[2] === "to" ? " to " : parts[2]}${formatQty(hi * factor)}`;
    }
    if (!scaled) continue;

    out += esc(src.slice(last, m.index));
    out += asHtml ? `<span class="qty-scaled">${escHtml(scaled)}</span>` : scaled;
    last = m.index + m[0].length;

    // Keep the unit agreeing with the new number: "2 tablespoon" → "2 tablespoons".
    const unit = after.match(PLURAL_UNIT_AFTER_RE);
    if (unit) {
      const plural = finalValue > 1;
      out += esc(unit[1] + unit[2] + (plural ? (unit[3] || "s") : ""));
      last += unit[0].length;
    }
  }
  return out + esc(src.slice(last));
}

// Naive singular/plural fold so "1 onion" matches an "onions" ingredient.
function normNoun(word) {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 2) return w.slice(0, -1);
  return w;
}

// The nouns a recipe's own ingredient list mentions — the vocabulary that makes
// "add the 3 potatoes" recognisable as an amount rather than a stray number.
function ingredientNouns(recipe) {
  const nouns = new Set();
  for (const line of recipe.ingredients || []) {
    if (sectionHeaderName(line) != null) continue;
    for (const word of String(line).toLowerCase().match(/[a-z]+/g) || []) {
      if (word.length < 3 || NOT_INGREDIENT_WORDS.has(word)) continue;
      if (UNIT_AFTER_RE.test(word)) continue;
      nouns.add(normNoun(word));
    }
  }
  return nouns;
}

function startsWithNoun(after, nouns) {
  const m = after.match(/^\s+([a-z]+)/i);
  return !!m && !NOT_INGREDIENT_WORDS.has(m[1].toLowerCase()) && nouns.has(normNoun(m[1]));
}

function scaleLabel(f) {
  return (f === 0.5 ? "½" : String(f)) + "×";
}

function scaleBarHtml() {
  return `
    <div class="scale-bar">
      <span class="scale-bar-label">Scale</span>
      ${SCALE_OPTIONS.map(f => `
        <button type="button" class="scale-btn${f === currentScale ? " active" : ""}" data-scale="${f}" onclick="setScale(${f})">${scaleLabel(f)}</button>
      `).join("")}
    </div>`;
}

function setScale(factor) {
  currentScale = factor;
  applyScale();
}

function detailIngredientsHtml(recipe) {
  return recipe.ingredients.map((ing, i) => sectionHeaderName(ing) != null
    ? `<div class="list-group-header">${escHtml(sectionHeaderName(ing))}</div>`
    : `
    <div class="ingredient-item" onclick="toggleIngredient(this)" data-index="${i}">
      <div class="ingredient-cb"></div>
      <span class="ingredient-text">${scaleText(ing, currentScale, true)}</span>
    </div>
  `).join("");
}

// Step numbers that skip "— Section —" header lines.
function stepNumbers(steps) {
  let n = 0;
  return steps.map(s => (sectionHeaderName(s) != null ? null : ++n));
}

function detailInstructionsHtml(recipe) {
  const nouns = ingredientNouns(recipe);
  const nums = stepNumbers(recipe.instructions);
  return recipe.instructions.map((step, i) => nums[i] == null
    ? `<div class="list-group-header">${escHtml(sectionHeaderName(step))}</div>`
    : `
    <div class="instruction-step">
      <div class="step-num">${nums[i]}</div>
      <div>${scaleText(step, currentScale, true, { nouns })}</div>
    </div>
  `).join("");
}

function cookInstructionsHtml(recipe) {
  const nouns = ingredientNouns(recipe);
  const nums = stepNumbers(recipe.instructions);
  return recipe.instructions.map((step, i) => nums[i] == null
    ? `<div class="list-group-header">${escHtml(sectionHeaderName(step))}</div>`
    : `
    <div class="cook-step" onclick="this.classList.toggle('done')">
      <div class="step-num">${nums[i]}</div>
      <div>${scaleText(step, currentScale, true, { nouns })}</div>
    </div>
  `).join("");
}

function cookIngredientsHtml(recipe) {
  return recipe.ingredients.map((ing, i) => sectionHeaderName(ing) != null
    ? `<div class="list-group-header">${escHtml(sectionHeaderName(ing))}</div>`
    : `
    <div class="cook-ingredient" onclick="this.classList.toggle('checked')" data-index="${i}">
      <div class="ingredient-cb"></div>
      <span>${scaleText(ing, currentScale, true)}</span>
    </div>
  `).join("");
}

// Re-render everything that depends on the scale, preserving ticked-off items.
function applyScale() {
  const recipe = recipes.find(r => r.id === currentRecipeId);
  if (!recipe) return;

  document.querySelectorAll(".scale-btn").forEach(btn => {
    btn.classList.toggle("active", parseFloat(btn.dataset.scale) === currentScale);
  });

  const chip = document.getElementById("detail-servings-chip");
  if (chip && recipe.servings) {
    chip.innerHTML = `🍽 ${scaleText(recipe.servings, currentScale, true)}`;
  }

  const list = document.getElementById("ingredients-checklist");
  if (list) rerenderChecklist(list, detailIngredientsHtml(recipe), ".ingredient-item");

  const cookList = document.getElementById("cook-ingredients");
  if (cookList) rerenderChecklist(cookList, cookIngredientsHtml(recipe), ".cook-ingredient");

  const steps = document.getElementById("detail-instructions");
  if (steps) steps.innerHTML = detailInstructionsHtml(recipe);

  const cookSteps = document.getElementById("cook-steps");
  if (cookSteps) {
    const done = [...cookSteps.querySelectorAll(".cook-step")].map(el => el.classList.contains("done"));
    cookSteps.innerHTML = cookInstructionsHtml(recipe);
    cookSteps.querySelectorAll(".cook-step").forEach((el, i) => {
      if (done[i]) el.classList.add("done");
    });
  }
}

function rerenderChecklist(container, html, itemSelector) {
  const checked = new Set(
    [...container.querySelectorAll(`${itemSelector}.checked`)].map(el => el.dataset.index)
  );
  container.innerHTML = html;
  container.querySelectorAll(itemSelector).forEach(el => {
    if (checked.has(el.dataset.index)) el.classList.add("checked");
  });
}

// ── Recipe Detail ──────────────────────────────────
function openRecipe(id) {
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;
  currentRecipeId = id;
  currentScale = 1;

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
      ${recipe.servings ? `<span class="meta-chip" id="detail-servings-chip">🍽 ${escHtml(recipe.servings)}</span>` : ""}
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

    <div class="detail-section detail-section--ingredients">
      <h3>Ingredients</h3>
      ${scaleBarHtml()}
      <div id="ingredients-checklist">
        ${detailIngredientsHtml(recipe)}
      </div>
    </div>

    <div class="detail-section detail-section--instructions">
      <h3>Instructions</h3>
      <div id="detail-instructions">
        ${detailInstructionsHtml(recipe)}
      </div>
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

// ── Cook Mode ──────────────────────────────────────
let wakeLock = null;

async function enterCookMode() {
  const recipe = recipes.find(r => r.id === currentRecipeId);
  if (!recipe) return;

  document.getElementById("cook-mode-title").textContent = recipe.title;

  document.getElementById("cook-scale-bar").innerHTML = scaleBarHtml();
  document.getElementById("cook-ingredients").innerHTML = cookIngredientsHtml(recipe);

  document.getElementById("cook-steps").innerHTML = cookInstructionsHtml(recipe);

  document.getElementById("cook-mode").classList.remove("hidden");
  document.body.classList.add("cook-mode-open");

  // Request Wake Lock to keep screen on
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      document.getElementById("cook-wakelock-badge").classList.remove("hidden");
      wakeLock.addEventListener("release", () => {
        document.getElementById("cook-wakelock-badge").classList.add("hidden");
      });
    } catch (e) {
      // Wake Lock not granted — silently continue
    }
  }
}

function exitCookMode() {
  document.getElementById("cook-mode").classList.add("hidden");
  document.body.classList.remove("cook-mode-open");
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire wake lock if page becomes visible again while cook mode is open
document.addEventListener("visibilitychange", async () => {
  if (wakeLock !== null && document.visibilityState === "visible") {
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  }
});

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
  el.classList.remove("is-warning");
  el.classList.remove("hidden");
}

// Same box as showError, styled as a warning, with an optional action button.
function showWarning(el, msg, action) {
  el.textContent = `⚠️ ${msg}`;
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msg-action";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    el.append(" ", btn);
  }
  el.classList.add("is-warning");
  el.classList.remove("hidden");
}

function hideMessage(el) {
  el.classList.add("hidden");
  el.classList.remove("is-warning");
  el.textContent = "";
}

// Ingredient and instruction lists can hold group headers written as "— Name —".
function sectionHeaderName(line) {
  const m = String(line).match(/^\s*[—–]\s*(.+?)\s*[—–]\s*$/);
  return m ? m[1] : null;
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

// ── Meal Planner ───────────────────────────────────
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
const MEAL_PLAN_FILE = "data/mealplan.json";

let mealPlan = {};
let pickerTargetDay = null;

async function loadMealPlan() {
  try {
    const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${MEAL_PLAN_FILE}?ref=${getBranch()}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) { mealPlan = {}; mealPlanSha = null; return; }
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
    const data = await res.json();
    mealPlanSha = data.sha;
    mealPlan = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
  } catch (e) {
    console.warn("Could not load meal plan:", e.message);
    mealPlan = {};
    mealPlanSha = null;
  }
}

async function saveMealPlan() {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(mealPlan, null, 2))));
  const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${MEAL_PLAN_FILE}`;
  const body = { message: "Update meal plan", content, branch: getBranch() };
  if (mealPlanSha) body.sha = mealPlanSha;
  const res = await fetch(url, { method: "PUT", headers: ghHeaders(true), body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try {
      const err = await res.json();
      if (res.status === 409) msg = "Conflict: someone else saved at the same time. Please reload.";
      else msg = err.message || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const data = await res.json();
  mealPlanSha = data.content.sha;
}

function renderPlanner() {
  const container = document.getElementById("planner-days");
  container.innerHTML = DAY_KEYS.map((key, i) => {
    const recipeId = mealPlan[key];
    const recipe = recipeId ? recipes.find(r => r.id === recipeId) : null;
    return `
      <div class="planner-day" data-day="${key}">
        <div class="planner-day-label">${DAYS[i]}</div>
        ${recipe ? `
          <div class="planner-recipe-card" onclick="openRecipe('${recipe.id}')">
            ${recipe.image
              ? `<img class="planner-thumb" src="${escHtml(recipe.image)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                 <div class="planner-thumb-placeholder" style="display:none">🍽️</div>`
              : `<div class="planner-thumb-placeholder">🍽️</div>`}
            <span class="planner-recipe-title">${escHtml(recipe.title)}</span>
            <button class="planner-remove-btn" onclick="event.stopPropagation();removePlanDay('${key}')" title="Remove">✕</button>
          </div>
        ` : `
          <button class="planner-add-btn" onclick="openRecipePicker('${key}')">＋ Add recipe</button>
        `}
      </div>
    `;
  }).join("");
}

function openRecipePicker(dayKey) {
  pickerTargetDay = dayKey;
  const dayIndex = DAY_KEYS.indexOf(dayKey);
  document.getElementById("picker-title").textContent = `${DAYS[dayIndex]} — pick a recipe`;
  document.getElementById("picker-search").value = "";
  renderPickerList();
  document.getElementById("picker-modal").classList.remove("hidden");
}

function renderPickerList() {
  const q = document.getElementById("picker-search").value.trim().toLowerCase();
  const list = document.getElementById("picker-list");
  const filtered = q ? recipes.filter(r => r.title.toLowerCase().includes(q)) : recipes;
  if (filtered.length === 0) {
    list.innerHTML = `<p class="picker-empty">No recipes found.</p>`;
    return;
  }
  list.innerHTML = filtered.map(r => `
    <div class="picker-item" onclick="assignRecipe('${r.id}')">
      ${r.image ? `<img class="picker-item-thumb" src="${escHtml(r.image)}" alt="" onerror="this.style.display='none'">` : `<div class="picker-item-thumb picker-item-thumb--empty">🍽️</div>`}
      <span>${escHtml(r.title)}</span>
    </div>
  `).join("");
}

async function assignRecipe(recipeId) {
  if (!pickerTargetDay) return;
  mealPlan[pickerTargetDay] = recipeId;
  closeRecipePicker();
  renderPlanner();
  try { await saveMealPlan(); }
  catch (e) { showToast("Could not save meal plan: " + e.message); }
}

function closeRecipePicker() {
  document.getElementById("picker-modal").classList.add("hidden");
  pickerTargetDay = null;
}

async function removePlanDay(dayKey) {
  delete mealPlan[dayKey];
  renderPlanner();
  try { await saveMealPlan(); }
  catch (e) { showToast("Could not save meal plan: " + e.message); }
}

async function confirmResetPlan() {
  if (Object.keys(mealPlan).length === 0) return;
  if (confirm("Clear the whole week?")) {
    mealPlan = {};
    renderPlanner();
    try { await saveMealPlan(); }
    catch (e) { showToast("Could not save meal plan: " + e.message); }
  }
}

// ── Shopping List ──────────────────────────────────
const SHOPPING_FILE = "data/shopping.json";
let shoppingItems = []; // [{ id, text, checked }]

async function loadShoppingList() {
  try {
    const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${SHOPPING_FILE}?ref=${getBranch()}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) { shoppingItems = []; shoppingSha = null; return; }
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
    const data = await res.json();
    shoppingSha = data.sha;
    const parsed = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
    shoppingItems = Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch (e) {
    console.warn("Could not load shopping list:", e.message);
    shoppingItems = [];
    shoppingSha = null;
  }
}

async function saveShoppingList() {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({ items: shoppingItems }, null, 2))));
  const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${SHOPPING_FILE}`;
  const body = { message: "Update shopping list", content, branch: getBranch() };
  if (shoppingSha) body.sha = shoppingSha;
  const res = await fetch(url, { method: "PUT", headers: ghHeaders(true), body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try {
      const err = await res.json();
      if (res.status === 409) msg = "Conflict: someone else saved at the same time. Please reload.";
      else msg = err.message || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const data = await res.json();
  shoppingSha = data.content.sha;
}

async function persistShop(afterMsg) {
  const snapshot = JSON.stringify(shoppingItems);
  renderShoppingList();
  try {
    await saveShoppingList();
    if (afterMsg) showToast(afterMsg);
  } catch (e) {
    shoppingItems = JSON.parse(snapshot);
    renderShoppingList();
    showToast("Could not save list: " + e.message);
  }
}

function addManualShopItem() {
  const input = document.getElementById("shop-manual-input");
  const val = input.value.trim();
  if (!val) return;
  shoppingItems.push({ id: crypto.randomUUID(), text: val, checked: false });
  input.value = "";
  input.focus();
  persistShop();
}

function toggleShopItem(id) {
  const it = shoppingItems.find(x => x.id === id);
  if (!it) return;
  it.checked = !it.checked;
  persistShop();
}

function removeShopItem(id) {
  shoppingItems = shoppingItems.filter(x => x.id !== id);
  persistShop();
}

function clearCheckedShop() {
  if (!shoppingItems.some(x => x.checked)) return;
  shoppingItems = shoppingItems.filter(x => !x.checked);
  persistShop("Cleared ticked items.");
}

function confirmClearAllShop() {
  if (shoppingItems.length === 0) return;
  if (confirm("Clear the entire shopping list?")) {
    shoppingItems = [];
    persistShop("Shopping list cleared.");
  }
}

function renderShoppingList() {
  const list = document.getElementById("shopping-list");
  const empty = document.getElementById("shopping-empty");
  if (!list) return;

  const checkedBtn = document.getElementById("shop-clear-checked-btn");
  const clearAllBtn = document.getElementById("shop-clear-all-btn");
  checkedBtn.classList.toggle("hidden", !shoppingItems.some(x => x.checked));
  clearAllBtn.classList.toggle("hidden", shoppingItems.length === 0);

  if (shoppingItems.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  // Unticked first (in order added), ticked sink to the bottom.
  const ordered = [...shoppingItems].sort((a, b) => (a.checked === b.checked) ? 0 : a.checked ? 1 : -1);
  list.innerHTML = ordered.map(it => `
    <div class="shop-item${it.checked ? " checked" : ""}" onclick="toggleShopItem('${it.id}')">
      <div class="ingredient-cb"></div>
      <span class="shop-item-text">${escHtml(it.text)}</span>
      <button class="shop-remove-btn" onclick="event.stopPropagation();removeShopItem('${it.id}')" title="Remove">✕</button>
    </div>
  `).join("");
}

// ── Category Browser ────────────────────────────────
const CATEGORIES = ["Breakfast","Lunch","Dinner","Pasta","Soup","Salad","Cookie","Cake","Sweet Treat","Persian","Bread","Sourdough","Vegetarian","Other"];

let activeCategories = [];

function initCategoryView() {
  renderCategoryPills();
  renderCategoryResults();
}

function renderCategoryPills() {
  document.getElementById("cat-pills").innerHTML = CATEGORIES.map(cat => `
    <button class="cat-pill${activeCategories.includes(cat) ? " active" : ""}" onclick="toggleCategory('${cat}')">${cat}</button>
  `).join("");
}

function toggleCategory(cat) {
  const idx = activeCategories.indexOf(cat);
  if (idx === -1) activeCategories.push(cat);
  else activeCategories.splice(idx, 1);
  renderCategoryPills();
  renderCategoryResults();
}

function renderCategoryResults() {
  const grid = document.getElementById("cat-results");
  const empty = document.getElementById("cat-empty");

  if (activeCategories.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  const filtered = recipes.filter(r =>
    activeCategories.some(cat => (r.category || []).includes(cat))
  );

  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").innerHTML = "No recipes found<br>for the selected categories.";
  } else {
    empty.classList.add("hidden");
    grid.innerHTML = filtered.map(recipeCardHtml).join("");
  }
}

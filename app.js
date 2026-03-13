/* =====================================================
   Our Recipes App
   ===================================================== */

// ── State ──────────────────────────────────────────
let recipes = [];          // loaded from GitHub
let currentRecipeId = null; // recipe open in detail view
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

// ── Settings ───────────────────────────────────────
function saveToken() {
  const val = document.getElementById("settings-token").value.trim();
  if (!val) {
    showSettingsStatus("Please paste a token first.", "error"); return;
  }
  localStorage.setItem("gh_token", val);
  document.getElementById("settings-token").value = "";
  showSettingsStatus("Token saved! Loading recipes…", "ok");
  checkConfig();
  loadRecipes();
}

function clearToken() {
  localStorage.removeItem("gh_token");
  document.getElementById("settings-token").value = "";
  showSettingsStatus("Token cleared.", "ok");
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
}

// ── GitHub API helpers ─────────────────────────────
const GH_API = "https://api.github.com";

function getToken() {
  return localStorage.getItem("gh_token") || "";
}

function ghHeaders() {
  return {
    Authorization: `token ${getToken()}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

async function loadRecipes() {
  try {
    const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}?ref=${CONFIG.githubBranch}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 401) {
      showBanner("⚠️ GitHub token is invalid or expired. Open <code>config.js</code> and update <code>githubToken</code>.", "warn");
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
    branch: CONFIG.githubBranch,
  };
  if (fileSha) body.sha = fileSha;

  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try {
      const err = await res.json();
      if (res.status === 401) msg = "Bad credentials — check your GitHub token in config.js";
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

  grid.innerHTML = filtered.map(r => `
    <div class="recipe-card" onclick="openRecipe('${r.id}')">
      ${r.image
        ? `<img class="card-img" src="${escHtml(r.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ""}
      <div class="card-img-placeholder" style="${r.image ? "display:none" : ""}">🍽️</div>
      <div class="card-body">
        <h3>${escHtml(r.title)}</h3>
        ${r.sourceUrl ? `<p class="card-source">${sourceDomain(r.sourceUrl)}</p>` : ""}
      </div>
    </div>
  `).join("");
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

  // Show/hide main header
  document.getElementById("main-header").style.display = name === "list" ? "" : "none";

  // Update nav active state
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "add") resetAddForm();
  if (name === "list") renderGrid();
  if (name === "settings") initSettingsView();
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
  document.getElementById("edit-servings").value = data.servings || "";
  document.getElementById("edit-source").value = data.sourceUrl || "";

  const imgPreview = document.getElementById("edit-image-preview");
  if (data.image) {
    imgPreview.src = data.image;
    imgPreview.classList.remove("hidden");
  } else {
    imgPreview.classList.add("hidden");
  }

  renderIngredients(data.ingredients || []);
  renderInstructions(data.instructions || []);
}

function clearEditForm() {
  populateEditForm({ title: "", image: "", servings: "", sourceUrl: "", ingredients: [""], instructions: [""] });
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

  const recipe = {
    id: crypto.randomUUID(),
    title,
    image: document.getElementById("edit-image").value.trim(),
    servings: document.getElementById("edit-servings").value.trim(),
    sourceUrl: document.getElementById("edit-source").value.trim(),
    ingredients,
    instructions,
    addedAt: new Date().toISOString(),
  };

  setSaveLoading(true);
  try {
    // Re-fetch SHA in case someone else saved since we loaded
    await refreshSha();
    recipes.unshift(recipe);
    await saveToGitHub();
    showToast("Recipe saved!");
    showView("list");
  } catch (e) {
    recipes.shift(); // rollback
    showError(errEl, `Could not save: ${e.message}`);
  } finally {
    setSaveLoading(false);
  }
}

async function refreshSha() {
  const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}?ref=${CONFIG.githubBranch}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return; // file doesn't exist yet — first save will create it
  if (res.status === 401) throw new Error("Bad credentials — check your GitHub token in config.js");
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

  const content = document.getElementById("detail-content");
  content.innerHTML = `
    ${recipe.image
      ? `<img class="detail-hero" src="${escHtml(recipe.image)}" alt="${escHtml(recipe.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : ""}
    <div class="detail-hero-placeholder" style="${recipe.image ? "display:none" : ""}">🍽️</div>

    <div class="detail-meta">
      ${recipe.servings ? `<span class="meta-chip">🍽 ${escHtml(recipe.servings)}</span>` : ""}
      ${recipe.addedAt ? `<span class="meta-chip">📅 ${formatDate(recipe.addedAt)}</span>` : ""}
    </div>
    ${recipe.sourceUrl ? `<a class="detail-source-link" href="${escHtml(recipe.sourceUrl)}" target="_blank" rel="noopener">🔗 View original recipe</a>` : ""}

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
    // Remove again after refresh (index may have changed)
    const idx2 = recipes.findIndex(r => r.id === currentRecipeId);
    if (idx2 !== -1) recipes.splice(idx2, 1);
    await saveToGitHub();
    showToast("Recipe deleted.");
    showView("list");
  } catch (e) {
    recipes.splice(idx, 0, ...removed); // rollback
    showToast("Could not delete — try again.");
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

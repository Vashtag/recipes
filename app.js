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
  loadRecipes();

  document.getElementById("search-input").addEventListener("input", renderGrid);
});

// ── GitHub API helpers ─────────────────────────────
const GH_API = "https://api.github.com";

function ghHeaders() {
  return {
    Authorization: `token ${CONFIG.githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

async function loadRecipes() {
  try {
    const url = `${GH_API}/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.dataFile}?ref=${CONFIG.githubBranch}`;
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
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
    const err = await res.json();
    throw new Error(err.message || `GitHub API ${res.status}`);
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
      throw new Error("Could not find recipe data on this page. Try manual entry instead.");
    }
    populateEditForm(parsed);
    document.getElementById("edit-form").classList.remove("hidden");
  } catch (e) {
    showError(errEl, e.message);
  } finally {
    setFetchLoading(false);
  }
}

async function fetchViaProxy(url) {
  // Try allorigins first
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  if (!res.ok) throw new Error("Could not fetch the page. Check your internet and try again.");
  const data = await res.json();
  if (!data.contents) throw new Error("The page returned empty content.");
  return data.contents;
}

function parseRecipeFromHtml(html, sourceUrl) {
  // 1. Try JSON-LD structured data (most reliable)
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdMatches) {
    try {
      let data = JSON.parse(match[1]);
      // Some pages wrap it in @graph
      if (data["@graph"]) data = data["@graph"].find(n => n["@type"] === "Recipe" || (Array.isArray(n["@type"]) && n["@type"].includes("Recipe")));
      if (!data) continue;
      if (data["@type"] === "Recipe" || (Array.isArray(data["@type"]) && data["@type"].includes("Recipe"))) {
        return extractFromJsonLd(data, sourceUrl);
      }
    } catch { /* skip malformed */ }
  }

  // 2. Try Open Graph / meta tags fallback (partial data only)
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title") || htmlTitle(html);
  const image = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  if (title) {
    return { title, image: image || "", ingredients: [], instructions: [], servings: "", sourceUrl };
  }

  return null;
}

function extractFromJsonLd(data, sourceUrl) {
  const title = textOf(data.name) || "";
  const image = imageUrl(data.image) || "";
  const servings = textOf(data.recipeYield) || textOf(data.yield) || "";

  const ingredients = (data.recipeIngredient || []).map(textOf).filter(Boolean);

  let instructions = [];
  const raw = data.recipeInstructions || [];
  if (typeof raw === "string") {
    instructions = raw.split(/\n|\r\n/).map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(raw)) {
    instructions = raw.flatMap(step => {
      if (typeof step === "string") return [step.trim()];
      if (step["@type"] === "HowToSection") {
        return (step.itemListElement || []).map(s => textOf(s.text || s.name || s));
      }
      return [textOf(step.text || step.name || step)];
    }).filter(Boolean);
  }

  return { title, image, ingredients, instructions, servings, sourceUrl };
}

function textOf(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(textOf).join(", ");
  return String(v).trim();
}

function imageUrl(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return imageUrl(v[0]);
  if (v.url) return v.url;
  return "";
}

function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1] : null;
}

function htmlTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
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
  if (!res.ok) return; // if file doesn't exist yet, SHA stays null
  const data = await res.json();
  fileSha = data.sha;
  // Also update local recipes to avoid clobbering concurrent changes
  const fresh = JSON.parse(atob(data.content.replace(/\n/g, "")));
  recipes = fresh;
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

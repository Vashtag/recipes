// Run with: npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const X = require("../extract.js");

X.setDomParser(new JSDOM("").window.DOMParser);

const CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Pasta", "Soup", "Salad", "Cookie", "Cake",
  "Sweet Treat", "Persian", "Bread", "Sourdough", "Vegetarian", "Other"];

const page = (head, body = "") =>
  `<!doctype html><html><head><title>Some Blog</title>${head}</head><body>${body}${"<p>filler</p>".repeat(30)}</body></html>`;
const ld = obj => `<script type="application/ld+json">${typeof obj === "string" ? obj : JSON.stringify(obj)}</script>`;
const extract = (html, url = "https://example.com/r/") => X.extractRecipe(html, url, { categories: CATEGORIES });

// ── Bugs from the review ─────────────────────────────

test("instructions given as one HTML string are split into steps", () => {
  const r = extract(page(ld({
    "@type": "Recipe", name: "Toast",
    recipeIngredient: ["bread"],
    recipeInstructions: "<p>Step one.</p>\n<p>Step two.</p><br>Step three.",
  })));
  assert.deepEqual(r.instructions, ["Step one.", "Step two.", "Step three."]);
});

test("prep and cook times are converted from ISO durations", () => {
  const r = extract(page(ld({
    "@type": "Recipe", name: "Stew", recipeIngredient: ["beef"], recipeInstructions: ["Cook."],
    prepTime: "PT25M", cookTime: "PT1H30M", totalTime: "P0DT1H55M",
  })));
  assert.equal(r.prepTime, "25 mins");
  assert.equal(r.cookTime, "1 hr 30 mins");
  assert.equal(r.totalTime, "1 hr 55 mins");
  assert.equal(X.formatDuration("PT0M"), "");
  assert.equal(X.formatDuration("P1DT2H"), "1 day 2 hrs");
  assert.equal(X.formatDuration("20 minutes"), "20 minutes");
});

test("yield arrays are not doubled up", () => {
  assert.equal(X.pickYield(["4", "4 servings"]), "4 servings");
  assert.equal(X.pickYield(["12"]), "12");
  assert.equal(X.pickYield(8), "8");
});

test("HTML entities are decoded exactly once", () => {
  const r = extract(page(ld({
    "@type": "Recipe", name: "Mom&#8217;s Pie &amp; Cream",
    recipeIngredient: ["&#189; cup sugar", "350&deg;F oven", "&amp;lt;b&amp;gt; literal"],
    recipeInstructions: ["Bake &lt;b&gt;hot&lt;/b&gt;."],
  })));
  assert.equal(r.title, "Mom’s Pie & Cream");
  assert.deepEqual(r.ingredients, ["½ cup sugar", "350°F oven", "&lt;b&gt; literal"]);
  assert.deepEqual(r.instructions, ["Bake <b>hot</b>."]);
});

test("microdata is scoped to the Recipe and handles nested markup", () => {
  const html = page("", `
    <div itemscope itemtype="https://schema.org/WebSite"><span itemprop="name">My Food Blog</span></div>
    <div itemscope itemtype="http://schema.org/Recipe">
      <div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Jane</span></div>
      <h1 itemprop="name">Pancakes</h1>
      <img itemprop="image" src="/img/pancakes.jpg">
      <ul>
        <li itemprop="recipeIngredient"><span>2</span> cups <b>flour</b></li>
        <li itemprop="recipeIngredient">1 egg</li>
      </ul>
      <meta itemprop="prepTime" content="PT10M">
      <div itemprop="recipeInstructions"><p>Mix.</p><p>Fry.</p></div>
    </div>`);
  const r = extract(html, "https://blog.example.com/pancakes/");
  assert.equal(r.title, "Pancakes");
  assert.deepEqual(r.ingredients, ["2 cups flour", "1 egg"]);
  assert.deepEqual(r.instructions, ["Mix.", "Fry."]);
  assert.equal(r.image, "https://blog.example.com/img/pancakes.jpg");
  assert.equal(r.prepTime, "10 mins");
  assert.ok(r.category.includes("Breakfast"));
});

// ── JSON-LD shapes ───────────────────────────────────

test("finds a Recipe inside a Yoast @graph", () => {
  const r = extract(page(ld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Page" },
      { "@type": ["Recipe"], name: "Graph Cake", recipeIngredient: ["flour"], recipeInstructions: [{ "@type": "HowToStep", text: "Bake." }] },
    ],
  })));
  assert.equal(r.title, "Graph Cake");
  assert.deepEqual(r.sources[0], "json-ld");
});

test("finds a Recipe under mainEntity and inside an array of graphs", () => {
  const html = page(ld([{ "@graph": [{ "@type": "WebPage", mainEntity: {
    "@type": "http://schema.org/Recipe", name: "Deep", recipeIngredient: ["x"], recipeInstructions: ["y"],
  } }] }]));
  assert.equal(extract(html).title, "Deep");
});

test("does not mistake RecipeCollection for a Recipe", () => {
  const nodes = X.findRecipeNodes({ "@type": "RecipeCollection", name: "Best soups" });
  assert.equal(nodes.length, 0);
});

test("nested HowToSections and steps with sub-steps", () => {
  const lines = X.instructionLines([
    { "@type": "HowToSection", name: "Dough", itemListElement: [
      { "@type": "HowToStep", text: "Mix flour." },
      { "@type": "HowToSection", name: "Shaping", itemListElement: [{ "@type": "HowToStep", text: "Roll." }] },
    ] },
    { "@type": "HowToStep", itemListElement: [{ "@type": "HowToDirection", text: "Bake 20 min." }] },
    { "@type": "ListItem", item: { "@type": "HowToStep", text: "Cool." } },
  ]);
  assert.deepEqual(lines, ["— Dough —", "Mix flour.", "— Shaping —", "Roll.", "Bake 20 min.", "Cool."]);
});

test("JSON-LD wrapped in CDATA or with raw newlines still parses", () => {
  const raw = `//<![CDATA[
{"@type":"Recipe","name":"Line
Break","recipeIngredient":["a"],"recipeInstructions":["b"]}
//]]>`;
  assert.equal(extract(page(ld(raw))).title, "Line Break");
});

test("ingredient string with line breaks is split", () => {
  const r = extract(page(ld({ "@type": "Recipe", name: "R", recipeIngredient: "1 egg\n2 cups milk", recipeInstructions: "Mix" })));
  assert.deepEqual(r.ingredients, ["1 egg", "2 cups milk"]);
});

// ── Images ───────────────────────────────────────────

test("picks the widest image and resolves relative URLs", () => {
  const base = "https://site.com/recipes/x/";
  assert.equal(X.pickImage([
    { "@type": "ImageObject", url: "/a.jpg", width: 300 },
    { "@type": "ImageObject", url: "/b.jpg", width: 1200 },
  ], base), "https://site.com/b.jpg");
  assert.equal(X.pickImage([
    "https://site.com/p-225x225.jpg", "https://site.com/p-720x540.jpg", "https://site.com/p-480x270.jpg",
  ], base), "https://site.com/p-720x540.jpg");
  assert.equal(X.pickImage("img/p.jpg", base), "https://site.com/recipes/x/img/p.jpg");
  assert.equal(X.pickImage("javascript:alert(1)", base), "");
});

test("falls back to og:image when the recipe has none", () => {
  const r = extract(page(`<meta property="og:image" content="/og.jpg">` + ld({
    "@type": "Recipe", name: "No pic", recipeIngredient: ["a"], recipeInstructions: ["b"],
  })), "https://site.com/r");
  assert.equal(r.image, "https://site.com/og.jpg");
});

// ── Fallbacks and merging ────────────────────────────

const WPRM = `
  <div class="wprm-recipe-container"><div class="wprm-recipe">
    <h2 class="wprm-recipe-name">Plugin Bread</h2>
    <div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name">Dough</h4>
      <ul><li class="wprm-recipe-ingredient"><span>3</span> <span>cups</span> <span>flour</span></li>
          <li class="wprm-recipe-ingredient">1 tsp salt</li></ul></div>
    <div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name">Topping</h4>
      <ul><li class="wprm-recipe-ingredient">seeds</li></ul></div>
    <div class="wprm-recipe-instruction-group">
      <ul><li><div class="wprm-recipe-instruction-text">Knead.</div></li>
          <li><div class="wprm-recipe-instruction-text">Bake.</div></li></ul></div>
  </div></div>`;

test("WP Recipe Maker markup, with ingredient groups", () => {
  const r = extract(page("", WPRM));
  assert.equal(r.title, "Plugin Bread");
  assert.deepEqual(r.ingredients, ["— Dough —", "3 cups flour", "1 tsp salt", "— Topping —", "seeds"]);
  assert.deepEqual(r.instructions, ["Knead.", "Bake."]);
  assert.ok(r.category.includes("Bread"));
});

test("fills fields JSON-LD lacks from the next strategy", () => {
  const r = extract(page(ld({ "@type": "Recipe", name: "Half Recipe", prepTime: "PT5M", recipeIngredient: [] }), WPRM));
  assert.equal(r.title, "Half Recipe");
  assert.equal(r.prepTime, "5 mins");
  assert.equal(r.ingredients.length, 5);
  assert.deepEqual(r.sources, ["json-ld", "plugin"]);
  assert.equal(r.partial, false);
});

test("Tasty Recipes markup", () => {
  const r = extract(page("", `<div class="tasty-recipes"><h2 class="tasty-recipes-title">Tasty</h2>
    <div class="tasty-recipes-ingredients"><ul><li>1 a</li><li>2 b</li></ul></div>
    <div class="tasty-recipes-instructions"><ol><li>Do it.</li></ol></div></div>`));
  assert.equal(r.title, "Tasty");
  assert.deepEqual(r.ingredients, ["1 a", "2 b"]);
});

test("generic 'Ingredients' and 'Directions' headings followed by lists", () => {
  const r = extract(page(`<meta property="og:title" content="Grandma's Soup">`,
    `<h2>Ingredients</h2><ul><li>1 onion</li><li>2 carrots</li></ul>
     <h3>Directions</h3><div><ol><li>Chop.</li><li>Simmer.</li></ol></div>`));
  assert.equal(r.title, "Grandma's Soup");
  assert.deepEqual(r.ingredients, ["1 onion", "2 carrots"]);
  assert.deepEqual(r.instructions, ["Chop.", "Simmer."]);
  assert.ok(r.category.includes("Soup"));
});

test("reports exactly what is missing", () => {
  const r = extract(page(`<meta property="og:title" content="Just a title">`));
  assert.equal(r.found, true);
  assert.deepEqual(r.missing, ["ingredients", "instructions"]);
  assert.equal(r.partial, true);
});

// ── Blocked pages ────────────────────────────────────

test("detects bot-check pages but not real recipe pages", () => {
  const cf = `<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>`;
  assert.equal(X.looksBlocked(cf), true);
  assert.equal(extract(cf).blocked, true);
  assert.equal(X.looksBlocked(page(ld({ "@type": "Recipe", name: "Fine" }), "<div class='g-recaptcha'></div>")), false);
});

// ── URLs and categories ──────────────────────────────

test("normalizeSourceUrl strips tracking parameters and fragments", () => {
  assert.equal(
    X.normalizeSourceUrl("https://site.com/r/?utm_source=pin&utm_medium=x&fbclid=abc&page=2#wprm-recipe-container-12"),
    "https://site.com/r/?page=2");
  assert.equal(X.normalizeSourceUrl("https://site.com/r/"), "https://site.com/r/");
});

test("urlKey treats www, trailing slash and tracking params as the same recipe", () => {
  assert.equal(X.urlKey("https://www.site.com/r/?utm_source=x"), X.urlKey("http://site.com/r"));
  assert.notEqual(X.urlKey("https://site.com/r/a"), X.urlKey("https://site.com/r/b"));
});

test("suggests categories from recipeCategory, cuisine, keywords and title", () => {
  const r = extract(page(ld({
    "@type": "Recipe", name: "Sourdough Loaf", recipeCategory: "Dessert", recipeCuisine: ["Iranian"],
    keywords: "easy, vegan", recipeIngredient: ["a"], recipeInstructions: ["b"],
  })));
  assert.deepEqual(r.category.sort(), ["Bread", "Persian", "Sourdough", "Sweet Treat", "Vegetarian"]);
  assert.ok(!r.category.includes("Other"));
});

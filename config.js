// ============================================================
// App config — safe to commit (no secrets here)
// The GitHub token is stored in your browser's localStorage.
// Open the Settings tab in the app to enter it.
// ============================================================

const CONFIG = {
  // Your GitHub username
  githubOwner: "Vashtag",

  // The repo name
  githubRepo: "recipes",

  // Branch to store data on
  githubBranch: "master",

  // Path to the recipes data file
  dataFile: "data/recipes.json",
};

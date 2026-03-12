// ============================================================
// SETUP REQUIRED — fill in these values before using the app
// ============================================================
// 1. Go to GitHub → Settings → Developer Settings
//    → Personal Access Tokens → Fine-grained tokens → Generate new token
// 2. Set repository access to ONLY this repo
// 3. Under "Repository permissions" set Contents → Read and Write
// 4. Copy the token and paste it below
// ============================================================

const CONFIG = {
  // Your GitHub Personal Access Token (fine-grained, Contents: Read+Write)
  githubToken: "YOUR_GITHUB_TOKEN_HERE",

  // Your GitHub username
  githubOwner: "Vashtag",

  // The repo name
  githubRepo: "recipes",

  // Branch to store data on
  githubBranch: "master",

  // Path to the recipes data file
  dataFile: "data/recipes.json",
};

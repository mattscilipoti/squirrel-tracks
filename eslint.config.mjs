import globals from "globals";

const rules = {
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  "no-undef": "error",
  "no-redeclare": "error",
  "no-constant-binary-expression": "error",
  "no-self-compare": "error",
  "no-template-curly-in-string": "warn",
  eqeqeq: ["warn", "always"],
};

export default [
  // Installed gems (BUNDLE_PATH), at the root and in backend/
  { ignores: ["**/bundle/"] },
  {
    files: ["web-frontend/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // CommonJS export guard so tests can require() these files
        module: "readonly",
        // App globals shared across <script> tags. Each file declares its own
        // top-level names, so these only matter for files that consume them.
        GridTaskTracker: "readonly",
        DataStore: "readonly",
        PeerSync: "readonly",
        GitHubSync: "readonly",
        qrcode: "readonly",
        RemoteChanges: "readonly",
        TimeCalculations: "readonly",
      },
    },
    rules: {
      ...rules,
      // Files redeclare the app globals above when they define them.
      "no-redeclare": ["error", { builtinGlobals: false }],
      // Top-level functions are consumed by other script tags.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrors: "none", vars: "local" },
      ],
    },
  },
  {
    files: ["web-frontend/js/**/*.test.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules,
  },
];

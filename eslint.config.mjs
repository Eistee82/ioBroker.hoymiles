import config from "@iobroker/eslint-config";
import mochaPlugin from "eslint-plugin-mocha";
export default [
	...config,
	// docs/app/ is the standalone GitHub Pages Web-Bluetooth tool — browser ES modules with their
	// own conventions (no Node/ioBroker toolchain), linted/formatted separately from the adapter.
	{ ignores: ["build/", "admin/", "docs/app/", "*.config.mjs"] },
	{
		files: ["test/**/*.js"],
		plugins: { mocha: mochaPlugin },
		languageOptions: {
			globals: {
				describe: "readonly",
				it: "readonly",
				before: "readonly",
				after: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
			},
		},
		rules: {
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"mocha/no-exclusive-tests": "error",
		},
	},
];

import config from "@iobroker/eslint-config";
import globals from "globals";
export default [
	...config,
	// docs/app/ is the standalone GitHub Pages Web-Bluetooth tool — browser ES modules with their
	// own conventions (no Node/ioBroker toolchain), linted/formatted separately from the adapter.
	{ ignores: ["build/", "admin/", "docs/app/", "*.config.mjs"] },
	// A committed `.only` is caught by Mocha itself (`forbidOnly` in .mocharc.json).
	{
		files: ["test/**/*.js"],
		languageOptions: {
			globals: {
				...globals.mocha,
			},
		},
		rules: {
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
		},
	},
];

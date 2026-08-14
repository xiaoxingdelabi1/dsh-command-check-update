/**
 * Check for DSH harness updates and upgrade from the Web UI.
 *
 * Registers a settings namespace `harness-update` that shows up in the
 * Web UI settings page, plus a `/check-update` command.
 *
 * The settings section displays:
 *   - Current installed version
 *   - Latest available version on npm
 *   - Whether an update is available
 *   - A "Check now" toggle that triggers the version check
 *   - An "Upgrade" toggle that triggers the upgrade
 *
 * @module @deepseek-ai/dsh-command-check-update
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { deepEqualJson } from '@deepseek-ai/dsh-settings';

const name = 'command-check-update';
const inject = ['commands', 'settings'];
const NS = 'harness-update';

/** Resolve the installed DSH version from the running package. */
function getCurrentVersion() {
	try {
		// Try to find the dsh package.json from the module path
		const __dirname = dirname(fileURLToPath(import.meta.url));
		// Walk up to find the @deepseek-ai/dsh package
		let pkgPath = resolve(__dirname, '../../../@deepseek-ai/dsh/package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		return pkg.version || 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Fetch the latest version from the npm registry. */
async function fetchLatestVersion() {
	try {
		const response = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest', {
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) return null;
		const data = await response.json();
		return data.version;
	} catch {
		return null;
	}
}

/** Compare two semver versions, returns true if latest > current. */
function isNewerVersion(current, latest) {
	if (!current || !latest || current === 'unknown' || latest === 'unknown') return false;
	if (current === latest) return false;

	// Simple semver comparison
	const curParts = current.replace(/^v/, '').split(/[-+.]+/).map(Number);
	const latParts = latest.replace(/^v/, '').split(/[-+.]+/).map(Number);

	for (let i = 0; i < Math.max(curParts.length, latParts.length); i++) {
		const a = curParts[i] || 0;
		const b = latParts[i] || 0;
		if (b > a) return true;
		if (a > b) return false;
	}
	return false;
}

/** Schema for the settings namespace. */
const Config = z.object({
	currentVersion: z.string().default('unknown'),
	latestVersion: z.string().default('unknown'),
	updateAvailable: z.boolean().default(false),
	lastChecked: z.string().default('never'),
	checkNow: z.boolean().default(false),
	upgradeNow: z.boolean().default(false),
});

/** Execute the version check and update the settings namespace. */
async function performCheck(ctx) {
	const currentVersion = getCurrentVersion();
	const latestVersion = await fetchLatestVersion();
	const available = latestVersion ? isNewerVersion(currentVersion, latestVersion) : false;
	const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

	// Update the settings namespace
	await ctx.settings.update(NS, {
		currentVersion,
		latestVersion: latestVersion || 'check failed',
		updateAvailable: available,
		lastChecked: now,
		checkNow: false,  // Reset the trigger
	});

	return { currentVersion, latestVersion, available };
}

/** Execute the upgrade. */
async function performUpgrade(ctx) {
	// Reset the upgrade trigger first
	await ctx.settings.update(NS, { upgradeNow: false });

	// Try to run the upgrade
	try {
		// Use the Node.js child_process to run npx
		const { execSync } = await import('node:child_process');
		execSync('npx --yes @deepseek-ai/dsh@latest --version', {
			timeout: 60000,
			stdio: 'pipe'
		});
		return true;
	} catch {
		return false;
	}
}

/** Execute the check-update command. */
async function executeCheckUpdate(ctx, invocation) {
	const raw = invocation.rawInput.trim().toLowerCase();

	if (raw === 'upgrade' || raw === 'update') {
		const upgraded = await performUpgrade(ctx);
		if (upgraded) {
			return { kind: 'success', text: 'Upgrade completed. Please restart DSH for the changes to take effect.' };
		} else {
			return { kind: 'error', text: 'Upgrade failed. Try running: npx @deepseek-ai/dsh@latest' };
		}
	}

	const result = await performCheck(ctx);

	if (result.latestVersion === null) {
		return { kind: 'error', text: 'Failed to check for updates. Please check your network connection.' };
	}

	if (result.available) {
		return {
			kind: 'success',
			text: `Update available! Current: ${result.currentVersion} → Latest: ${result.latestVersion}. Type "/check-update upgrade" to upgrade.`
		};
	}

	return {
		kind: 'success',
		text: `You're up to date. Current version: ${result.currentVersion} (latest: ${result.latestVersion || 'unknown'})`
	};
}

function apply(ctx) {
	// Register the settings namespace
	ctx.inject(['settings'], (sctx) => {
		const scope = sctx.settings.register(NS, Config, {
			base: {
				currentVersion: getCurrentVersion(),
				latestVersion: 'unknown',
				updateAvailable: false,
				lastChecked: 'never',
				checkNow: false,
				upgradeNow: false,
			}
		});

		// Watch for changes - detect when checkNow or upgradeNow is toggled
		scope.watch(() => {
			const current = scope.get();
			if (current.checkNow) {
				performCheck(ctx).catch((err) => {
					ctx.logger.error('check-update: version check failed: %o', err);
				});
			}
			if (current.upgradeNow) {
				performUpgrade(ctx).catch((err) => {
					ctx.logger.error('check-update: upgrade failed: %o', err);
				});
			}
		});

		// Run initial check silently
		performCheck(ctx).catch(() => {});
	});

	// Register the command
	ctx.commands.register({
		name: 'check-update',
		description: 'Check for DSH harness updates and upgrade',
		input: { hint: '[upgrade]' },
		handler: (invocation) => executeCheckUpdate(ctx, invocation),
	});
}

export { apply, inject, name };
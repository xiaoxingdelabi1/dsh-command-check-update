/**
 * Check for DSH harness updates and upgrade.
 *
 * Registers a `/check-update` command that checks the npm registry for the
 * latest DSH version and can trigger an upgrade.
 *
 * Usage:
 *   /check-update           — check for updates
 *   /check-update upgrade   — upgrade to the latest version
 *
 * @module @deepseek-ai/dsh-command-check-update
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = 'command-check-update';
const inject = ['commands'];

/** Resolve the installed DSH version from the running package. */
function getCurrentVersion() {
	try {
		const __dirname = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../@deepseek-ai/dsh/package.json'), 'utf-8'));
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

/** Execute the version check. */
async function performCheck() {
	const currentVersion = getCurrentVersion();
	const latestVersion = await fetchLatestVersion();
	const available = latestVersion ? isNewerVersion(currentVersion, latestVersion) : false;
	return { currentVersion, latestVersion, available };
}

/** Execute the upgrade. */
async function performUpgrade() {
	try {
		const { execSync } = await import('node:child_process');
		execSync('npx --yes @deepseek-ai/dsh@latest --version', { timeout: 60000, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** Execute the check-update command. */
async function executeCheckUpdate(ctx, invocation) {
	const raw = invocation.rawInput.trim().toLowerCase();

	if (raw === 'upgrade' || raw === 'update') {
		const upgraded = await performUpgrade();
		if (upgraded) {
			return { kind: 'success', text: 'Upgrade completed. Please restart DSH for the changes to take effect.' };
		}
		return { kind: 'error', text: 'Upgrade failed. Try running: npx @deepseek-ai/dsh@latest' };
	}

	const result = await performCheck();

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
	ctx.commands.register({
		name: 'check-update',
		description: 'Check for DSH harness updates and upgrade',
		input: { hint: '[upgrade]' },
		handler: (invocation) => executeCheckUpdate(ctx, invocation),
	});
}

export { apply, inject, name };
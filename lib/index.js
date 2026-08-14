/**
 * Check for DSH harness updates, upgrade to a specific version, or just
 * show the current version.
 *
 * Commands:
 *   /version                -- show current DSH version
 *   /check-update           -- check for latest version on npm
 *   /check-update upgrade   -- upgrade to the latest version
 *   /check-update to <ver>  -- upgrade to a specific version
 *   /install-pack           -- (re)install the profile-pack plugins
 *
 * Design note: The plugin reads the version from the local package.json, so
 * it never needs an API key. Send someone your version number and they can
 * run "/check-update to <version>" to match.
 *
 * @module @deepseek-ai/dsh-command-check-update
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const name = 'command-check-update';
const inject = ['commands'];

/** Locate @deepseek-ai/dsh/package.json by walking up from a directory. */
function findDshPackageJson(startDir) {
	let dir = resolve(startDir);
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const candidate = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
		if (existsSync(candidate)) return candidate;
		const parent = resolve(dir, '..');
		if (parent === dir) break; // reached filesystem root
		dir = parent;
	}
	return null;
}

/** Resolve the installed DSH version from the running package. */
function getCurrentVersion() {
	try {
		const __dirname = dirname(fileURLToPath(import.meta.url));
		const dshPkgPath = findDshPackageJson(__dirname);
		if (!dshPkgPath) return 'unknown';
		const pkg = JSON.parse(readFileSync(dshPkgPath, 'utf-8'));
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

/** Execute the upgrade to a specific version (or latest if not specified). */
async function performUpgrade(version) {
	try {
		const pkg = version ? '@deepseek-ai/dsh@' + version : '@deepseek-ai/dsh@latest';
		const { execSync } = await import('node:child_process');
		execSync('npx --yes ' + pkg + ' --version', { timeout: 60000, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** Execute the check-update command. */
async function executeCheckUpdate(ctx, invocation) {
	const raw = invocation.rawInput.trim().toLowerCase();

	// /check-update upgrade  or  /check-update update
	if (raw === 'upgrade' || raw === 'update') {
		const upgraded = await performUpgrade();
		if (upgraded) {
			return { kind: 'success', text: 'Upgrade to latest completed. Please restart DSH for the changes to take effect.' };
		}
		return { kind: 'error', text: 'Upgrade failed. Try running: npx @deepseek-ai/dsh@latest' };
	}

	// /check-update to <version>
	if (raw.startsWith('to ')) {
		const version = raw.slice(3).trim();
		if (!version) {
			return { kind: 'error', text: 'Usage: /check-update to <version>  (e.g. /check-update to 0.1.0-rc.6)' };
		}
		const upgraded = await performUpgrade(version);
		if (upgraded) {
			return { kind: 'success', text: 'Upgrade to ' + version + ' completed. Please restart DSH for the changes to take effect.' };
		}
		return { kind: 'error', text: 'Upgrade to ' + version + ' failed. Check that the version exists: npx @deepseek-ai/dsh@' + version };
	}

	// /check-update (plain)
	const result = await performCheck();

	if (result.latestVersion === null) {
		return { kind: 'error', text: 'Failed to check for updates. Please check your network connection.' };
	}

	if (result.available) {
		return {
			kind: 'success',
			text: 'Update available! Current: ' + result.currentVersion + ' -> Latest: ' + result.latestVersion + '. Type "/check-update upgrade" to upgrade.'
		};
	}

	return {
		kind: 'success',
		text: 'Up to date. Current version: ' + result.currentVersion + ' (latest: ' + (result.latestVersion || 'unknown') + ')'
	};
}

/** Execute the version command. */
async function executeVersion(ctx, invocation) {
	const version = getCurrentVersion();
	return {
		kind: 'success',
		text: 'Current DSH version: ' + version
	};
}

/** Plugin list for the profile pack. */
const PROFILE_PLUGINS = [
	{ name: 'dsh-command-retry-count', id: 'retry-count', repo: 'xiaoxingdelabi1/dsh-command-retry-count' },
	{ name: 'dsh-command-check-update', id: 'check-update', repo: 'xiaoxingdelabi1/dsh-command-check-update' }
];

/**
 * Find the @deepseek-ai directory inside the dsh package's own dependency
 * tree: <npm-root>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
 * The plugins must live there so their bare imports (@deepseek-ai/dsh-llm,
 * @deepseek-ai/dsh-settings) resolve and check-update's version lookup works.
 */
function getDshDepsBase() {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const dshPkgPath = findDshPackageJson(__dirname);
	if (!dshPkgPath) return null;
	return resolve(dirname(dshPkgPath), 'node_modules', '@deepseek-ai');
}

/** Default profile patch path, matching install.ps1's default ProfileDir. */
function getCordisPatchPath() {
	return join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
}

/** Download a plugin from GitHub and install it into the dsh dep tree. */
async function downloadPlugin(repo, destDir) {
	const apiBase = 'https://api.github.com/repos/' + repo + '/contents';
	const files = ['package.json', 'LICENSE', 'README.md', 'README.zh.md', 'lib/index.js', 'lib/types/index.d.ts'];

	mkdirSync(join(destDir, 'lib/types'), { recursive: true });

	for (const file of files) {
		try {
			const response = await fetch(apiBase + '/' + file, {
				signal: AbortSignal.timeout(10000),
				headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'dsh-plugin/1.0' }
			});
			if (!response.ok) continue;
			const data = await response.json();
			if (!data.content) continue;
			const bytes = Buffer.from(data.content, 'base64');
			const outPath = join(destDir, file);
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, bytes);
		} catch {
			// skip failed files
		}
	}
}

/**
 * Rewrite cordis.patch.yml with file:// URL entries.
 * Package names would 404 on the npm registry and crash dsh web at startup;
 * bare Windows paths fail the ESM loader ("protocol 'c:'"). file:// URLs are
 * the only specifier form the profile loader passes through unchanged.
 */
function ensurePatchEntries(patchPath, depsBase) {
	const header = '# Your patch layer for this dsh profile, applied after every bundle layer:\n' +
		'# a top-level YAML array of loader patch entries (id-targeted config\n' +
		'# overrides, disables, and insert lists; `!!js` expressions allowed).\n' +
		'#\n' +
		'# Generated by dsh-profile-pack. Plugins are referenced by file:// URL\n' +
		'# because they are NOT published on the npm registry; package names\n' +
		'# would 404 and crash dsh web at startup.\n';

	const lines = [header, '- insert:'];
	for (const plugin of PROFILE_PLUGINS) {
		const idx = join(depsBase, plugin.name, 'lib', 'index.js');
		const url = 'file:///' + idx.replace(/\\/g, '/');
		lines.push('    - id: ' + plugin.id);
		lines.push("      name: '" + url + "'");
	}
	writeFileSync(patchPath, lines.join('\n'), 'utf-8');
}

/** Execute the install-pack command. */
async function executeInstallPack(ctx, invocation) {
	const depsBase = getDshDepsBase();
	if (!depsBase) {
		return { kind: 'error', text: 'Cannot locate the dsh install. Run install.ps1 from dsh-profile-pack instead.' };
	}

	const results = [];
	for (const plugin of PROFILE_PLUGINS) {
		const destDir = join(depsBase, plugin.name);
		try {
			results.push('Downloading ' + plugin.name + '...');
			await downloadPlugin(plugin.repo, destDir);
			results.push('  Done');
		} catch (err) {
			results.push('  Failed: ' + err.message);
		}
	}

	// Rewrite cordis.patch.yml with file:// URLs
	const patchPath = getCordisPatchPath();
	try {
		ensurePatchEntries(patchPath, depsBase);
		results.push('cordis.patch.yml: rewritten with file:// URLs (' + patchPath + ')');
	} catch (err) {
		results.push('cordis.patch.yml: FAILED - ' + err.message);
	}

	results.push('');
	results.push('Installation complete! Restart DSH to load the new plugins.');

	return { kind: 'success', text: results.join('\n') };
}

function apply(ctx) {
	ctx.commands.register({
		name: 'check-update',
		description: 'Check for DSH harness updates and upgrade',
		input: { hint: '[upgrade|to <version>]' },
		handler: (invocation) => executeCheckUpdate(ctx, invocation),
	});
	ctx.commands.register({
		name: 'version',
		description: 'Show current DSH version',
		handler: (invocation) => executeVersion(ctx, invocation),
	});
	ctx.commands.register({
		name: 'install-pack',
		description: 'Install all plugins from the profile pack',
		handler: (invocation) => executeInstallPack(ctx, invocation),
	});
}

export { apply, inject, name };
/**
 * Check for DSH harness updates, upgrade to a specific version, or just
 * show the current version.
 *
 * Commands:
 *   /version                -- show current DSH version
 *   /check-update           -- check for latest version on npm
 *   /check-update upgrade   -- upgrade to the latest version
 *   /check-update to <ver>  -- upgrade to a specific version
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
	{ name: 'dsh-command-retry-count', repo: 'xiaoxingdelabi1/dsh-command-retry-count' },
	{ name: 'dsh-command-check-update', repo: 'xiaoxingdelabi1/dsh-command-check-update' }
];

/** Find the profile node_modules directory. */
function getProfileNodeModules() {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	// The plugin is at: profiles/node_modules/@deepseek-ai/dsh-command-check-update/lib/
	// So go up 3 levels to reach profiles/node_modules/
	const candidate = resolve(__dirname, '../../..');
	if (existsSync(join(candidate, '@deepseek-ai'))) {
		return candidate;
	}
	return null;
}

/** Find the profile cordis.patch.yml path. */
function getCordisPatchPath() {
	const nm = getProfileNodeModules();
	if (!nm) return null;
	// profiles/node_modules/ -> profiles/web/cordis.patch.yml
	const profileDir = resolve(nm, '../web');
	const patchPath = join(profileDir, 'cordis.patch.yml');
	if (existsSync(patchPath)) return patchPath;
	// Try creating it
	try {
		mkdirSync(profileDir, { recursive: true });
		return patchPath;
	} catch {
		return null;
	}
}

/** Download a plugin from GitHub and install it. */
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

/** Update cordis.patch.yml with plugin entries. */
function ensurePatchEntries(patchPath) {
	let content = '';
	try { content = readFileSync(patchPath, 'utf-8'); } catch { content = ''; }

	// Check if entries already exist
	const hasRetry = content.includes('retry-count');
	const hasUpdate = content.includes('check-update');

	if (hasRetry && hasUpdate) return 'already';

	// Ensure the YAML structure is valid
	const header = '# Your patch layer for this dsh profile, applied after every bundle layer:\n' +
		'# a top-level YAML array of loader patch entries (id-targeted config\n' +
		'# overrides, disables, and insert lists; `!!js` expressions allowed).\n';

	const insertBlock = '- insert:\n' +
		(hasRetry ? '' : '    - id: retry-count\n      name: \'@deepseek-ai/dsh-command-retry-count\'\n') +
		(hasUpdate ? '' : '    - id: check-update\n      name: \'@deepseek-ai/dsh-command-check-update\'\n');

	if (content.trim() === '') {
		writeFileSync(patchPath, header + insertBlock, 'utf-8');
	} else if (!hasRetry || !hasUpdate) {
		// Append to existing insert block
		const lines = content.split('\n');
		// Find the last - insert: line
		let insertLine = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].trim() === '- insert:') { insertLine = i; break; }
		}
		if (insertLine >= 0) {
			// Insert after the last item in the insert block
			lines.splice(insertLine + 1, 0,
				(hasRetry ? '' : '    - id: retry-count\n      name: \'@deepseek-ai/dsh-command-retry-count\''),
				(hasUpdate ? '' : '    - id: check-update\n      name: \'@deepseek-ai/dsh-command-check-update\'')
			);
			writeFileSync(patchPath, lines.join('\n'), 'utf-8');
		} else {
			// No insert block, append
			writeFileSync(patchPath, content + '\n' + insertBlock, 'utf-8');
		}
	}
	return 'updated';
}

/** Execute the install-pack command. */
async function executeInstallPack(ctx, invocation) {
	const nm = getProfileNodeModules();
	if (!nm) {
		return { kind: 'error', text: 'Cannot find profile node_modules. Make sure this plugin is installed in a DSH profile.' };
	}

	const results = [];
	for (const plugin of PROFILE_PLUGINS) {
		const destDir = join(nm, '@deepseek-ai', plugin.name);
		try {
			results.push('Downloading ' + plugin.name + '...');
			await downloadPlugin(plugin.repo, destDir);
			results.push('  Done');
		} catch (err) {
			results.push('  Failed: ' + err.message);
		}
	}

	// Update cordis.patch.yml
	const patchPath = getCordisPatchPath();
	if (patchPath) {
		const status = ensurePatchEntries(patchPath);
		results.push('cordis.patch.yml: ' + (status === 'already' ? 'entries already exist' : 'updated'));
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
# DSH Update Checker

Check for DeepSeek Harness updates and upgrade from the Web UI settings page.

## Features

- **Web UI settings section** showing current version, latest version, and update status
- **Check for updates** with one click in the settings page
- **Upgrade** to the latest version with one click
- **Slash command** `/check-update` for checking and `/check-update upgrade` for upgrading

## How it works

The plugin registers a `harness-update` settings namespace that appears in the Web UI settings page under "Plugins". It shows:

- Current installed version of DSH
- Latest available version on npm
- Whether an update is available
- When the last check was performed
- A "Check now" toggle to trigger a version check
- An "Upgrade" toggle to upgrade to the latest version

## Usage

### Via Web UI Settings

1. Open the settings page in the DSH Web GUI
2. Find the "Harness Update" section
3. Toggle "Check now" to check for updates
4. If an update is available, toggle "Upgrade now" to upgrade

### Via Slash Command

```
/check-update          # Check for updates
/check-update upgrade  # Upgrade to the latest version
```

## Installation

```yaml
# In your cordis.patch.yml
- insert:
    - id: check-update
      name: '@deepseek-ai/dsh-command-check-update'
```

## License

MIT
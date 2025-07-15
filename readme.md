# agRIPpa CLI

A command-line interface for interacting with Odoo workflow code stored in the database.

## Overview

agRIPpa is a specialized CLI tool that allows developers to:

- Download workflow code from Odoo
- Edit the code locally with their preferred editor
- Upload changes back to the Odoo database
- Manage backups and restore previous versions

## Installation

Since agRIPpa is not published to npm, you'll need to build it locally:

```bash
# Clone the repository
git clone <repository-url>
cd agrippa

# Install dependencies
npm install

# Build the tool
npm run build

# Link the CLI globally
npm link
```

After linking, the `agrippa` command will be available in your terminal.

## Usage

### Initialize Workspace

Set up your workspace with credentials and configuration:

```bash
agrippa init
```

You'll be prompted to enter:

- Keycloak username and password
- Keycloak client ID and secret
- Odoo RIP base URL
- Keycloak URL

### Clone a Workflow

Download a workflow from Odoo to work on locally:

```bash
agrippa clone
```

You'll be prompted to select a workflow from the available options.

### Make Changes

Once cloned, the workflow files will be available in your local directory. Edit the Python code with your preferred editor.

### Upload Changes

Synchronize your local changes back to Odoo:

```bash
agrippa upsync
```

Or specify a specific workflow:

```bash
agrippa upsync -w workflow-slug
```

The tool will show you the changes that will be applied and ask for confirmation.

### Manage Backups

Create a backup:

```bash
agrippa backup -w workflow-slug -n "My backup name"
```

Restore a backup:

```bash
agrippa backup -w workflow-slug -r
```

You'll be prompted to select which backup to restore.

### Refresh Local Workflows

Update your local copies with the latest code from Odoo:

```bash
agrippa refresh
```

Or refresh a specific workflow:

```bash
agrippa refresh -o workflow-slug
```

## Commands Reference

| Command           | Description                             |
| ----------------- | --------------------------------------- |
| `agrippa init`    | Initialize workspace with credentials   |
| `agrippa clone`   | Clone a workflow from Odoo              |
| `agrippa upsync`  | Upload local changes to Odoo            |
| `agrippa backup`  | Create or restore backups               |
| `agrippa refresh` | Update local copies with remote changes |

## Workflow

A typical workflow with agRIPpa looks like:

1. Initialize your workspace (`agrippa init`)
2. Clone the workflow you want to work on (`agrippa clone`)
3. Make your code changes locally
4. Upload your changes to Odoo (`agrippa upsync`)

Before making significant changes, it's recommended to create a backup (`agrippa backup`).

> [!WARNING] To perform operations, you must be in the folder in which you initialized agRIPpa.

## Tips

- If a workflow path ends with a trailing slash, the CLI will automatically remove it
- The tool creates backups automatically before certain operations
- Use the `-w` or `--workflow` flag to specify a workflow slug directly

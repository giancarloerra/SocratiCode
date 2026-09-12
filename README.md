<p align="center">
  <img src="./socraticode_logo_thumbnail.png" alt="SocratiCode logo" />
</p>

# SocratiCode

<p align="center">
  <a href="https://github.com/giancarloerra/socraticode/actions/workflows/ci.yml"><img src="https://github.com/giancarloerra/socraticode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://www.npmjs.com/package/socraticode"><img src="https://img.shields.io/npm/v/socraticode.svg" alt="npm version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg" alt="Node.js >= 18.17"></a>
  <a href="https://github.com/giancarloerra/socraticode"><img src="https://img.shields.io/github/stars/giancarloerra/socraticode?style=social" alt="GitHub stars"></a>
  <a href="https://mcptoplist.com/server/io.github.giancarloerra%2Fsocraticode"><img src="https://mcptoplist.com/badge/io.github.giancarloerra%2Fsocraticode.svg" alt="MCP Toplist rank"></a>
  <a href="https://discord.gg/dHNMKVY2J2"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="#claude-code-plugin-recommended-for-claude-code-users"><img src="https://img.shields.io/badge/Claude_Code-Install_Plugin-CC785C?style=flat-square&logoColor=white" alt="Install Claude Code Plugin"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=giancarloerra.socraticode"><img src="https://vsmarketplacebadges.dev/version-short/giancarloerra.socraticode.svg?style=flat-square&label=VS%20Code%20Marketplace&logo=visualstudiocode&color=0098FF" alt="VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/giancarloerra/socraticode"><img src="https://img.shields.io/open-vsx/v/giancarloerra/socraticode?style=flat-square&label=Open%20VSX&color=A52A2A" alt="Open VSX"></a>
  <a href="https://vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22--prefer-online%22%2C%22socraticode%40latest%22%5D%7D"><img src="https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white" alt="Install in VS Code"></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22--prefer-online%22%2C%22socraticode%40latest%22%5D%7D&quality=insiders"><img src="https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white" alt="Install in VS Code Insiders"></a>
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=socraticode&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIi0tcHJlZmVyLW9ubGluZSIsInNvY3JhdGljb2RlQGxhdGVzdCJdfQ=="><img src="https://img.shields.io/badge/Cursor-Install_MCP_Server-F14C28?style=flat-square&logo=cursor&logoColor=white" alt="Install in Cursor"></a>
</p>

> *"There is only one good, knowledge, and one evil, ignorance."* — Socrates

**Your AI reads code. SocratiCode understands it.**

**The open-source codebase context engine: give any AI instant automated knowledge of your entire codebase (and infrastructure) — at scale, zero configuration, fully private, completely free.**

<p align="center">
  Kindly sponsored by <a href="https://altaire.com">Altaire Limited</a>
</p>

> 🛡️ **Need MCP governance together with codebase context?** See our sibling project [**JanuScope**](https://github.com/giancarloerra/januscope) — the local-first MCP policy proxy: tool blocking, SQL-mutation gate, PII redaction, audit, rate-limit.

> If SocratiCode has been useful to you, please ⭐ **star this repo** — it helps others discover it — and share it with your dev team and fellow developers!
>
> 💬 Questions or just want to chat? Join us on [Discord](https://discord.gg/dHNMKVY2J2).

> **☁️ SocratiCode Cloud (private beta)** — Hosted, shared team index built on the same engine as the open-source version, plus SSO, audit logs, branch-aware indexing, and VPC / air-gapped deployment options. The open-source core remains free forever. [Request early access →](https://socraticode.cloud)

**One thing, done well: deep codebase intelligence with zero setup, no bloat, and full automation.** SocratiCode gives AI assistants deep semantic understanding of your codebase: **hybrid search, cross-project search, polyglot code dependency graphs, symbol-level impact analysis and flow, interactive HTML graph explorer for visual navigation, and searchable context artifacts (database schemas, API specs, infra configs, architecture docs)**. Zero configuration: add it to an **MCP host that supports local stdio servers**, or use a supported plugin or extension. It manages everything automatically.

**Production-ready**, battle-tested on **enterprise-level** large repositories (up to and over **~40 million lines of code**). **Batched**, automatic **resumable** indexing checkpoints progress — pauses, crashes, restarts, and interruptions don't lose work. The file watcher keeps the **index automatically updated** at every file change and across sessions. **Multi-branch, multi-repo** and **multi-agent ready** — multiple AI agents can work on the same codebase simultaneously, sharing a single index with automatic coordination and zero configuration.

**Private and local by default** — Docker handles everything, no API keys required, no data leaves your machine. **Cloud ready** for embeddings (OpenAI, Google Gemini) and Qdrant, and a **full suite of configuration options** are all available when you need them.

**Code intelligence that belongs to you, AI and host agnostic** — your codebase's understanding lives with the code, not locked to any one assistant, IDE or model. And because SocratiCode pre-computes the hard parts (blast radius, call-flow, dependency traversal), **smaller models can handle architectural complex tasks that would otherwise need top-tier reasoning**, saving even more on token cost.

The first Qdrant‑based MCP/Claude Plugin/Skill that pairs auto‑managed, zero‑config local Docker deployment with **AST‑aware code chunking, hybrid semantic + BM25 (RRF‑fused) code search**, polyglot dependency **graphs** with circular‑dependency visualisation, **symbol‑level Impact Analysis** (blast‑radius & call‑flow tracing across 18 languages), and searchable **infra/API/database artifacts** in a single focused, zero-config and easy to use code intelligence engine.

> **Benchmarked on VS Code (2.45M lines):** SocratiCode uses **61% less context**, **84% fewer tool calls**, and is **37x faster** than grep‑based exploration — tested live with Claude Opus 4.6. [See the full benchmark →](#real-world-benchmark-vs-code-245m-lines-of-code-with-claude-opus-46)

## Contents

- [Quick Start](#quick-start)
- [Plugins and host integrations](#plugins-and-host-integrations)
- [Why SocratiCode](#why-socraticode)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Example Workflow](#example-workflow)
- [Agent Instructions](#agent-instructions)
- [Configuration](#configuration)
- [Language Support](#language-support)
- [Ignore Rules](#ignore-rules)
- [Context Artifacts](#context-artifacts)
- [Environment Variables](#environment-variables)
- [Docker Resources](#docker-resources)
- [Testing](#testing)
- [Why Not Just Grep?](#why-not-just-grep)
- [FAQ](#faq)
- [Community](#community)
- [SocratiCode Cloud](#socraticode-cloud)
- [License](#license)

---

## Quick Start

> **Requirements:** [Node.js 18.17 or newer](https://nodejs.org/) with `npx` on `PATH`, plus [Docker](https://www.docker.com/products/docker-desktop/) running for the default local Qdrant and Ollama stack.

**Quick install guidance for Claude Code, VS Code, and Cursor:**

[![Install Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Install_Plugin-CC785C?style=flat-square&logoColor=white)](#claude-code-plugin-recommended-for-claude-code-users)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22--prefer-online%22%2C%22socraticode%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22--prefer-online%22%2C%22socraticode%40latest%22%5D%7D&quality=insiders) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_MCP_Server-F14C28?style=flat-square&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=socraticode&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIi0tcHJlZmVyLW9ubGluZSIsInNvY3JhdGljb2RlQGxhdGVzdCJdfQ==)

**MCP hosts with a JSON `mcpServers` object** can use this complete configuration:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"]
    }
  }
}
```

Configuration schemas are host-specific. Continue, VS Code, Zed, OpenCode, Gemini CLI, Cline, and Roo Code have dedicated examples in [Plugins and host integrations](#plugins-and-host-integrations).

### Keeping SocratiCode up to date

SocratiCode has two independent update paths. The **MCP engine** is the `socraticode` package published to npm. Every npm-backed configuration below uses `npx -y --prefer-online socraticode@latest`, which checks npm for the current `latest` release whenever the MCP server starts. A running server cannot replace itself, and a newly published version can only be downloaded while the npm registry is reachable, so restart or reconnect the server after a release.

Native plugins and extensions also contain **skills, instructions, manifests, or UI files**. Update those through the host as shown below, then start a new session so the new plugin files load. Direct MCP installations contain only the engine and do not install SocratiCode's plugin skills.

| Integration | Update plugin, skills, and integration files |
|:------------|:---------------------------------------------|
| Claude Code plugin | Enable marketplace auto-update, or run `claude plugin marketplace update socraticode` followed by `claude plugin update --scope user socraticode@socraticode` |
| OpenAI Codex plugin | Run `codex plugin marketplace upgrade socraticode`, then `codex plugin add socraticode@socraticode` and start a new task |
| VS Code Agent Plugin | Leave `extensions.autoUpdate` enabled for daily checks, or run **Extensions: Check for Extension Updates**, then start a new Chat |
| VS Code editor extension | Update it through the Extensions view or **Extensions: Check for Extension Updates**, then reload the window |
| Cursor local plugin | Update to the latest GitHub release tag using the commands in the [Cursor section](#cursor), then reload Cursor |
| Gemini CLI extension | Install with `--auto-update`, or run `gemini extensions update socraticode`, then restart Gemini |
| Direct MCP only | No separate plugin files are installed; restart or reconnect the MCP server to resolve the current npm release |

`@latest` refers to npm's published `latest` distribution tag; it does not refer to a Git branch. `--prefer-online` forces npm to check for updated package metadata even when its cache is still fresh. If the same registry is temporarily unavailable, npm can still use an already populated cache; a first installation still requires registry access. See the [npm exec cache documentation](https://docs.npmjs.com/cli/npm-exec/#a-note-on-caching) and [npm distribution-tag documentation](https://docs.npmjs.com/adding-dist-tags-to-packages/).

Restart your host. With the default local configuration, first use pulls the required Docker images and starts managed Qdrant. `OLLAMA_MODE=auto` reuses a detected native Ollama instance or starts managed Ollama, then downloads the local embedding model if it is not already available. Cloud and external embedding providers do not download a local model. Initial setup usually takes about five minutes, depending on the connection; later starts take seconds.

**First time on a project:** ask your AI: **"Index this codebase"**. Indexing runs in the background; ask **"What is the codebase index status?"** to monitor progress. Depending on codebase size and whether you're using GPU-accelerated Ollama or cloud embeddings, first-time indexing can take anywhere from a few seconds to a few minutes (it takes under 10 minutes to first-index +3 million lines of code on a Macbook Pro M4). Once complete it doesn't need to be run again, you can search, explore the dependency graph, and query context artifacts.

**Every time after that:** just use the tools (search, graph, etc.). By default, server startup resumes the indexed project represented by the MCP process's working directory: a complete index gets its watcher and an incremental catch-up update, while interrupted indexing resumes from the last checkpoint. `SOCRATICODE_AUTO_RESUME_PROJECTS` and `SOCRATICODE_AUTO_RESUME=all` can select additional projects. A completed indexed project not handled at startup gets a fallback watcher start on its first search, status, or graph interaction. You can also explicitly start or restart the watcher with `codebase_watch { action: "start" }`.

**Prefer a deliberate index snapshot?** Set `SOCRATICODE_WATCHER=off` and `SOCRATICODE_AUTO_RESUME=off` for every MCP process that uses the checkout, then run `codebase_update` only when you want to refresh it. Existing indexes remain usable without rebuilding. Use `SOCRATICODE_WATCHER=manual` instead if explicit `codebase_watch { action: "start" }` should remain available. See [Indexing Behaviour](#indexing-behaviour) and [Passing env vars by host](#passing-env-vars-by-host).

> **macOS / Windows on large codebases**: Docker containers can't use the GPU. For medium-to-large repos, [install native Ollama](https://ollama.com/download) (auto-detected, no config change needed) for Metal/CUDA acceleration, or use [OpenAI embeddings](#openai-embeddings) for speed without a local install. [Full details.](#embedding-performance-on-macos--windows)
>
> **Recommended**: For best results, add the [Agent Instructions](#agent-instructions) to your AI assistant's system prompt or project instructions file (`CLAUDE.md`, `AGENTS.md`, etc.). The key principle, **search before reading**, helps your AI use SocratiCode's tools effectively and avoid unnecessary file reads.
>
> **Claude Code users**: If you installed the SocratiCode plugin, the Agent Instructions are included automatically as skills, so there is no need to add them to your `CLAUDE.md`. The plugin also bundles the MCP server, so you don't need a separate `claude mcp add`.
>
> **Advanced**: cloud embeddings (OpenAI / Google), external Qdrant, remote Ollama, native Ollama, and dozens of tuning options are all available. See [Configuration](#configuration) below.

## Plugins and host integrations

SocratiCode can be installed as a native agent plugin, a VS Code editor extension, a Gemini CLI extension, or a directly configured local stdio MCP server. These are separate integration types and use different configuration and update paths.

Every path below requires Node.js 18.17 or newer with `npx` on `PATH`. The default local stack also requires Docker to be running. Docker is optional when Qdrant is external and embeddings use either a detected native Ollama instance or a cloud or external provider.

| Host | Recommended integration | Scope |
|:-----|:------------------------|:------|
| Claude Code | Native plugin | User |
| OpenAI Codex | Native plugin | User |
| VS Code | Agent Plugin or editor extension | Current VS Code profile |
| Cursor | Local Cursor plugin or direct MCP | User or project |
| Gemini CLI | Gemini extension | User |
| Continue | Direct MCP | Project or user config |
| Cline | Direct MCP | Project or user config |
| Roo Code | Direct MCP | Project or user config |
| Zed | Direct MCP | User or project settings |
| OpenCode | Direct MCP | Project or user config |

### Claude Code plugin (recommended for Claude Code users)

The native plugin bundles the MCP server, workflow skills, and agent instructions. Install it for the current user:

```bash
claude plugin marketplace add giancarloerra/socraticode
claude plugin install --scope user socraticode@socraticode
claude plugin list
```

Start a new Claude Code session after installation. Existing sessions do not load a newly installed plugin. To enable automatic updates, open `/plugin`, select **Marketplaces**, select `socraticode`, and enable auto-update. To update manually:

```bash
claude plugin marketplace update socraticode
claude plugin update --scope user socraticode@socraticode
```

Run `/reload-plugins` or start a new session after updating. If SocratiCode was previously added as a standalone MCP server, remove that duplicate with `claude mcp remove socraticode`; the plugin already provides the server.

For custom providers or external Qdrant, put inherited variables in Claude Code's user settings and restart the session:

```json
{
  "env": {
    "EMBEDDING_PROVIDER": "openai",
    "OPENAI_API_KEY": "<your key>"
  }
}
```

Keep this user-scoped file private, or provide secrets through the process environment. Never commit secret values.

See the [Claude Code plugin documentation](https://code.claude.com/docs/en/discover-plugins).

#### Claude Code MCP-only installation

For a user-scoped installation without the bundled skills:

```bash
claude mcp add --scope user socraticode -- npx -y --prefer-online socraticode@latest
claude mcp list
```

Start a new session, or run `/mcp` and select **Reconnect**. The explicit `@latest` command checks for the latest published engine each time the server starts. `claude mcp add` defaults to project-local scope when `--scope user` is omitted. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### OpenAI Codex plugin

The Codex plugin bundles SocratiCode's MCP server, skills, and instructions. Add the Git marketplace and install the plugin for the current user:

```bash
codex plugin marketplace add giancarloerra/socraticode --ref main
codex plugin add socraticode@socraticode
codex plugin list --available --json
```

Start a new Codex task or CLI session after installation. Reopening an existing task does not load newly installed skills or MCP tools. Update and verify with:

```bash
codex plugin marketplace upgrade socraticode
codex plugin add socraticode@socraticode
codex plugin list --available --json
```

Codex has a public plugin directory, but SocratiCode is not currently published there. Plugins are supported in the ChatGPT desktop Codex environment and Codex CLI. The Codex IDE extension supports shared MCP configuration, not plugin discovery. See the [OpenAI plugin documentation](https://learn.chatgpt.com/docs/plugins).

Codex currently exposes enablement and tool policy for a plugin's bundled MCP server, but not a documented per-user environment override for that bundled definition. To keep the plugin skills while using custom SocratiCode variables, disable only the bundled server and add one top-level server in `~/.codex/config.toml`:

```toml
[plugins."socraticode@socraticode".mcp_servers.socraticode]
enabled = false

[mcp_servers.socraticode]
command = "npx"
args = ["-y", "--prefer-online", "socraticode@latest"]

[mcp_servers.socraticode.env]
QDRANT_MODE = "external"
QDRANT_URL = "https://xyz.qdrant.io"
```

Restart Codex, confirm that the plugin skills remain available, and use `/mcp` or `codex mcp list` to verify that exactly one SocratiCode server is active. See [bundled MCP server policy](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks) and the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

#### OpenAI Codex MCP-only installation

`codex mcp add` writes the user configuration in `~/.codex/config.toml`:

```bash
codex mcp add socraticode -- npx -y --prefer-online socraticode@latest
codex mcp list
```

Start a new task or CLI session after installation. The equivalent TOML is:

```toml
[mcp_servers.socraticode]
command = "npx"
args = ["-y", "--prefer-online", "socraticode@latest"]
```

Both inline `env = { ... }` and a nested `[mcp_servers.socraticode.env]` table are valid. The CLI `--env KEY=value` option is usually clearer. See the [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### VS Code Agent Plugin

This plugin bundles the MCP server, skills, and agent instructions for VS Code's native agent. It is separate from the SocratiCode editor extension.

1. Add this complete setting to the current VS Code profile before installation:

   ```json
   {
     "chat.plugins.enabled": true
   }
   ```

2. Run **Chat: Install Plugin From Source** from the Command Palette and enter `https://github.com/giancarloerra/socraticode`.
3. Start a new Chat session.
4. Verify SocratiCode under **Agent Plugins - Installed**, then run **MCP: List Servers** and confirm that its server is running.

Run **Extensions: Check for Extension Updates** to refresh installed agent plugins, then start a new Chat session. See [VS Code Agent Plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins).

VS Code does not document a per-user environment overlay for a plugin-bundled MCP definition. To keep the plugin skills while applying custom variables, run **MCP: List Servers**, disable the bundled SocratiCode server, and add this user-scoped direct server through **MCP: Open User Configuration**:

```json
{
  "servers": {
    "socraticode-configured": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {
        "QDRANT_MODE": "external",
        "QDRANT_URL": "https://xyz.qdrant.io"
      }
    }
  }
}
```

Start a new Chat and use **MCP: List Servers** to confirm that only `socraticode-configured` is active. Use `envFile` instead of `env` when variables should come from a separate local file. Server enablement is stored separately from the shared plugin definition. See [VS Code MCP server management](https://code.visualstudio.com/docs/agent-customization/mcp-servers) and the [`env` / `envFile` reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### VS Code editor extension

The separately published editor extension adds the SocratiCode sidebar, status item, commands, walkthrough, and interactive graph webview. Install **SocratiCode** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=giancarloerra.socraticode) in the current VS Code profile.

On Microsoft VS Code 1.99+ and compatible editors that implement the VS Code MCP provider API, the extension registers SocratiCode with the editor's native MCP registry. It does not configure independent clients such as Cline, Continue, or Roo Code.

Reload the window and start a new Chat session after installation. Run **MCP: List Servers** to confirm that `SocratiCode` is running, and open the SocratiCode sidebar to verify the editor UI. Update it through the Extensions view or **Extensions: Check for Extension Updates**.

The [Open VSX package](https://open-vsx.org/extension/giancarloerra/socraticode) can be installed in VS Code-derived editors, but native MCP registration requires that editor to implement `vscode.lm.registerMcpServerDefinitionProvider`. See the [VS Code MCP extension API](https://code.visualstudio.com/api/extension-guides/ai/mcp).

#### VS Code direct MCP installation

Use the Stable or Insiders badge above, choose user or workspace scope in VS Code, then start a new Chat session. A project-scoped `.vscode/mcp.json` uses this complete object:

```json
{
  "servers": {
    "socraticode": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"]
    }
  }
}
```

Verify with **MCP: List Servers**. Restart the server from that command and start a new Chat session after a release.

### Cursor

The repository includes a Cursor-format plugin with the MCP server, skills, and instructions. SocratiCode is not currently published in the Cursor Marketplace, so use Cursor's documented user-scoped local-plugin directory. Clone the repository, then check out the stable version shown on the [latest SocratiCode release](https://github.com/giancarloerra/socraticode/releases/latest):

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/giancarloerra/socraticode.git ~/.cursor/plugins/local/socraticode
git -C ~/.cursor/plugins/local/socraticode checkout <latest-release-tag>
```

Replace `<latest-release-tag>` with the release tag shown on that page, for example `vX.Y.Z`. Restart Cursor or run **Developer: Reload Window**, then verify the plugin under **Customize**. To update to a later public release:

```bash
git -C ~/.cursor/plugins/local/socraticode fetch --tags
git -C ~/.cursor/plugins/local/socraticode checkout <latest-release-tag>
```

Reload Cursor after updating. These commands intentionally follow release tags rather than unreleased commits on `main`. See [Cursor plugins](https://prod.cursor.com/docs/plugins).

For direct MCP configuration, use the Cursor badge above and select the intended user or project scope in Cursor. Start a new Agent chat, then verify `socraticode` under **Cursor Settings → Tools & MCP**. The installation link already uses the latest-release engine command. See [Cursor MCP install links](https://prod.cursor.com/docs/mcp/install-links).

The current local plugin does not declare user-configurable variables. To keep its skills while applying custom variables, open **Customize**, disable the plugin-provided SocratiCode MCP server, and add one direct server to the user or project `mcp.json`:

```json
{
  "mcpServers": {
    "socraticode-configured": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {
        "QDRANT_MODE": "external",
        "QDRANT_URL": "https://xyz.qdrant.io"
      }
    }
  }
}
```

Reload Cursor and verify under **Customize** that only `socraticode-configured` is active. See [Cursor plugin variables](https://prod.cursor.com/docs/reference/plugins#variables) and [MCP server management](https://prod.cursor.com/docs/mcp).

The SocratiCode package on Open VSX is a VS Code-style editor extension, not a Cursor plugin. Installing that extension does not establish that Cursor implements VS Code's native MCP provider API. Use the local plugin or direct MCP path when MCP availability is required.

### Gemini CLI extension

Install the user-scoped Gemini extension with automatic updates, verify it, then restart any active Gemini CLI session:

```bash
gemini extensions install https://github.com/giancarloerra/socraticode --auto-update
gemini extensions list
```

If it was installed without `--auto-update`, update it manually and restart Gemini:

```bash
gemini extensions update socraticode
gemini extensions list
```

Gemini limits which inherited environment variables are passed to extension MCP servers. For advanced configuration, define a server with the same name in user scope (`~/.gemini/settings.json`) or workspace scope (`.gemini/settings.json`). That definition overrides the extension server and explicitly forwards only the variables named in `env`:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "QDRANT_MODE": "external",
        "QDRANT_URL": "${QDRANT_URL}",
        "QDRANT_API_KEY": "${QDRANT_API_KEY}"
      }
    }
  }
}
```

Keep secret values in the process environment rather than committing them. Restart Gemini and run `gemini mcp list` to verify the overridden server. See the [Gemini extension reference](https://geminicli.com/docs/extensions/reference/) and [Gemini MCP configuration](https://geminicli.com/docs/tools/mcp-server/).

### Continue

Continue uses a YAML `mcpServers` list. For project scope, create `.continue/mcpServers/socraticode.yaml`:

```yaml
name: SocratiCode MCP
version: 1.0.0
schema: v1
mcpServers:
  - name: SocratiCode
    type: stdio
    command: npx
    args:
      - "-y"
      - "--prefer-online"
      - socraticode@latest
```

Continue refreshes saved configuration automatically. Open a new Continue Agent session and confirm the SocratiCode tools are listed. For user scope, add the same `mcpServers` list to `~/.continue/config.yaml`. Continue can also import complete JSON MCP files placed in `.continue/mcpServers/`. See [Continue MCP configuration](https://docs.continue.dev/customize/deep-dives/mcp) and the [Continue YAML reference](https://docs.continue.dev/reference).

### Cline

For project scope, save this complete object as `.cline/mcp.json`. For user scope, add the same server to `~/.cline/data/settings/cline_mcp_settings.json` through Cline's MCP settings interface:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Start a new Cline task and verify that `socraticode` and its tools appear in the MCP Servers view. Reconnect the server after a release. See the [Cline MCP documentation](https://docs.cline.bot/mcp/mcp-overview).

### Roo Code

For project scope, save this complete object as `.roo/mcp.json`. For user scope, open Roo Code's MCP Servers view and select **Edit Global MCP**:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "disabled": false
    }
  }
}
```

Start a new Roo Code task and verify that `socraticode` is connected in the MCP Servers view. Restart the server after a release. Project configuration takes precedence over a global server with the same name. See [Using MCP in Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs/blob/main/docs/features/mcp/using-mcp-in-roo.mdx).

### Zed

Open **Settings → AI → MCP Servers → Add Server → Add Local Server**. The UI writes user-scoped settings. Use this complete server definition, either there or in project-scoped `.zed/settings.json`:

```json
{
  "context_servers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {}
    }
  }
}
```

Verify that the indicator beside SocratiCode is green and its tooltip says **Server is active**, then start a new Agent conversation. Restart the server from the MCP Servers page after a release.

Zed uses `~/.config/zed/AGENTS.md` for personal instructions. For project instructions it uses the first matching supported file, which can be `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or another supported compatibility file. Zed Rules were replaced by Skills and Instructions. See [Zed MCP servers](https://zed.dev/docs/ai/mcp) and [Zed Instructions](https://zed.dev/docs/ai/instructions).

### OpenCode

Use project-root `opencode.json` or `opencode.jsonc` for project scope. Use `~/.config/opencode/opencode.json` or `opencode.jsonc` for user scope:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "socraticode": {
      "type": "local",
      "command": ["npx", "-y", "--prefer-online", "socraticode@latest"],
      "enabled": true
    }
  }
}
```

Restart OpenCode and verify the server with `opencode mcp list`. Restart OpenCode after a release so npm can check for the current engine. This is the OpenCode 1.x schema.

OpenCode V2 nests server names under `mcp.servers` and uses `disabled` instead of `enabled`; its local server definition is otherwise equivalent:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "socraticode": {
        "type": "local",
        "command": ["npx", "-y", "--prefer-online", "socraticode@latest"],
        "disabled": false,
        "environment": {}
      }
    }
  }
}
```

See [OpenCode 1.x MCP servers](https://opencode.ai/docs/mcp-servers/), [OpenCode V2 MCP servers](https://opencode.ai/v2/docs/mcp-servers), and [OpenCode configuration](https://opencode.ai/docs/config/).

### Other local stdio MCP hosts

The complete JSON object in [Quick Start](#quick-start) applies only to hosts whose documentation specifies an `mcpServers` object. Add it at the user or project scope documented by that host, restart the MCP server or start a new session, and verify SocratiCode in the host's MCP server and tool list. The example already checks for the latest published engine whenever the server starts. Hosts that support only remote HTTP MCP servers cannot launch SocratiCode directly.

## Why SocratiCode

I built SocratiCode because I regularly work on existing, large, and complex codebases across different languages and need to quickly understand them and act. Existing solutions were either too limited, insufficiently tested for production use, or bloated with unnecessary complexity. I wanted a single focused tool that does deep codebase intelligence well — zero setup, no bloat, fully automatic — and gets out of the way.

### Built-in Code Search vs SocratiCode

| Feature | Claude Code | Cursor | VS Code Copilot | + SocratiCode |
|:--------|:-----------:|:------:|:---------------:|:-------------:|
| Text / grep search | ✅ | ✅ | ✅ | ✅ |
| Semantic search | — | ✅ | ✅¹ | ✅ |
| Hybrid search (fused) | — | — | — | ✅ |
| Code dependency graph | — | — | ✅² | ✅ |
| Symbol-level impact / blast radius | — | — | — | ✅ |
| Call-flow tracing (entry point → callees) | — | — | — | ✅ |
| Interactive visual graph explorer | — | — | — | ✅ |
| Circular dependency detection | — | — | — | ✅ |
| Non-code knowledge (schemas, API specs) | — | — | — | ✅ |
| Cross-project search | — | — | — | ✅ |
| Branch-aware indexing | — | — | — | ✅ |
| Multi-agent shared index | — | — | — | ✅ |
| Tool-independent (survives switching AI) | — | — | — | ✅ |
| Fully local / private | ✅ | —³ | —⁴ | ✅ |
| Resumable indexing | — | — | — | ✅ |
| Live file watching | — | ✅ | — | ✅ |

<sub>¹ VS Code Copilot: remote index via GitHub / Azure DevOps; local "External Ingest" gradually rolling out. ² LSP-based Find References / Go to Definition (Usages tool), not a full dependency graph. ³ Cursor: embeddings processed on Cursor servers (encrypted in transit and at rest). ⁴ VS Code Copilot: remote index hosted on GitHub / Azure DevOps. Sources: [Cursor docs](https://docs.cursor.com/context/codebase-indexing), [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code/overview), [VS Code Copilot docs](https://code.visualstudio.com/docs/copilot/chat/codebase-context).</sub>

> **🔌 The context lives with your codebase, not with the assistant.** Built-in indexes (Cursor's, Copilot's) are tied to that one tool — switch assistants and you start from scratch. SocratiCode is independent: index once, then plug it into Claude Code, Cursor, Copilot, Windsurf, your own private model, or all of them at once. They share the same understanding of your code.

On VS Code's 2.45M‑line codebase, SocratiCode answers architectural questions with **61% less data**, **84% fewer steps**, and **37× faster** response than a grep‑based AI agent. [Full benchmark →](#real-world-benchmark-vs-code-245m-lines-of-code-with-claude-opus-46)

## Features

- **Hybrid code search** — Built on Qdrant, a purpose-built vector database with HNSW indexing, concurrent read/write, and payload filtering. Each chunk stores both a dense vector and a BM25 sparse vector; the Query API runs both sub-queries in a single round-trip and fuses results with Reciprocal Rank Fusion (RRF). Semantic search handles conceptual queries like "authentication middleware" even when those exact words don't appear in the code. BM25 handles exact identifier and keyword lookups. You get the best of both in every query with no tuning required.
- **Configurable Qdrant** — Use the built-in Docker Qdrant (default, zero config) or connect to your own instance (self-hosted, remote server, or Qdrant Cloud). Configure via `QDRANT_MODE`, `QDRANT_URL`, and `QDRANT_API_KEY` environment variables.
- **Configurable Ollama** — Use the built-in Docker Ollama (default, zero config) or point to your own Ollama instance (native install -GPU access-, remote server, etc.). Configure via `OLLAMA_MODE`, `OLLAMA_URL`, `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` environment variables.
- **Multi-provider embeddings** — Switch between Local Ollama (private, GPU access), Docker Ollama (zero-config), OpenAI (`text-embedding-3-small`, fastest), Google Gemini (`gemini-embedding-001`, free tier), LM Studio (local OpenAI-compatible server), or LiteLLM (proxy gateway in front of 100+ providers) with a single environment variable. No provider-specific configuration files.
- **Private & secure** — Everything runs on your machine — your code never leaves your network. The default Docker setup includes Ollama (embeddings) and Qdrant (vector storage) with no external API calls. No API costs, no token limits. Suitable for air-gapped and on-premises environments. Optional cloud providers (OpenAI, Google Gemini, Qdrant Cloud) are available but never required.
- **AST-aware chunking** — Files are split at function/class boundaries using AST parsing (ast-grep), not arbitrary line counts. This produces higher-quality search results. Falls back to line-based chunking for unsupported languages.
- **Polyglot code dependency graph** — Static analysis of import/require/use/include statements using ast-grep for 19+ languages. No external tools like dependency-cruiser required. Detects circular dependencies and generates visual Mermaid diagrams.
- **Broad language support** — Works with every [supported file type](#language-support) out of the box. Fully supported languages bundle their grammars. GDScript uses an optional native parser when compatible and a syntax-aware fallback otherwise. For non-standard extensions, configure [`EXTRA_EXTENSIONS`](#environment-variables). If your AI can read it, SocratiCode can index it.
- **Incremental indexing** — After the first full index, only changed files are re-processed. Content hashes are persisted in Qdrant so state survives server restarts.
- **Batched & resumable indexing** — Files are processed in batches of 50, with progress checkpointed to Qdrant after each batch. If the process crashes or is interrupted, the next run automatically resumes from where it left off — already-indexed files are skipped via hash comparison. This keeps peak memory low and makes indexing reliable even for very large codebases.
- **Live file watching** — Optionally watch for file changes and keep the index updated in real time (debounced 2s). Watcher also invalidates the code graph cache.
- **Parallel processing** — Files are scanned and chunked in parallel batches (50 at a time) for fast I/O, while embedding generation and upserts are batched separately for optimal throughput.
- **Multi-project** — Index multiple projects simultaneously. Each gets its own isolated collection with full project path tracking.
- **Cross-project search** — Search across multiple related projects in a single query. Link projects via `.socraticode.json` or the `SOCRATICODE_LINKED_PROJECTS` env var, then set `includeLinked: true` on `codebase_search`. Results are tagged with project labels and ranked by cosine similarity, which is comparable across projects of very different sizes (falling back to rank fusion when a cosine is unavailable for any hit).
- **Branch-aware indexing** — Maintain separate indexes per git branch by setting `SOCRATICODE_BRANCH_AWARE=true`. Each branch gets its own Qdrant collections, so switching branches instantly switches to the correct index. Ideal for CI/CD pipelines and PR review workflows. Requires a path-derived project id: an explicit id (`SOCRATICODE_PROJECT_ID`, or `projectId` in `.socraticode.json`) is treated as a stable identity and is never suffixed, so branch-aware mode does not apply to those projects.
- **Respects ignore rules** — Honors all `.gitignore` files (root + nested), plus an optional `.socraticodeignore` for additional exclusions. Includes sensible built-in defaults. `.gitignore` processing can be disabled via `RESPECT_GITIGNORE=false`. Dot-directories (e.g. `.agent`) can be included via `INCLUDE_DOT_FILES=true`.
- **Custom file extensions** — Projects with non-standard extensions (e.g. `.tpl`, `.blade`) can be included via `EXTRA_EXTENSIONS` env var or `extraExtensions` tool parameter. Such files are indexed as plaintext and appear as leaf nodes in the code graph (no AST chunking or symbols). To instead treat a custom extension as a real language (full AST chunking, symbols, call graph), map it with `EXTENSION_LANGUAGE_MAP` (e.g. `.inc:php`).
- **Configurable infrastructure** — All ports, hosts, and API keys are configurable via environment variables. Qdrant API key support for enterprise deployments.
- **Enterprise-ready simplicity** — No agent coordination tuning, no memory limit environment variables, no coordinator/conductor capacity knobs, no backpressure configuration. SocratiCode scales by relying on production-grade infrastructure (Qdrant, proven embedding APIs) rather than complex in-process orchestration.
- **Auto-setup & zero configuration** — Just install the Claude Plugin/Skill or add the MCP server to your AI host config. On first use, the server automatically checks Docker, pulls images, starts Qdrant and Ollama containers, and downloads the embedding model. No config files, YAML, environment variables, or required native compilation. The optional GDScript parser falls back safely when no compatible native build is available. Works everywhere Docker runs.
- **Session resume** — By default, server startup resumes the indexed project represented by the MCP process's working directory. Complete indexes get a watcher plus an incremental catch-up update; interrupted indexes resume from the last checkpoint. Explicit project lists and `SOCRATICODE_AUTO_RESUME=all` extend this to other indexed projects.
- **Auto-start watcher** — In the default `SOCRATICODE_WATCHER=auto` mode, the file watcher starts during startup resume and after `codebase_index` or `codebase_update`. A completed indexed project not selected at startup gets a fallback watcher start on its first search, status, or graph interaction. `manual` permits only an explicit `codebase_watch { action: "start" }`; `off` disables watcher startup completely.
- **Manual index snapshots** — `SOCRATICODE_WATCHER=off` plus `SOCRATICODE_AUTO_RESUME=off` prevents implicit code-index updates, embeddings, and graph creation. Existing code indexes and graphs stay readable; refresh them explicitly with `codebase_index`, `codebase_update`, or `codebase_graph_build`.
- **Auto-build code graph** — The code dependency graph is automatically built after indexing and rebuilt when watched files change. An update that changed nothing the graph is built from — a README, a fixture, a migration — reuses the existing graph rather than rebuilding it; each build records the inputs it read, and the rebuild is skipped only when every one of them is unchanged. Anything added, any configuration change, and a graph with no such record all rebuild. No need to call `codebase_graph_build` manually unless you want to force a rebuild.
- **Multi-agent collaboration** — Multiple AI agents (each running their own MCP instance) can work on the same codebase simultaneously and share a single index. One agent triggers indexing, all agents search against the same data. Only one watcher runs per project — every agent benefits from real-time updates. Cross-process file locking coordinates indexing and watching automatically. Ideal for workflows like one agent writing tests while another fixes code, or a planning agent and an implementation agent working in parallel.
- **Cross-process safety** — File-based locking (`proper-lockfile`) prevents multiple MCP instances from simultaneously indexing or watching the same project. Stale locks from crashed processes are automatically reclaimed. When another MCP process is already watching a project, `codebase_status` reports "active (watched by another process)" instead of incorrectly showing "inactive."
- **Concurrency guards** — Duplicate indexing and graph-build operations are prevented. If you call `codebase_index` while indexing is already running, it returns the current progress instead of starting a second operation.
- **Graceful stop** — Long-running indexing operations can be stopped safely with `codebase_stop`. The current batch finishes and checkpoints, preserving all progress. Re-run `codebase_index` to resume from where it left off.
- **Graceful shutdown** — On server shutdown, active indexing operations are given up to 60 seconds to complete, all file watchers are stopped cleanly, and the everything closes gracefully.
- **Structured logging** — All operations are logged with structured context for observability. Log level configurable via `SOCRATICODE_LOG_LEVEL`.
- **Graceful degradation** — If infrastructure goes down during watch, the watcher backs off and retries instead of crashing.

## Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| [Docker](https://www.docker.com/products/docker-desktop/) | Runs Qdrant (vector DB) and by default Ollama (embeddings) | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Node.js 18.17+ with `npx` on `PATH` | Runs the MCP server | [nodejs.org](https://nodejs.org/) |

Docker must be **running** when you use the server in the default `managed` mode. 

The Qdrant container is managed automatically. If you set `QDRANT_MODE=external` and point `QDRANT_URL` at a remote or cloud Qdrant instance, Docker is only needed for Ollama (embeddings) in that case.

The Ollama container (embeddings) is also managed automatically in the default `auto` mode. SocratiCode first checks if Ollama is already running natively — if so it uses it. Otherwise it manages a Docker container for you. First-time download of the docker images or embedding models may take a few minutes, depending on your internet speed, and is required only at first launch.

### Embedding performance on macOS / Windows

Docker containers on macOS and Windows cannot access the GPU (no Metal or CUDA passthrough). For small projects this is fine, but for medium-to-large codebases the CPU-only container is noticeably slower.

**For best performance, install native Ollama:** download and run the installer from [ollama.com/download](https://ollama.com/download). Once Ollama is running, SocratiCode will automatically detect and use it — no extra configuration needed (first-time download of the embedding model, if not present, might take a few minutes). This gives you Metal GPU acceleration on macOS and CUDA on Windows/Linux.

If you prefer speed without a local install, see [OpenAI Embeddings](#openai-embeddings) and [Google Generative AI Embeddings](#google-generative-ai-embeddings) below for cloud-based options. OpenAI is very fast with no local setup required. Google’s free tier is functional but rate-limited. See [Environment Variables](#environment-variables) for configuration details.

## Example Workflow

All tools default `projectPath` to the current working directory, so you never need to specify a path for the active project.

```
User: "Index this project"
→ codebase_index {}
  ⚡ Indexing started in the background — call codebase_status to check progress
→ codebase_status {}
  ⚠ Full index in progress — Phase: generating embeddings (batch 1/1)
  Progress: 247/1847 chunks embedded (13%) — Elapsed: 12s
→ codebase_status {}
  ✓ Indexing complete: 342 files, 1,847 chunks (took 115.2s)
  File watcher: active (auto-updating on changes)

User: "Search for how authentication is handled"
→ codebase_search { query: "authentication handling" }
  Runs dense semantic search + BM25 keyword search in parallel, fuses results with RRF
  Returns top 10 results ranked by combined relevance

User: "What files depend on the auth middleware?"
→ codebase_graph_query { filePath: "src/middleware/auth.ts" }
  Returns imports and dependents
  (graph was auto-built after indexing — no manual build needed)

User: "Show me the dependency graph"
→ codebase_graph_visualize {}
  Returns a Mermaid diagram colour-coded by language

User: "Are there any circular dependencies?"
→ codebase_graph_circular {}
  Found 2 cycles: src/a.ts → src/b.ts → src/a.ts

User: "What breaks if I rename validateUser?"
→ codebase_impact { target: "validateUser" }
  Blast radius for symbol: validateUser
  Hop 1 (3 files): src/auth/login.ts, src/api/users.ts, tests/auth.test.ts
  Hop 2 (5 files): ...

User: "What does the server entry point actually do?"
→ codebase_flow {}
  Detected 4 entry point(s):
    main (cmd/server.go:10) — well-known-name:main
    healthz (src/api/routes.ts:42) — framework:get
    ...
→ codebase_flow { entrypoint: "main" }
  └── main (cmd/server.go:10)
      ├── loadConfig (cmd/server.go:15)
      └── startServer (src/server.ts:8)
          └── ...

User: "Who calls bcryptCompare and what does it call?"
→ codebase_symbol { name: "bcryptCompare" }
  Symbol: bcryptCompare (function)
  Defined: src/auth/hash.ts:42–58
  Callers (3): ← src/auth/login.ts:12, ← src/auth/reset.ts:30 ...
  Callees (1): → compare [unique, 1 candidate]
```

## Agent Instructions

> **Claude Code plugin users**: These instructions are included automatically as skills in the SocratiCode plugin. You don't need to copy them into `CLAUDE.md`. The section below is for non-Claude Code hosts (VS Code, Cursor, Claude Desktop, etc.).

For best results, add instructions like the following to your AI assistant's project-level instructions file. The core principle: **search before reading**. The index gives you a map of the codebase in milliseconds; raw file reading is expensive and context-consuming.

**Where to place these instructions** (per IDE):

| IDE / Tool | Instructions file |
|:-----------|:-----------------|
| Claude Code | `CLAUDE.md` at project root (auto-loaded). Plugin users get this via skills automatically. |
| Cursor | `AGENTS.md` at project root, or `.cursor/rules/socraticode.mdc` for a dedicated rule file |
| VS Code Copilot | `.github/copilot-instructions.md`, or a custom instructions file in your VS Code User prompts folder |
| Zed | `AGENTS.md` at project root, or `~/.config/zed/AGENTS.md` for personal instructions. Zed uses the first matching supported project instruction file. |
| Windsurf | `.windsurfrules` at project root |
| Claude Desktop / Cline / Roo Code | Add directly to your system prompt configuration |

> **Why this matters**: Installing the MCP server alone gives your agent access to SocratiCode tools, but the agent still decides when to use them. Adding these instructions to your project ensures the agent consistently prefers SocratiCode search over raw file reads, uses the graph for dependency-aware tasks, and follows the search-before-reading workflow.

```markdown
## Codebase Search (SocratiCode)

This project is indexed with SocratiCode. Always use its MCP tools to explore the codebase
before reading any files directly.

### Workflow

1. **Start most explorations with `codebase_search`.**
   Hybrid semantic + keyword search (vector + BM25, RRF-fused) runs in a single call.
   - Use broad, conceptual queries for orientation: "how is authentication handled",
     "database connection setup", "error handling patterns".
   - Use precise queries for symbol lookups: exact function names, constants, type names.
   - Prefer search results to infer which files to read — do not speculatively open files.
   - **When to use grep instead**: If you already know the exact identifier, error string,
     or regex pattern, grep/ripgrep is faster and more precise — no semantic gap to bridge.
     Use `codebase_search` when you're exploring, asking conceptual questions, or don't
     know which files to look in.

2. **Follow the graph before following imports.**
   Use `codebase_graph_query` to see what a file imports and what depends on it before
   diving into its contents. This prevents unnecessary reading of transitive dependencies.
   - **Before modifying or deleting a file**, check its dependents with `codebase_graph_query`
     to understand the blast radius.
   - **When planning a refactor**, use the graph to identify all affected files before
     making changes.

3. **Use Impact Analysis BEFORE refactoring, renaming, or deleting code.**
   The symbol-level call graph (`codebase_impact`, `codebase_flow`, `codebase_symbol`,
   `codebase_symbols`) goes one step deeper than the file graph: it knows which
   functions and methods call which.
   - `codebase_impact` answers "what breaks if I change X?" (blast radius — every file
     that transitively calls into the target).
   - `codebase_flow` answers "what does this code do?" by tracing forward from an entry
     point. Call with no `entrypoint` to discover candidate entry points (auto-detected
     via orphans, conventional names like `main()`, framework routes, tests).
   - `codebase_symbol` gives a 360° view of one function: definition, callers, callees.
   - `codebase_symbols` lists symbols in a file or searches by name.
   - Always prefer these over reading multiple files when the question is about
     dependencies between functions, not concepts.

4. **Read files only after narrowing down via search.**
   Once search results clearly point to 1–3 files, read only the relevant sections.
   Never read a file just to find out if it's relevant — search first.

5. **Use `codebase_graph_circular` when debugging unexpected behaviour.**
   Circular dependencies cause subtle runtime issues; check for them proactively.
   Also run `codebase_graph_circular` when you notice import-related errors or unexpected
   initialisation order.

6. **Check `codebase_status` if search returns no results.**
   The project may not be indexed yet. Run `codebase_index` if needed, then wait for
   `codebase_status` to confirm completion before searching.

7. **Leverage context artifacts for non-code knowledge.**
   Projects can define a `.socraticodecontextartifacts.json` config to expose database
   schemas, API specs, infrastructure configs, architecture docs, and other project
   knowledge that lives outside source code. These artifacts are auto-indexed alongside
   code during `codebase_index` and `codebase_update`.
   - Run `codebase_context` early to see what artifacts are available.
   - Use `codebase_context_search` to find specific schemas, endpoints, or configs
     before asking about database structure or API contracts.
   - If `codebase_status` shows artifacts are stale, run `codebase_context_index` to
     refresh them.

### When to use each tool

| Goal | Tool |
|------|------|
| Understand what a codebase does / where a feature lives | `codebase_search` (broad query) |
| Find a specific function, constant, or type | `codebase_search` (exact name) or grep if you know already the exact string |
| Find exact error messages, log strings, or regex patterns | grep / ripgrep |
| See what a file imports or what depends on it | `codebase_graph_query` |
| Check blast radius before modifying or deleting a file | `codebase_impact` (symbol-level) or `codebase_graph_query` (file-level) |
| **What breaks if I change function X?** | `codebase_impact target=X` |
| **What does this entry point actually do?** | `codebase_flow entrypoint=X` |
| **List entry points in this codebase** | `codebase_flow` (no args) |
| **Who calls this function and what does it call?** | `codebase_symbol name=X` |
| **What functions/classes exist in this file?** | `codebase_symbols file=path` |
| **Search for symbols by name across the project** | `codebase_symbols query=X` |
| Spot architectural problems | `codebase_graph_circular`, `codebase_graph_stats` |
| Visualise module structure | `codebase_graph_visualize` |
| Verify index is up to date | `codebase_status` |
| Discover what project knowledge (schemas, specs, configs) is available | `codebase_context` |
| Find database tables, API endpoints, infra configs | `codebase_context_search` |
```

> **Why semantic search first?** A single `codebase_search` call returns ranked, deduplicated snippets from across the entire codebase in milliseconds. This gives you a broad map at negligible token cost — far cheaper than opening files speculatively. Once you know which files matter, targeted reading is both faster and more accurate. That said, grep remains the right tool when you have an exact string or pattern — use whichever fits the query.

> **Keep the connection alive during indexing.** Indexing runs in the background — the MCP server continues working even when not actively responding to tool calls. However, some MCP hosts might disconnect an idle MCP connection after a period of inactivity, which might cut off the background process. Instruct your AI to call `codebase_status` roughly every 60 seconds after starting `codebase_index` until it completes. This keeps the host connection active and provides real-time progress.

## Configuration

### Install

Use the host-specific steps in [Plugins and host integrations](#plugins-and-host-integrations). They cover installation scope, activation, verification, updates, and each host's actual configuration schema.

#### From source (for contributors)

```bash
git clone https://github.com/giancarloerra/socraticode.git
cd socraticode
npm install
npm run build
```

Register `node /absolute/path/to/socraticode/dist/index.js` in the user or project scope supported by your MCP host, then restart the server or start a new session. Verify SocratiCode in the host's MCP server list. To update, run `git pull --ff-only`, `npm install`, and `npm run build` in the clone, then restart the MCP server and verify it again.

### MCP host config variants

The examples below use the conventional JSON `mcpServers` shape to show SocratiCode settings. Apply the same command and environment values through the host-specific schema documented in [Plugins and host integrations](#plugins-and-host-integrations). Continue, Gemini CLI, VS Code, Zed, and OpenCode use different configuration paths or wrappers.

#### Default (zero config, from source)

> Using **npx**? Replace the `node` command and source path below with `"command": "npx"` and `"args": ["-y", "--prefer-online", "socraticode@latest"]`.

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"]
    }
  }
}
```

> **Tip**: The default `OLLAMA_MODE=auto` detects native Ollama (port 11434) on startup and uses it if available, otherwise falls back to a managed Docker container. To make your config self-documenting, add an `"env"` block with explicit values. See [Environment Variables](#environment-variables) for all options.

#### External Ollama (native install)

If you have [Ollama](https://ollama.com) installed natively, set `OLLAMA_MODE=external` and point to your instance:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "OLLAMA_MODE": "external",
        "OLLAMA_URL": "http://localhost:11434"
      }
    }
  }
}
```

The embedding model is pulled automatically on first use. To pre-download: `ollama pull nomic-embed-text`

#### Remote Ollama server

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "OLLAMA_MODE": "external",
        "OLLAMA_URL": "http://gpu-server.local:11434"
      }
    }
  }
}
```

#### OpenAI Embeddings

Use OpenAI's cloud embedding API instead of local Ollama. Requires an [API key](https://platform.openai.com/api-keys).

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

> Defaults: `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536`. For higher quality, use `text-embedding-3-large` with `EMBEDDING_DIMENSIONS=3072`.

#### Google Generative AI Embeddings

Use Google's Gemini embedding API. Requires an [API key](https://aistudio.google.com/apikey).

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "google",
        "GOOGLE_API_KEY": "AIza..."
      }
    }
  }
}
```

> Defaults: `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMENSIONS=3072`.

#### LM Studio (local, OpenAI-compatible)

[LM Studio](https://lmstudio.ai/) ships with a Local Server that exposes an OpenAI-compatible
API on `http://localhost:1234/v1`. Use this provider when you want to host embedding models
in LM Studio (e.g. when LM Studio is your single source for both chat and embedding models,
or when you want a Mac/Windows-friendly desktop UI for managing GGUF models).

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "lmstudio",
        "EMBEDDING_MODEL": "nomic-embed-text-v1.5",
        "EMBEDDING_DIMENSIONS": "768"
      }
    }
  }
}
```

> **No defaults — `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` are required.** LM Studio has
> no out-of-the-box embedding model; you load one yourself in the Local Server tab. SocratiCode
> fails fast if either is missing.
>
> Optional: `LMSTUDIO_URL` (default `http://localhost:1234/v1`) for non-default ports;
> `LMSTUDIO_API_KEY` if you've enabled API key auth in LM Studio;
> `LMSTUDIO_ALLOW_MISSING_MODEL_LISTING=true` for OpenAI-compatible servers that have no
> `/v1/models` endpoint (see below).

This provider also drives any other server that speaks the OpenAI embeddings API.
Single-model servers such as [HuggingFace Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
(TEI) fix the model at startup and answer `/v1/models` with a 404, so readiness needs
`LMSTUDIO_ALLOW_MISSING_MODEL_LISTING=true` to fall back to probing `/v1/embeddings`:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "lmstudio",
        "LMSTUDIO_URL": "http://localhost:8080/v1",
        "EMBEDDING_MODEL": "BAAI/bge-m3",
        "EMBEDDING_DIMENSIONS": "1024",
        "LMSTUDIO_ALLOW_MISSING_MODEL_LISTING": "true"
      }
    }
  }
}
```

> `EMBEDDING_MODEL` is whatever the server was started with (TEI's `--model-id`) and
> `EMBEDDING_DIMENSIONS` must match that model's output width — the probe checks it and
> fails fast on a mismatch, since without `/v1/models` there is nothing else to verify
> against.

#### LiteLLM (proxy gateway, 100+ providers)

[LiteLLM](https://docs.litellm.ai/docs/simple_proxy) Proxy Server exposes an OpenAI-compatible
`/v1/embeddings` endpoint and fans out to any of 100+ underlying providers (OpenAI, Anthropic,
Cohere, Voyage, HuggingFace, Bedrock, Vertex AI, Ollama, ...). Use this provider when you want
**centralised key management** (one virtual key per developer instead of N provider keys spread
across MCP configs), **fallback / load balancing** between embedding backends, or
**provider-agnostic indexes** that survive a backend swap.

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "node",
      "args": ["/absolute/path/to/socraticode/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "litellm",
        "LITELLM_API_KEY": "sk-...",
        "EMBEDDING_MODEL": "text-embedding-3-small",
        "EMBEDDING_DIMENSIONS": "1536"
      }
    }
  }
}
```

> **`LITELLM_API_KEY`, `EMBEDDING_MODEL`, and `EMBEDDING_DIMENSIONS` are all required.**
> LiteLLM proxies always authenticate (master key or virtual key from `/key/generate`); the
> alias name and underlying dimension come from your `config.yaml`. SocratiCode fails fast on
> any missing piece.
>
> Optional: `LITELLM_URL` (default `http://localhost:4000/v1`) — must include the `/v1`
> suffix; `LITELLM_SEND_DIMENSIONS=true` to forward the OpenAI `dimensions` parameter
> through the proxy (only safe for Matryoshka-aware backends like `text-embedding-3-*` or
> `voyage-3` — non-Matryoshka backends reject the request).

> **This is a client for the LiteLLM _proxy server_, not the LiteLLM Python library, and it does
> not route `provider/model` strings itself.** It sends `EMBEDDING_MODEL` to `LITELLM_URL`
> verbatim and requires that name to appear in the proxy's `/v1/models`. To reach a backend such
> as OpenRouter, register it in the proxy's `config.yaml` `model_list` (set `model_name` to the
> value you put in `EMBEDDING_MODEL`, and `litellm_params.model` to e.g.
> `openrouter/qwen/qwen3-embedding-8b`); the proxy does the routing and SocratiCode just sends the
> alias. Pointing `LITELLM_URL` directly at a non-LiteLLM endpoint works only if that endpoint is
> OpenAI-compatible, lists your `EMBEDDING_MODEL` under `/v1/models`, and accepts it under its own
> native model id (no LiteLLM `provider/` prefix).

### Git Worktrees (shared index across directories)

If you use [git worktrees](https://git-scm.com/docs/git-worktree) — or any workflow where the same repository lives in multiple directories — each path would normally get its own Qdrant index. This means redundant embedding and storage for what is essentially the same codebase.

Set `SOCRATICODE_PROJECT_ID` to share a single index across all directories of the same project.

#### MCP hosts with git worktree detection (e.g. Claude Code)

Some MCP hosts (like [Claude Code](https://claude.ai/claude-code)) resolve the project root by following git worktree links. Since worktrees point back to the main repository's `.git` directory, the host automatically maps all worktrees to the same project config. This means you only need to configure the MCP server **once** for the main checkout — all worktrees inherit it automatically.

For Claude Code, add the server with local scope from your main checkout:

```bash
cd /path/to/main-checkout
claude mcp add -e SOCRATICODE_PROJECT_ID=my-project --scope local socraticode -- npx -y --prefer-online socraticode@latest
```

All worktrees created from this repo will automatically connect to socraticode with the shared project ID. No per-worktree setup needed.

> **Note:** This only works for git worktrees. Separate `git clone`s of the same repo have independent `.git` directories and won't share the config.

#### Other MCP hosts (per-project `.mcp.json`)

For MCP hosts that don't resolve git worktree paths, add a `.mcp.json` at the root of each worktree (and your main checkout):

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {
        "SOCRATICODE_PROJECT_ID": "my-project"
      }
    }
  }
}
```

Add `.mcp.json` to your `.gitignore` if you don't want it tracked.

#### How it works

With this config, agents running in `/repo/main`, `/repo/worktree-feat-a`, and `/repo/worktree-fix-b` all share the same `codebase_my-project`, `codegraph_my-project`, and `context_my-project` Qdrant collections.

**How it works in practice:**

- The semantic index reflects whichever worktree last triggered a file change — but since branches typically differ by only a handful of files, the index is 99%+ accurate for all worktrees
- Your AI agent reads actual file contents from its own worktree; the shared index is only used for discovery and navigation
- When changes merge back to main, the file watcher re-indexes the changed files and the index converges

### Team-Shared Index (committed `projectId`)

The env-var approach above works per-machine. For a stable identifier that every teammate (and CI runner) picks up automatically, commit a `projectId` in `.socraticode.json` at the project root:

```json
{
  "projectId": "my-project"
}
```

Now any checkout of the repo — regardless of where it lives on disk or which user account owns it — addresses the same `codebase_my-project`, `codegraph_my-project`, and `context_my-project` Qdrant collections. This is the recommended setup for teams sharing a Qdrant instance: the index is built once and benefits everyone, even across different OS users and laptops with completely different filesystem layouts.

The value must match `[a-zA-Z0-9_-]+`; whitespace is trimmed, and a missing or empty value falls back to the path-hash default. The `SOCRATICODE_PROJECT_ID` env var, when set, takes precedence over this file — handy for ad-hoc per-machine overrides without touching the repo.

### Cross-Project Search (linked projects)

If you work across multiple related repositories or packages, you can search them all in a single query.

#### Configuration

Create a `.socraticode.json` file in your project root:

```json
{
  "linkedProjects": [
    "../shared-lib",
    "/absolute/path/to/other-project"
  ]
}
```

Or set the `SOCRATICODE_LINKED_PROJECTS` environment variable (comma-separated paths):

```bash
SOCRATICODE_LINKED_PROJECTS="../shared-lib,/absolute/path/to/other-project"
```

Both sources are merged and deduplicated. Relative paths are resolved from the project root. Non-existent paths are silently skipped.

#### Usage

Pass `includeLinked: true` to `codebase_search`:

> Search for "authentication middleware" with includeLinked: true

Results are ranked by **cosine similarity** against the query, not by each hit's position within its own project. A rank only means something inside the list it came from, so ranking on it let the top hit of a small project outrank a far stronger hit from a large one, and capped every cross-project score at `1/61 ≈ 0.016` — below the `SEARCH_MIN_SCORE` default of `0.10`, which then discarded everything. Cosine is an absolute measure against the same query vector, so it is comparable across projects and lands on the same scale the threshold expects. Single-project search is unaffected and still uses Qdrant's server-side RRF.

If a cosine cannot be computed for **every** hit, ranking falls back to the previous rank fusion for that whole query rather than mixing two different measures. That is detected in three cases, each logged with the collection involved: a chunk returned without a usable dense vector, a vector of zero magnitude, and a vector whose dimensionality differs from the query's. Note the limit of that last one: it catches a collection embedded with a model of a *different* dimensionality, but a different model producing the *same* dimensionality is indistinguishable here and would still be scored, so keep linked projects on one embedding model.

In the fallback, a single hit contributes at most `1/(60+0+1) ≈ 0.0164`, though a file matching as several chunks accumulates one contribution per chunk (`1/61 + 1/62 ≈ 0.0325`), so final scores can exceed that bound. Either way they sit far below the `0.10` default, so lower `minScore` for that query if you hit it.

Results are tagged with `[project-name]` labels showing which project each result came from. Deduplication is scoped to a single project: the same relative path in two different projects is kept as two separate results, because they are genuinely different files (your own `src/util.ts` and a linked project's are not interchangeable). Within one project, the higher-priority occurrence of a path wins.

> **Note:** Each linked project must be independently indexed (`codebase_index`) before it can be searched.

### Branch-Aware Indexing

By default, all branches of a project share the same index. When you switch branches, changed files are re-indexed by the watcher, and the index reflects the current branch state.

For workflows where you need **separate, persistent indexes per branch** — such as CI/CD pipelines or comparing code across branches — enable branch-aware mode:

```bash
SOCRATICODE_BRANCH_AWARE=true
```

With this enabled, collection names include the branch name (e.g. `codebase_abc123__main`, `codebase_abc123__feat_my-feature`). Each branch maintains its own independent index, code graph, and context artifacts.

> **Also requires a usable branch name.** Branch names are sanitized for use in
> collection names, so a branch made only of separators (e.g. `___`) reduces to
> an empty suffix and no per-branch collection is created. Where that happens,
> set a branch-specific `SOCRATICODE_PROJECT_ID` instead.

> **Only applies to path-derived project ids.** If the project pins an id — via
> `SOCRATICODE_PROJECT_ID` or `projectId` in `.socraticode.json` — that id is
> treated as a stable identity and is never given a branch suffix, so every
> branch continues to share one index. This is deliberate: suffixing an explicit
> id would change the collection names an existing installation already uses and
> make its indexes appear missing. SocratiCode logs a warning once per project
> when branch-aware mode is enabled but ignored for this reason. To get
> per-branch collections, remove the explicit id so the path-derived id can carry
> the suffix, or set a branch-specific `SOCRATICODE_PROJECT_ID` deliberately.

**When to use:**
- CI/CD pipelines that index each branch/PR separately
- Comparing search results across branches
- Keeping a pristine `main` index unaffected by feature branch changes

**When NOT to use:**
- Local development with frequent branch switching (default shared index is more efficient)
- Projects tracked via `SOCRATICODE_PROJECT_ID` (explicit IDs bypass branch detection)

> **How it works:** `projectIdFromPath()` detects the current git branch via `git rev-parse --abbrev-ref HEAD` and appends a sanitized branch suffix (e.g. `feat/my-feature` → `feat_my-feature`) to the hash-based project ID. Detached HEAD states fall back to the branchless ID.

### Available tools

Once connected, 21 tools are available to your AI assistant:

#### Indexing

| Tool | Description |
|------|-------------|
| `codebase_index` | Start indexing a codebase in the background (poll `codebase_status` for progress) |
| `codebase_stop` | Gracefully stop an in-progress indexing operation (current batch finishes and checkpoints; resume with `codebase_index`) |
| `codebase_update` | Incremental update — only re-indexes changed files |
| `codebase_remove` | Remove a project's index (safely stops watcher, cancels in-flight indexing/update, waits for graph build) |
| `codebase_watch` | Start/stop file watching — on start, catches up missed changes then watches for future ones |

#### Search

| Tool | Description |
|------|-------------|
| `codebase_search` | Hybrid semantic + keyword search (dense + BM25, RRF-fused) with optional file path, language filters, and cross-project search (`includeLinked`) |
| `codebase_status` | Check index status and chunk count |

#### Code Graph

| Tool | Description |
|------|-------------|
| `codebase_graph_build` | Build a polyglot dependency graph (runs in background — poll with `codebase_graph_status`) |
| `codebase_graph_query` | Query imports and dependents for a specific file |
| `codebase_graph_stats` | Get graph statistics (most connected files, orphans, language breakdown) |
| `codebase_graph_circular` | Detect circular dependencies |
| `codebase_graph_visualize` | Generate a Mermaid diagram (`mode=mermaid`, default) or an interactive HTML explorer (`mode=interactive`) of the dependency graph. Interactive mode writes a self-contained page (vendored Cytoscape.js + Dagre, works offline) and opens it in your default browser — file + symbol views, blast-radius overlay, live search, PNG export. |
| `codebase_graph_status` | Check graph build progress or persisted graph metadata (advises when few captured imports resolved, so a near-empty graph is not read as a healthy one, and names the version that built the graph so one left behind by an upgrade is not read as a resolver bug) |
| `codebase_graph_remove` | Remove a project's persisted code graph (waits for in-flight graph build to finish first) |

#### Impact Analysis (symbol-level call graph)

A second graph layer goes one step deeper than file imports — it tracks which functions
and methods call which. Use these tools BEFORE refactoring, renaming, or deleting code.

| Tool | Description |
|------|-------------|
| `codebase_impact` | Blast radius — what files break if you change file/function X (BFS through reverse-call edges) |
| `codebase_flow` | Trace forward execution flow from an entry point. Call with no args to discover entry points (orphans, `main()`, framework routes, tests) |
| `codebase_symbol` | 360° view of one symbol — its definition, callers, and callees |
| `codebase_symbols` | List symbols in a file or search by name across the project |

> **Accepted limits.** The call graph is static-analysis-based — no type inference. Dynamic dispatch (`getattr`, `obj[key](...)`, reflection, `eval`), unexpanded macros, and framework magic (Spring `@Autowired`, Angular DI, Rails `has_many`, decorator-driven routing) are invisible. Callers that reach a method only through these mechanisms will not appear in `codebase_impact`. Treat "zero callers" as a hint to double-check on DI-heavy codebases. `codebase_graph_status` reports `unresolvedEdgePct` as a quality signal. See [DEVELOPER.md § Impact Analysis](DEVELOPER.md) for the full list.

#### Interactive graph explorer

Ask your AI *"show me an interactive graph of this project"* (or invoke `codebase_graph_visualize` with `mode: "interactive"`) and SocratiCode generates a self-contained HTML page and opens it in your default browser:

- **File view** — every source file as a node, imports as edges, language-coloured, circular deps in red.
- **Symbol view** — toggle to see functions/classes/methods as nodes with call edges (available when the symbol graph fits within the embed cap; above that threshold the file view remains and the banner points at `codebase_impact` for symbol-level queries).
- **Sidebar** — click a node to see imports / dependents / symbols-in-file / line numbers, with action buttons for blast radius and call flow.
- **Right-click any node** → highlights its reverse-transitive closure (who breaks if this changes).
- **Live search** filters and centres matching nodes. **Layout switcher** — Dagre / force-directed / concentric / breadth-first / grid / circle. **Export PNG** produces a shareable image.
- **Offline-safe** — Cytoscape.js + Dagre are vendored inside the SocratiCode package. No CDN, no network, works in air-gapped environments.

The output is a single HTML file (written to the OS temp dir, one per project) that you can also commit to a PR or share on Slack.

#### Management

| Tool | Description |
|------|-------------|
| `codebase_health` | Check Docker, Qdrant, and embedding provider status |
| `codebase_list_projects` | List all indexed projects with paths and metadata |
| `codebase_about` | Display info about SocratiCode |

#### Context Artifacts

| Tool | Description |
|------|-------------|
| `codebase_context` | List all context artifacts defined in `.socraticodecontextartifacts.json` with names, descriptions, and index status |
| `codebase_context_search` | Semantic search across context artifacts (auto-indexes on first use, auto-detects staleness) |
| `codebase_context_index` | Index or re-index all artifacts from `.socraticodecontextartifacts.json` |
| `codebase_context_remove` | Remove all indexed context artifacts for a project (blocked while indexing is in progress) |

## Language Support

SocratiCode supports languages at three levels:

### Full Support (indexing + code graph + AST chunking)

JavaScript, TypeScript, TSX, Python, Java, Kotlin, Scala, C, C++, C#, Go, Rust, Ruby, PHP, Swift, Dart, Elixir (including HEEx/EEx), Bash/Shell, HTML, CSS/SCSS, Svelte, Vue

### Conditional AST Support

GDScript: `.gd` files use an optional native binary (`tree-sitter-gdscript`) for AST chunking, symbol extraction, and call-site resolution. When the native parser is unavailable, a syntax-aware fallback handles import extraction and line-based chunking without creating edges from comments or strings. `class_name` declarations, `extends`/`preload`/`load` imports, and `res://` paths are resolved. Relative `extends` and `preload` paths use the script directory; relative runtime `load` paths use the Godot project root. Per-file `project.godot` discovery supports nested and sibling Godot projects. Godot scenes and resources (`.tscn`/`.tres`) are indexed with line-based chunking. `[ext_resource]` declarations are extracted as dependency edges via a tokenizer that handles arbitrary whitespace, attribute order, escaped quotes, and both `uid="uid://..."` and `path="..."` attributes. When both are present, the UID takes priority. Both `res://` paths and paths relative to the `.tscn`/`.tres` file are supported, per the [TSCN documentation](https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html). `res://` paths resolve to `.gd`, `.tscn`, and `.tres` targets in the code graph.

Svelte and Vue: imports extracted from `<script>` blocks (re-parsed as TypeScript) and CSS `@import`/`@require` from `<style>` blocks (any combination of `lang`, `scoped`, `module`, `global` attributes). Path aliases from `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` are resolved (including `extends` chains). SCSS partial resolution (`_` prefix convention) is supported.

Python: absolute imports resolve through the import roots implied by the project's `pyproject.toml` files — root and nested, so uv workspaces get cross-package edges — covering both the `src/` layout (`packages/<dist>/src/<module>/…`, what `uv init --lib`, hatchling and setuptools generate) and the flat layout beside each manifest, including PEP 420 namespace packages and single-module distributions. A manifest applies to a file only when it sits on that file's ancestor path or an ancestor manifest declares it a `[tool.uv.workspace]` member, so a sample app, docs project or checked-in sdist carrying its own manifest does not become an import root for unrelated code; only `[tool.uv.workspace]` is read, so poetry, pdm and hatch path-dependency monorepos get ancestor-path scoping and no cross-package edges; applicable roots are tried nearest first, so a package resolves its own modules before a sibling's. Relative imports and the project-root `src/`/`lib/` and sibling-flat conventions are unchanged — the sibling-flat fallback still takes precedence over these roots, matching CPython, which puts the script's own directory at `sys.path[0]`.

PHP: `use` imports resolve through the PSR-4 prefixes declared in the project's `composer.json` files — root and nested, so a Composer monorepo's path packages get cross-package edges. Where no prefix matches, they resolve against the `namespace` and class/interface/trait/enum declarations found in the project itself, which is what reaches a package that ships `"autoload": {}` and registers its namespaces at run time (`$loader->addNamespace(...)`, the WordPress-plugin norm) — no `spl_autoload_register` interpretation involved. Comma lists (`use A\B, A\C;`), groups (`use A\{B, C};`, including per-member `function`/`const` modifiers) and fully-qualified names (`use \A\B;`) are all read. `require`/`include` resolve relative paths, bare paths (source directory first, then the project root), and `__DIR__ . '<literal>'` / `dirname(__FILE__) . '<literal>'`, the dominant include idiom outside Composer. They are read from the include expressions themselves, so they are found in any position — `return require __DIR__ . '/routes.php';` and `$config = include 'config.php';` count, while an `include` mentioned in a comment or quoted inside a string does not. An include joined to a run-time value (`ABSPATH . '/x.php'`, `$base . '/x.php'`) stays unresolved rather than guessed.

Dart: symbols (classes, mixins, enums, extensions, typedefs, functions, getters, setters, operators, constructors including named and factory, and abstract/bodyless members), call sites (method calls, cascades, constructor invocations), `main()` entry-point detection, and AST chunking are all tree-sitter based; import/export/part edges are extracted via regex. Intra-project `package:` imports (the Flutter convention) resolve through the project's `pubspec.yaml` files — root and nested, so pub-workspace/melos monorepos get cross-package edges — via pub's `package:<name>/<rest>` → `<package_root>/lib/<rest>` mapping; `dart:` and unknown package names stay external. The bundled grammar (`@ast-grep/lang-dart`) predates Dart 3 class modifiers (`sealed`/`base`/`interface`/`final`/`mixin class`) and `extension type`: declarations using those are skipped (with a one-time warning logged) until the upstream grammar is updated, while the rest of each file still indexes normally.

Elixir: `.ex` and `.exs` files use the ast-grep grammar for chunking. `alias`, `import`, `require`, and `use` directives resolve to in-project `defmodule` declarations; fully qualified calls without one of those directives remain unresolved. `defmodule`, `def`, `defp`, and ordinary calls produce symbols and call edges. Chunking is module-level, with large modules falling back to line windows rather than per-function chunks. `defprotocol`, `defimpl`, `defguard`, `defmacro`, and `defdelegate` declarations do not register symbols yet; protocol and implementation scopes are not represented, so functions inside them appear as top-level symbols. Standalone `.heex` and `.eex` templates use dedicated tree-sitter grammars for AST chunking, remote-component dependencies, and calls from embedded Elixir expressions; markup and comments are never parsed as Elixir. `.leex` uses the EEx grammar on a best-effort basis, safely falling back to line chunks and no extracted edges when parsing fails.

### Code Graph via Regex + Indexing

Lua (require/dofile/loadfile), SASS, LESS, Stylus (CSS `@import`/`@require` extraction)

### Indexing Only (hybrid search, line-based chunking)

JSON, YAML, TOML, XML, INI/CFG, Markdown/MDX, RST, SQL, R, Dockerfile, TXT, and any file matching a supported extension or special filename (Dockerfile, Makefile, Gemfile, Rakefile, etc.)

**63 file extensions** + 8 special filenames supported out of the box.

Extensionless files (Unix scripts, health probes, sourced libraries) are also indexed via content-based language detection when `INDEX_EXTENSIONLESS` is enabled (the default) — see that environment variable below.

## Ignore Rules

The indexer combines three layers of ignore rules:

1. **Built-in defaults** — `node_modules`, `.git`, `dist`, `build`, lock files, IDE folders, etc.
2. **`.gitignore`** — All `.gitignore` files in the project (root and nested subdirectories). Set `RESPECT_GITIGNORE=false` to skip `.gitignore` processing entirely.
3. **`.socraticodeignore`** — Optional file for indexer-specific exclusions. Same syntax as `.gitignore`.

All three layers also apply to a [context artifact](#context-artifacts) that points at a **directory**, but they are resolved **relative to the artifact directory**, not the project root. A project-root `.gitignore` or `.socraticodeignore` governs the code index and does **not** reach a directory artifact. What applies to a directory artifact is the built-in defaults, the `.gitignore` at the artifact root and any nested `.gitignore` files, and a `.socraticodeignore` only at the artifact root. Nested `.socraticodeignore` files are not read. To exclude something from a directory artifact, put the pattern in one of those applicable files.

Note that a directory artifact inherits the built-in defaults **in full**, not just the build-output ones. Beyond `__pycache__`, `*.pyc`, `dist` and `build`, that list also covers names an artifact directory might legitimately use: `env`, `vendor`, `target`, `out`, `coverage`, `*.map`, `*.log`. If a directory artifact needs one of those, re-include it with a `!` pattern in the `.socraticodeignore` at the artifact root, negating the **name itself** (`!env`). Gitignore semantics cannot re-include a file whose parent directory is excluded, so `!env/**` on its own does nothing. `target` has one additional constraint: its contents can be re-included, but `target/` is skipped while discovering nested `.gitignore` files, so rules from `target/.gitignore` are not loaded. Put those rules in the `.gitignore` or `.socraticodeignore` at the artifact root instead. Files dropped by the ignore rules, by the binary check, or because they could not be read are counted in that artifact's log line when it is indexed. `node_modules`, `.git` and dot-files are pruned before the walk sees them, so they appear in no count.

## Context Artifacts

Give the AI awareness of project knowledge beyond source code — database schemas, API specs, infrastructure configs, architecture docs, and more.

### Setup

Create a `.socraticodecontextartifacts.json` file in your project root (see [`.socraticodecontextartifacts.json.example`](.socraticodecontextartifacts.json.example) for a starter template):

```json
{
  "artifacts": [
    {
      "name": "database-schema",
      "path": "./docs/schema.sql",
      "description": "Complete PostgreSQL schema — all tables, indexes, constraints, foreign keys. Use to understand what data the app stores and how tables relate."
    },
    {
      "name": "api-spec",
      "path": "./docs/openapi.yaml",
      "description": "OpenAPI 3.0 spec for the REST API. All endpoints, request/response schemas, auth requirements."
    },
    {
      "name": "k8s-manifests",
      "path": "./deploy/k8s/",
      "description": "Kubernetes deployment manifests. Shows how services are deployed, scaled, and networked."
    }
  ]
}
```

Each artifact has:
- **`name`** — Unique identifier (used to filter searches)
- **`path`** — Path to a file or directory (relative to project root, or absolute). Directories are read recursively, excluding: dot-files and dot-directories (`.pytest_cache/`, `.tox/`); anything matched by the [ignore rules](#ignore-rules) resolved against the artifact directory; and binary files, detected by a NUL byte in the first 8 KiB. Excluded files are logged with a per-directory summary count. A path pointing at a **single file** is read verbatim — no exclusions apply, so a declared binary file is still indexed.
- **`description`** — Tells the AI what this artifact is and how to use it

### How it works

Artifacts are chunked and embedded into Qdrant using the same hybrid dense + BM25 search as code. On first search, artifacts are auto-indexed. On subsequent searches, staleness is auto-detected via content hashing — changed files are re-indexed transparently.

Because exclusions are applied before the content hash is computed, build output under an artifact directory no longer marks that artifact stale. A directory artifact indexed by an earlier version re-indexes on its next hash check **if the walk previously embedded files that are now excluded** — expect its chunk count to **drop** when it does. An artifact with nothing to exclude hashes identically and is left alone.

### Usage

1. **Discover**: `codebase_context` — lists all defined artifacts and their index status
2. **Search**: `codebase_context_search` — semantic search across all artifacts (or filter by name)
3. **Re-index**: `codebase_context_index` — force re-index (usually not needed, auto-indexing handles it)
4. **Clean up**: `codebase_context_remove` — remove all indexed artifacts

### Why this matters: real workflow examples

Without artifacts, the agent only sees source code. With artifacts, it has the full picture and writes code that fits your project from the start.

**Database schema** — You ask *"add a last_login timestamp to users."* The agent runs `codebase_context_search` for "users table", finds the schema uses `snake_case` columns and every table has an `updated_at` with a trigger. The migration it writes matches existing conventions instead of guessing.

```json
{
  "name": "database-schema",
  "path": "./docs/schema.sql",
  "description": "Complete PostgreSQL schema — all tables, columns, types, constraints, indexes, and triggers. Check this before writing migrations to match naming conventions and existing patterns."
}
```

**API spec** — You ask *"add a GET endpoint for user preferences."* The agent searches the OpenAPI spec, sees all endpoints use Bearer auth, return `{ data, meta }` wrappers, and paginate with `cursor`/`limit`. The new endpoint follows the same patterns automatically.

```json
{
  "name": "api-spec",
  "path": "./docs/openapi.yaml",
  "description": "OpenAPI 3.0 spec for the REST API — all endpoints, request/response schemas, auth, pagination. Check this before adding or modifying endpoints to match existing conventions."
}
```

**Domain glossary (DDD)** — You ask *"add a way to cancel an order."* The agent searches your domain glossary, finds that cancellation is modeled as an `OrderVoided` event (not "cancelled"), that only orders in `Confirmed` status can be voided, and that the `Fulfillment` bounded context must be notified. The implementation uses the correct domain terms and integrates with the right bounded contexts.

```json
{
  "artifacts": [
    {
      "name": "ubiquitous-language",
      "path": "./docs/ubiquitous-language.md",
      "description": "Domain glossary — bounded context terms, their definitions, and relationships. Always check this before naming entities, events, or commands to use the correct domain language."
    },
    {
      "name": "context-map",
      "path": "./docs/context-mapping.md",
      "description": "Bounded context map — context boundaries, relationships (shared kernel, customer-supplier, etc.), and integration patterns. Check before implementing cross-context communication."
    },
    {
      "name": "event-storming",
      "path": "./docs/event-storming/",
      "description": "Event storming output — domain events, commands, aggregates, policies, and read models. Check before adding new domain behaviour to see how it fits the existing event flows."
    }
  ]
}
```

> **The `description` field is the key lever.** It tells the AI not just *what* the artifact is, but *when to consult it*. Write descriptions that say "check this before doing X" so the agent reaches for the artifact at the right moment.

### Example artifacts

| Category | Examples |
|----------|----------|
| **Database** | SQL schema dumps (`pg_dump --schema-only`), Prisma schemas, Rails `schema.rb`, Django model dumps, migration files |
| **API Contracts** | OpenAPI/Swagger specs, GraphQL schemas, Protobuf definitions, AsyncAPI specs (Kafka, RabbitMQ) |
| **Infrastructure** | Terraform/Pulumi configs, Kubernetes manifests, Docker Compose files, CI/CD pipeline configs |
| **Architecture** | Architecture Decision Records (ADRs), service topology docs, data flow diagrams, domain glossaries |
| **Operations** | Monitoring/alerting rules, RBAC/permission matrices, auth flow documentation, feature flag configs |
| **External** | Third-party API docs, compliance requirements (SOC2, HIPAA, GDPR), SLA definitions |

> **Tip**: For database schemas, every major database can export its entire schema to a single file: `pg_dump --schema-only` (PostgreSQL), `mysqldump --no-data` (MySQL), `sqlite3 db.sqlite .schema` (SQLite). ORM schemas (Prisma, Rails, Django) are often already in your repo.

## Environment Variables

SocratiCode reads configuration from environment variables when the MCP server starts. The key name and file format depend on the MCP host, and a plugin-bundled server does not necessarily inherit the configuration used by a directly registered server. After changing variables, restart or reconnect the server and start a new host session. If variables appear to be ignored, check the host's documented schema and installation scope first.

Operational settings apply to the new process. Settings that define stored vectors, chunks, paths, or other indexed representation follow [Effective Index Profiles](#effective-index-profiles): a changed value is reported as pending for an existing collection, which remains usable and is never automatically rebuilt or partially rewritten. Remove and freshly index a collection only when you deliberately want the changed representation to take effect.

### Passing env vars by host

| Host | Config file | Env-var syntax |
|------|-------------|---------|
| Claude Code native plugin | `~/.claude/settings.json` | Top-level `"env": { "KEY": "value" }` |
| Claude Code MCP-only | User or project MCP configuration | `claude mcp add --env KEY=value ...` or an `env` object in the stored server definition |
| Claude Desktop, Windsurf, Cline, and Roo Code | Host MCP JSON | `"env": { "KEY": "value" }` inside the server definition |
| OpenAI Codex native plugin | `~/.codex/config.toml` | [Disable its bundled server and add one top-level configured server](#openai-codex-plugin) |
| OpenAI Codex MCP-only | `~/.codex/config.toml` | `codex mcp add --env KEY=value`, inline TOML `env = { ... }`, or `[mcp_servers.NAME.env]` |
| VS Code Agent Plugin | VS Code MCP server state plus user MCP configuration | [Keep the plugin, disable its bundled server, and add a direct server](#vs-code-agent-plugin) using `env` or `envFile` |
| VS Code direct MCP | `.vscode/mcp.json` or user MCP configuration | `"env": { "KEY": "value" }` inside the `servers` entry |
| VS Code editor extension | VS Code settings | `"socraticode.env": { "KEY": "value" }` |
| Cursor local plugin | Cursor **Customize** plus direct MCP configuration | [Keep the plugin, disable its bundled server, and add a direct server](#cursor) using `env` |
| Cursor direct MCP | User or project `mcp.json` | `"env": { "KEY": "value" }` inside the server definition |
| Continue | YAML config | `env:` map inside the `mcpServers` list item |
| Zed | `context_servers` JSON | `"env": { "KEY": "value" }` |
| Gemini CLI extension override | `~/.gemini/settings.json` or `.gemini/settings.json` | Explicit `"env"` entries; the extension does not inherit every process variable |
| OpenCode 1.x / V2 | `opencode.json` / `opencode.jsonc` ([schema](https://opencode.ai/config.json)) | `"environment": { "KEY": "value" }`, not `"env"`; V2 nests the server under `mcp.servers` |

Worked examples with a few env vars set:

**MCP JSON hosts** such as Claude Desktop, Windsurf, Cline, Roo Code, and Cursor:

```json
{
  "mcpServers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "socraticode@latest"],
      "env": {
        "QDRANT_MODE": "external",
        "QDRANT_URL": "https://xyz.qdrant.io"
      }
    }
  }
}
```

**OpenCode** — note `environment`, not `env`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "socraticode": {
      "type": "local",
      "command": ["npx", "-y", "--prefer-online", "socraticode@latest"],
      "enabled": true,
      "environment": {
        "QDRANT_MODE": "external",
        "QDRANT_URL": "https://xyz.qdrant.io"
      }
    }
  }
}
```

**OpenAI Codex CLI** with the nested-table form:

```toml
[mcp_servers.socraticode]
command = "npx"
args = ["-y", "--prefer-online", "socraticode@latest"]

[mcp_servers.socraticode.env]
QDRANT_MODE = "external"
QDRANT_URL = "https://xyz.qdrant.io"
```

The equivalent CLI form is `codex mcp add socraticode --env QDRANT_MODE=external --env QDRANT_URL=https://xyz.qdrant.io -- npx -y --prefer-online socraticode@latest`. Inline `env = { ... }` is also valid TOML.

The rest of this section documents the variables themselves. Pass them using whichever syntax matches your host.

### Effective Index Profiles

Code and context collections persist the settings that define their stored representation. Existing collections continue using that effective profile for indexing, watcher updates, and search. Search and status resolve an unprofiled legacy collection without writing metadata; the next indexing or update operation persists the resolved profile before changing vectors. A changed embedding provider, model, dimension, context length, query or document prefix, path-inclusion setting, chunk cap, extension-language map, file-size cap, or LiteLLM dimensions flag is reported by `codebase_status` as pending and does not partially change the collection. Remove the collection with `codebase_remove`, then run `codebase_index` to activate the requested profile in a fresh index. Legacy collections remain usable with the released defaults for newly introduced settings; historically unavailable values are marked `legacy-unverified`.

### Embedding Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | `ollama` | Embedding backend: `ollama` (local, default), `openai`, `google`, `lmstudio`, or `litellm` |
| `EMBEDDING_MODEL` | *(per provider)* | Model name. Defaults: `nomic-embed-text` (ollama), `text-embedding-3-small` (openai), `gemini-embedding-001` (google). **Required** for `lmstudio` and `litellm` (no default). |
| `EMBEDDING_DIMENSIONS` | *(per provider)* | Vector dimensions. Defaults: `768` (ollama), `1536` (openai), `3072` (google). **Required** for `lmstudio` and `litellm` (no default; varies per loaded model / proxy alias). |
| `EMBEDDING_CONTEXT_LENGTH` | *(auto-detected)* | Model context window in tokens. Auto-detected for known model names (works for LiteLLM aliases that match the underlying model name). Set manually for custom LM Studio models or arbitrary LiteLLM aliases. |
| `EMBEDDING_QUERY_PREFIX` | `"search_query: "` | Task prefix prepended to queries before embedding. Match it to your model: `"query: "` for `multilingual-e5-*`, `"検索クエリ: "` for `cl-nagoya/ruri-v3-*`, and an empty string for `bge-m3` (which expects no prefix). Set to `""` to disable. Leaving the variable out and setting it to an empty value are not the same: unset keeps the default, while nothing after the `=` means no prefix at all. |
| `EMBEDDING_DOCUMENT_PREFIX` | `"search_document: "` | Task prefix prepended to documents before embedding. Counterparts: `"passage: "` for `multilingual-e5-*`, `"検索文書: "` for `cl-nagoya/ruri-v3-*`, empty for `bge-m3`. Set to `""` to disable, with the same unset-versus-empty distinction as above. Must be changed together with `EMBEDDING_QUERY_PREFIX`. Existing collections keep their effective prefix; remove and freshly index the collection to activate a changed value. |
| `EMBEDDING_DOCUMENT_INCLUDE_PATH` | `true` | Whether the file path is embedded with the chunk, between `EMBEDDING_DOCUMENT_PREFIX` and the content. Accepts `true` / `1` / `yes` and `false` / `0` / `no`, case-insensitively and ignoring surrounding whitespace; leaving it empty is the same as leaving it unset, and any other value is rejected with an error naming it. Path tokens help path-shaped queries but add noise on prose-heavy corpora. Set to `false` to embed the document prefix and the chunk content only, with no separator between them other than whatever the prefix itself ends in. The same text feeds the dense embedding **and** the BM25 lexical index, so path-derived tokens stop matching in keyword search too, and for context artifacts the `context:<name>:<path>` identifier is dropped along with the path. Existing collections keep their effective path setting; remove and freshly index the collection to activate a changed value. |

### Ollama Configuration (when `EMBEDDING_PROVIDER=ollama`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_MODE` | `auto` | `auto` = use native Ollama on port 11434 if available, otherwise manage a Docker container (recommended). `docker` = always use managed Docker container on port 11435. `external` = user-managed Ollama instance (native, remote, etc.) |
| `OLLAMA_URL` | `http://localhost:11434` (auto/external) / `http://localhost:11435` (docker) | Full Ollama API endpoint |
| `OLLAMA_PORT` | `11435` | Ollama container port (Docker mode). Ignored when `OLLAMA_URL` is set explicitly. |
| `OLLAMA_HOST` | `http://localhost:{OLLAMA_PORT}` | Ollama base URL (alternative to `OLLAMA_URL`) |
| `OLLAMA_API_KEY` | *(none)* | Optional API key for authenticated Ollama proxies |

### Cloud Provider API Keys

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(none)* | Required when `EMBEDDING_PROVIDER=openai`. Get from [platform.openai.com](https://platform.openai.com/api-keys) |
| `GOOGLE_API_KEY` | *(none)* | Required when `EMBEDDING_PROVIDER=google`. Get from [aistudio.google.com](https://aistudio.google.com/apikey) |

### LM Studio Configuration (when `EMBEDDING_PROVIDER=lmstudio`)

| Variable | Default | Description |
|----------|---------|-------------|
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | Full base URL of LM Studio's OpenAI-compatible Local Server. Override when the server runs on a non-default port or a remote machine (e.g. `http://gpu-rig.local:5678/v1`). Must include the `/v1` suffix. |
| `LMSTUDIO_API_KEY` | *(none)* | Optional. LM Studio's Local Server has no auth by default; set this only if you've enabled API key auth in the LM Studio UI. |
| `LMSTUDIO_ALLOW_MISSING_MODEL_LISTING` | `false` | Accept an OpenAI-compatible server that has no `/v1/models` endpoint. Single-model servers such as HuggingFace Text Embeddings Inference (TEI) fix the model at startup and return 404 for the listing, while `/v1/embeddings` works normally. When enabled (`true` / `1` / `yes`), readiness and health checks fall back to probing `/v1/embeddings` with one throwaway input, and the probe's vector width is checked against `EMBEDDING_DIMENSIONS`. Only a 404 or 405 from the listing triggers the fallback — a refused connection, a 401, or a 5xx still reports the LM Studio diagnostics. Accepts `false` / `0` / `no` as well; any other non-empty value is rejected at startup rather than silently read as `false`. |

### LiteLLM Configuration (when `EMBEDDING_PROVIDER=litellm`)

| Variable | Default | Description |
|----------|---------|-------------|
| `LITELLM_URL` | `http://localhost:4000/v1` | Full base URL of the LiteLLM proxy's OpenAI-compatible endpoint. Override for non-default ports or remote proxies (e.g. `https://litellm.internal:4001/v1`). Must include the `/v1` suffix — LiteLLM exposes `/v1/embeddings` under that prefix. |
| `LITELLM_API_KEY` | *(none)* | **Required.** Master key (`general_settings.master_key` in the proxy's `config.yaml`) or a virtual key issued via LiteLLM's `/key/generate` endpoint. Unlike LM Studio, LiteLLM always authenticates — `/v1/models` itself is gated. |
| `LITELLM_SEND_DIMENSIONS` | `false` | Opt-in (`true` / `1` / `yes`). Forwards the OpenAI-style `dimensions` parameter through the proxy. Safe only for Matryoshka-aware backends (`text-embedding-3-*`, `voyage-3`); other backends (BGE, `nomic-embed-text`, Cohere v3) reject the request. Leave unset unless you know your alias resolves to a Matryoshka model. |

### Qdrant Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_MODE` | `managed` | `managed` = Docker-managed local Qdrant (default). `external` = user-provided remote or cloud Qdrant (no Docker management). |
| `QDRANT_URL` | *(none)* | Full URL of a remote/cloud Qdrant instance (e.g. `https://xyz.aws.cloud.qdrant.io:6333`). When set, takes precedence over `QDRANT_HOST` + `QDRANT_PORT`. Port is auto-inferred from the URL: explicit port if present (e.g. `:8443`), otherwise `443` for `https://` or `6333` for `http://`. Required (or set `QDRANT_HOST`) when `QDRANT_MODE=external`. |
| `QDRANT_PORT` | `16333` | Qdrant REST API port (managed mode, or external without `QDRANT_URL`) |
| `QDRANT_GRPC_PORT` | `16334` | Qdrant gRPC port (managed mode only) |
| `QDRANT_HOST` | `localhost` | Qdrant hostname (alternative to `QDRANT_URL` for non-HTTPS external instances) |
| `QDRANT_API_KEY` | *(none)* | Qdrant API key (required for Qdrant Cloud and other authenticated deployments). When set, the URL must be `https://...` so the key is not transmitted over plain HTTP. Loopback URLs (`localhost`, `127.0.0.1`, `[::1]`) are accepted on `http://` for local development. |
| `QDRANT_COLLECTION_PREFIX` | *(empty)* | Optional prefix prepended to every Qdrant collection name SocratiCode creates. Useful when sharing one Qdrant instance with other applications (Open-WebUI, custom RAG, etc.) or running multiple SocratiCode instances against one Qdrant for separation between projects, environments, or per-user indexes. Default empty string keeps collection names unchanged from previous releases (fully backwards compatible). Must match `[a-zA-Z0-9_-]+` if set; an invalid prefix throws at startup. Changing the prefix between runs orphans the previous collections; use `codebase_remove` first if you need to migrate. |

### Indexing Behaviour

| Variable | Default | Description |
|----------|---------|-------------|
| `RESPECT_GITIGNORE` | `true` | Set to `false` to skip `.gitignore` processing. Built-in defaults and `.socraticodeignore` still apply. |
| `INCLUDE_DOT_FILES` | `false` | Set to `true` to include dot-directories (e.g. `.agent`, `.config`) in indexing. By default, directories and files starting with `.` are excluded. Useful for projects where important code lives in dot-directories. |
| `EXTRA_EXTENSIONS` | *(none)* | Comma-separated list of additional file extensions to scan (e.g. `.tpl,.blade,.hbs`). Applies to both indexing and code graph. Files with extra extensions are indexed as plaintext and appear as leaf nodes in the code graph. Can also be passed per-operation via the `extraExtensions` tool parameter. |
| `EXTENSION_LANGUAGE_MAP` | *(none)* | Comma-separated `extension:language` overrides that make a non-standard extension be treated as a real language end to end (semantic/AST chunking, symbols, call graph), e.g. `EXTENSION_LANGUAGE_MAP=.inc:php,.module:php` for Drupal/PHP. Unlike `EXTRA_EXTENSIONS` (which indexes as plaintext), the mapped extension gets the full language treatment and is auto-discovered without also listing it in `EXTRA_EXTENSIONS`. The target must be a language SocratiCode has an AST grammar for (the Full Support list above plus the AST-graph languages); unknown targets are ignored with a startup warning. Overrides built-in mappings too (e.g. `.h:cpp`). Existing code collections keep their effective map until freshly indexed. |
| `INDEX_EXTENSIONLESS` | `true` | When enabled (default), files with **no extension** are indexed when their content identifies them as code — a shebang (`#!/bin/bash`, `#!/usr/bin/env python3`, …) or a conservative content sniff (no-shebang Python/shell). A shebang with an unmapped interpreter (perl, awk, make, …) is indexed as searchable plaintext. Binaries (NUL byte in the head) and undetectable text (configs, licenses, data) are never indexed. The real on-disk path is always preserved — only the detected language/grammar is inferred, so `.txt`-detected files stay out of the code graph. Set `false` or `0` to restore the previous behavior (extensionless files indexed only when their exact name is a special file such as `Dockerfile`/`Makefile`). **Writer-consistency:** every process writing to one collection must agree on this flag — a mixed fleet would flap extensionless chunks on alternating runs. |
| `MAX_FILE_SIZE_MB` | `5` | Maximum file size in MB. The value must be a complete finite number; malformed partial values such as `5MB` are rejected. Files larger than this are skipped during indexing. Increase for repos with large generated or data files you want indexed. Existing code collections keep their effective limit until freshly indexed. A file that grows beyond the effective limit has its old chunks removed. |
| `MAX_CHUNK_CHARS` | `2000` | Character cap per chunk. On a collection indexed as format 2, chunks that exceed it are split instead of truncated: chunking cuts by line count (100 lines), so a chunk can exceed a cap counted in characters, and when it does the overflow becomes further chunks rather than being dropped. Ordinary chunks end at the last newline at or before the cap when one is available. Minified or bundled code also considers the released chunker's space, tab, semicolon and comma boundaries, avoiding a split inside an identifier where possible. With no eligible boundary, the piece ends at the cap. A boundary may move by one UTF-16 code unit to keep a surrogate pair or CRLF intact, so a cap of `1` can produce a 2-code-unit piece. Nothing is dropped except a piece holding only whitespace. **A collection indexed before format 2 keeps truncating** — content past the cap is dropped before the chunk is stored, so it reaches neither the vector, nor the payload, nor the keyword (BM25) text. Such an index remains operational with its stored, potentially truncated coverage; `codebase_remove` followed by `codebase_index` adopts format 2 and recovers the omitted content, and is optional. Lower this cap to match an embedding model whose context is smaller than the default assumes. Raising it above the model's context length × the provider's chars-per-token estimate does not put more content into any one embedding: the provider pre-truncates, so the extra characters reach the stored payload and the keyword (BM25) text but are not represented in the vector. Existing code and context collections keep their effective cap until freshly indexed. |
| `SEARCH_DEFAULT_LIMIT` | `10` | Default number of results returned by `codebase_search` (1-50). Each result is a ranked code chunk with file path, line range, and content. Higher values give broader coverage but produce more output. Can still be overridden per-query via the `limit` tool parameter. |
| `SEARCH_MIN_SCORE` | `0.10` | Minimum score threshold (0-1). Results below this score are filtered out. Helps remove low-relevance noise from search results. Set to `0` to disable filtering (returns all results up to `limit`). Can be overridden per-query via the `minScore` tool parameter. Works together with `limit`: results are first filtered by score, then capped at `limit`. The score is an RRF (Reciprocal Rank Fusion) value for a single-project search, and a cosine similarity for a cross-project one (`includeLinked: true`), which falls back to RRF when a cosine is unavailable for any hit — see Cross-Project Search below for why the scales differ and what that means for this threshold. |
| `SOCRATICODE_PROJECT_ID` | *(none)* | Override the auto-generated project ID. When set, all paths resolve to the same Qdrant collections, allowing multiple directories (e.g. git worktrees of the same repo) to share a single index. Must match `[a-zA-Z0-9_-]+`. Takes precedence over the `projectId` field in `.socraticode.json`. |
| `SOCRATICODE_BRANCH_AWARE` | `false` | When `true`, append the current git branch name to the project ID, creating separate Qdrant collections per branch. Ignored when `SOCRATICODE_PROJECT_ID` is set or when `projectId` is set in `.socraticode.json`. |
| `SOCRATICODE_LINKED_PROJECTS` | *(none)* | Comma-separated list of additional project paths to include in cross-project search. Merged with paths from `.socraticode.json`. Non-existent paths are silently skipped. |
| `SOCRATICODE_WATCHER` | `auto` | File-watcher policy, case-insensitive: `auto` preserves the default auto-start paths; `manual` suppresses every automatic start but permits `codebase_watch { action: "start" }`; `off` also rejects explicit starts. In `manual` and `off`, graph query tools read an existing graph but do not create a missing one. Invalid values fail at startup. This is process-local, so configure every MCP process that shares the checkout and index. No re-index is required. |
| `SOCRATICODE_AUTO_RESUME` | *(none)* | Startup policy: unset keeps the existing current-project catch-up/recovery behavior; `all` resumes every indexed project that has a stored path, sequentially; `off` skips all startup catch-up updates and interrupted-index recovery before any Docker or Qdrant access. `off` takes precedence over `SOCRATICODE_AUTO_RESUME_PROJECTS`. This does not disable watcher starts caused by later tool use; combine it with `SOCRATICODE_WATCHER=off` for a deliberate snapshot. |
| `SOCRATICODE_AUTO_RESUME_PROJECTS` | *(none)* | Comma-separated list of project paths to auto-resume on server startup (sequentially), e.g. `/repos/api,/repos/web`. Takes precedence over the unset/`all` behavior, but not over `SOCRATICODE_AUTO_RESUME=off`. Paths that do not exist or are not indexed are skipped with a warning. |
| `SOCRATICODE_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SOCRATICODE_LOG_FILE` | *(none)* | Absolute path to a log file. When set, all log entries are appended to this file (a session separator is written on each server start). Useful for debugging when the MCP host doesn't surface log notifications. |

> **Important**: Existing collections keep their stored effective provider, model, and dimensions when runtime settings change. `codebase_status` reports requested differences as pending. To activate them, remove the collection with `codebase_remove`, then create a fresh index with `codebase_index`. This explicit rebuild is required for activation, not for continued use of the existing index.

## Docker Resources

SocratiCode manages Docker containers and persistent volumes:

| Resource | Name | Purpose | When |
|----------|------|---------|------|
| Container | `socraticode-qdrant` | Qdrant vector database (pinned `v1.17.0`) | `managed` mode only |
| Container | `socraticode-ollama` | Ollama embedding server | `docker` mode only |
| Volume | `socraticode_qdrant_data` | Persistent vector storage | `managed` mode only |
| Volume | `socraticode_ollama_data` | Persistent model storage | `docker` mode only |

In `QDRANT_MODE=external` mode, the Qdrant container and volume are not created or started — SocratiCode connects directly to the configured remote endpoint. Server-side BM25 inference (used for hybrid search) requires **Qdrant v1.15.2 or later**. The managed container runs `v1.17.0`. If you bring your own Qdrant instance, ensure it meets this minimum.

All containers use `--restart unless-stopped` for automatic recovery.

> **Why non-standard ports?** SocratiCode intentionally uses non-default ports for its managed containers — `16333`/`16334` instead of Qdrant's defaults (`6333`/`6334`), and `11435` instead of Ollama's default (`11434`). This avoids conflicts with any Qdrant or Ollama instance you may already be running locally. All ports are overridable via environment variables if needed.

## Testing

SocratiCode has a comprehensive test suite across unit, integration, and end-to-end layers.

### Prerequisites

- **Unit tests**: No external dependencies required.
- **Integration & E2E tests**: Require Docker running with Qdrant and Ollama containers. Containers are managed automatically by the test infrastructure.

### Running Tests

```bash
# Run all tests
npm test

# Run only unit tests (no Docker needed)
npm run test:unit

# Run integration tests (requires Docker)
npm run test:integration

# Run end-to-end tests (requires Docker)
npm run test:e2e

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

### Test Architecture

| Layer | Docker? | Description |
|-------|---------|-------------|
| **Unit** (`tests/unit/`) | No | Config, constants, ignore rules, cross-process locking, logging, graph analysis, import extraction, path resolution, embedding config, indexer utilities, embeddings, startup lifecycle, watcher cross-process awareness |
| **Integration** (`tests/integration/`) | Yes | Docker/Ollama setup, Qdrant CRUD, real embeddings, indexer, watcher, code graph, all MCP tools |
| **E2E** (`tests/e2e/`) | Yes | Complete lifecycle: health → index → search → graph → watch → remove  |

Integration and E2E tests that require Docker are automatically skipped when Docker is not available.

## Why Not Just Grep?

Modern evaluations on real repositories show that hybrid lexical + semantic code search consistently outperforms plain grep once you care about natural-language queries, large codebases, or coding agents: reports show ~20% search-quality gains from BM25F ranking at scale, AST-aware retrieval improving recall and bug-fix performance on RepoEval and SWE-bench, and hybrid approach with grep (the default in SocratiCode) beats grep in 70% of agentic code-search tasks while cutting search operations by over half.

### Real-world benchmark: VS Code (2.45M lines of code) with Claude Opus 4.6

Running a head-to-head comparison against the VS Code codebase (~2.45 million lines of TypeScript/JavaScript across 5,300+ files, 55,437 indexed chunks) to measure what a Claude Opus 4.6 AI agent actually consumes when answering architectural questions.

**Methodology:** For each question, the **grep approach** follows the realistic multi-step workflow an AI agent uses today: `grep -rl` to find matching files, identify core files, read them in chunks (200 lines at a time), and repeat until it has enough context. The **SocratiCode approach** performs a single semantic search call that returns the 10 most relevant code chunks from across the entire codebase.

| Question | Grep (bytes) | SocratiCode (bytes) | Reduction | Speedup |
|:---------|:-------------|:--------------------|:----------|:--------|
| How does VS Code implement workspace trust restrictions? | 56,383 | 21,149 | **62.5%** | **49.7x** |
| How does the diff editor compute and display text differences? | 37,650 | 15,961 | **57.6%** | **40.2x** |
| How does VS Code handle extension activation and lifecycle? | 36,231 | 16,181 | **55.3%** | **34.4x** |
| How does the integrated terminal spawn and manage shells? | 50,159 | 22,518 | **55.1%** | **31.1x** |
| How does VS Code implement the command palette and quick pick? | 70,087 | 20,676 | **70.5%** | **31.7x** |
| **Total** | **250,510** | **96,485** | **61.5%** | **37.2x** |

**Key findings:**

- **84% fewer tool calls** — Grep needed 31 steps across the 5 questions (6-7 per question). SocratiCode: 5 steps total (1 per question).
- **61.5% less data consumed** — The AI agent processes ~150KB less context, which directly reduces token costs with any LLM.
- **37x faster** — Grep scans across 2.45M lines can take up 2-3.5 seconds per question. Semantic search up to 60-90ms.

> **Note:** This benchmark is _conservative_ for the grep approach. It assumes the agent already knows which files to read. In practice, a real AI agent needs additional exploratory grep calls, follows dead ends, reads irrelevant files, and often needs multiple rounds of narrowing. The actual savings might be larger.

### When hybrid search wins

**Natural-language and conceptual queries** — Queries like *"Where do we handle database connection pooling?"* or *"How does this library implement exponential backoff?"* describe behaviour rather than naming a function. Evaluations on repository-level benchmarks (RepoEval, SWE-bench) show that AST-aware semantic retrieval improves recall by up to 4.3 points and downstream code-generation accuracy by ~2.7 points compared to fixed line-based chunks. Agentic evaluations on real open-source repos show a 70% win rate for hybrid search over vanilla grep on hard, conceptual questions — with 56% fewer search operations and ~60,000 fewer tokens per complex query.

**Large repos and monorepos** — At multi-million LOC scale, full-text scans become expensive. Production search engines report ~20% relevance improvement from BM25F ranking over previous approaches, and use it as the first-stage retriever for semantic reranking. Hybrid search backed by inverted and vector indexes avoids full scans entirely, making it both faster and more precise at scale. Industry practitioners explicitly note that grep and find "don't scale well to millions of files" and that optimised embedding-based indexes can be faster at that scale.

**Cross-file and cross-language reasoning** — Finding all code paths that eventually call an internal helper across services, or mapping a natural-language spec to implementations in Go and SQL, requires understanding that goes beyond string matching. Evaluations show that hybrid pipelines with tree-sitter parsing and dependency context outperform grep when naming is non-obvious and semantic understanding is needed. AST-based chunking with learned retrievers improves retrieval in cross-language benchmarks, and multi-vector semantic models show large gains over BM25 alone across diverse code search tasks (AppsRetrieval, CodeSearchNet, CosQA) where queries are in natural language and targets span many languages.

**Mixed code + context artifacts** — Questions like *"Where is rate-limiting configured?"* might match Nginx configs, Terraform files, or YAML — not just application code. Hybrid search over mixed technical corpora (structured fields + free text) consistently outperforms pure lexical or pure vector approaches in published evaluations.

### When grep still wins

The same research makes clear when grep (or ripgrep) is entirely reasonable — and sometimes optimal:

- **You know the exact identifier, error string, or regex pattern.** No semantic gap to bridge.
- **The repo is modest in size** — full scans are cheap and fast.
- **Content is limited and structured code with distinctive names**, not prose or documentation.

On easy or directly-named queries, grep can match or beat semantic methods. That's why the best architectures don't replace grep — they extend it. SocratiCode's hybrid approach runs both BM25 keyword search and dense semantic search on every query, fusing results via RRF, so you get the precision of exact matching and the recall of semantic understanding in a single call.

## FAQ

### Indexing failed with an error — can I resume without starting over?

Yes. Indexing automatically resumes from where it left off. The indexer checkpoints
file hashes after every batch of files. When you ask your AI to index again (e.g. *"index
this project"*), it detects the existing data, skips every file that was already successfully
embedded, and only re-processes the files that weren't checkpointed before the failure.
Already-indexed chunks are never deleted or re-embedded. Just ask your AI to index again and
it will pick up where it stopped.

### My MCP host disconnects while indexing a large codebase. What should I do?

Indexing runs in the background on the MCP server. However, some MCP hosts (VS Code,
Claude Desktop, etc.) disconnect an idle connection after a period of inactivity, which
kills the background process. To keep the connection alive, ask your AI to check status
(e.g. *"check indexing status"*) roughly every 60 seconds after starting indexing until it
completes. If the connection does drop and indexing is interrupted, just ask your AI to
index again — it resumes automatically (see above).

### Indexing keeps failing or won't resume properly. What should I do?

If indexing repeatedly fails, throws errors on resume, or gets stuck in a loop, the
simplest fix is to start fresh: ask your AI to *"remove the index for this project"*, then
ask it to index again. This clears all stored chunks and metadata for the project and
begins a clean re-index. It won't affect other indexed projects.

### My codebase is very large — can I pause indexing and resume it later?

Yes. You can stop indexing at any time and resume it later without losing progress:

1. **Ask your AI assistant to stop** — say something like *"stop indexing"* and it will
   cancel the current operation at the next batch boundary. All batches completed so far
   are checkpointed and preserved.
2. **Or just close your project/editor** — SocratiCode detects the disconnection and shuts
   down gracefully, preserving all checkpointed progress.
3. **Come back whenever you want** — reopen the same project in your editor and ask the AI
   to resume indexing (e.g. *"resume indexing"*). SocratiCode detects the incomplete index
   automatically, skips every file already embedded, and picks up exactly where it left off.

This makes indexing very large codebases practical even on slower hardware — you can index in
multiple sessions across hours or days, and no work is ever repeated or lost.

### I reopened my project but new/changed files aren't showing up in search results.

In the default `SOCRATICODE_WATCHER=auto` mode, server startup resumes the indexed project
represented by the MCP process's working directory. It starts the watcher and catches up all
files modified while SocratiCode was down before watching for future changes. Use
`SOCRATICODE_AUTO_RESUME_PROJECTS` or `SOCRATICODE_AUTO_RESUME=all` to select additional
projects at startup. A completed indexed project not selected at startup gets the same
watcher-start fallback on its first search, status, or graph interaction.

If you want to force an immediate catch-up before searching, ask your AI to *"start watching
this project"* or *"update the index"* — both run an incremental update synchronously and
then start watching.

The watcher will not auto-start if a full index or incremental update is currently in
progress, if the project has not been indexed yet, or if another MCP process is already
watching the same project. It also will not auto-start in `manual` or `off` mode. In those
modes, `codebase_status` and search output identify the index as a snapshot instead of
asking an agent to restart the watcher.

For a fully deliberate snapshot, set both `SOCRATICODE_WATCHER=off` and
`SOCRATICODE_AUTO_RESUME=off` in every MCP process that uses the checkout. Existing indexes
and graphs remain readable with no re-index. Run `codebase_update` to refresh the code index
and `codebase_graph_build` to explicitly create or rebuild the graph. If explicit temporary
watching is useful, use `SOCRATICODE_WATCHER=manual` instead.

If you work across many indexed repos and want all of them resumed at server startup
(watcher plus catch-up update), not just the one you opened, see the
`SOCRATICODE_AUTO_RESUME` and `SOCRATICODE_AUTO_RESUME_PROJECTS` environment variables
in the [Indexing Behaviour](#indexing-behaviour) table.

### Can multiple AI agents work on the same codebase at the same time?

Yes — this is a first-class supported workflow. When multiple agents (each running their own MCP server instance) are pointed at the same project directory, they automatically share the same Qdrant index. The first agent to trigger indexing acquires a cross-process lock and builds the index; any other agent that tries to index simultaneously receives current progress instead of starting a duplicate operation. All agents can search concurrently with no coordination needed — Qdrant handles parallel reads natively.

The file watcher also coordinates automatically: only one process watches per project. Other instances detect this and skip watcher startup. When the watching process picks up a file change, it updates the shared index — and every agent's next search sees the updated results.

If the agent that owns the watcher or indexing lock crashes, its lock goes stale after 2 minutes and another agent's next interaction automatically reclaims it. No manual intervention needed.

This makes SocratiCode ideal for multi-agent workflows: one agent writing tests while another fixes code, a planning agent and an implementation agent working in parallel, or any combination of AI assistants sharing deep codebase knowledge without duplicating work.

### Can I index multiple projects at the same time?

Yes. SocratiCode maintains a separate isolated collection for each project path. Ask your
AI to *"list all indexed projects"* to see everything currently indexed.

### What happens if I change my embedding provider or model?

Each collection keeps the effective provider, model, dimensions, and query behavior recorded
when its index was created. Changing those settings in the MCP config does not alter an existing
collection. Indexing and search continue with its stored profile, while `codebase_status` reports
the requested settings as pending. To activate the new settings, ask your AI to *"remove the index
for this project"* and then index it again. Other collections continue using their own profiles.

### How do I remove a project's index (e.g. to switch embedding model or reindex from scratch)?

1. **Stop first** — if indexing is in progress, say *"stop indexing this project"*. Removing
   while indexing is active would corrupt data, so the remove will be refused until the
   current batch finishes.
2. **Remove** — say *"remove the index for this project"*. This deletes the vector
   collection, all stored chunk metadata, the code graph, and context artifact metadata for
   that project only. Other projects are untouched.
3. **Re-index** — update your MCP config with the new parameters if needed, then say
   *"index this project"* to start fresh.

### What is the code behind Socrates face in the SocratiCode logo?

The code you see behind Socrates is part of the original Apollo 11 guidance computer (AGC) source code for Command Module (Comanche055)!


## Community

- 💬 **[Discord](https://discord.gg/dHNMKVY2J2)** — chat with users and maintainers, ask "how do I…", share what you're building
- 🐛 **[GitHub Issues](https://github.com/giancarloerra/socraticode/issues)** — bug reports and confirmed feature requests (please use the templates)
- 📣 **Releases** — *Watch* the repo (top-right on GitHub → *Custom* → *Releases*) to be notified of new versions

If SocratiCode is useful to you, the single most helpful thing you can do is ⭐ **star the repo** — it's how others discover the project.

---

## SocratiCode Cloud

The full SocratiCode engine is — and will remain — free and open-source under AGPL-3.0. **SocratiCode Cloud** is an optional hosted version on top of the same engine, currently in **private beta**, for teams that want shared, managed, compliant infrastructure.

What Cloud adds on top of the OSS engine:

- **Shared team index** — every developer searches the same data, auto-indexed on every push across every branch
- **Cross-repo search** — query every repository your organisation owns in one call
- **SSO / SAML, audit logs, IP allowlisting** — built in, not a later upsell
- **Deployment models** — managed cloud (EU/US), your own VPC (AWS/GCP/Azure), or fully air-gapped on-prem
- **Web dashboard** — search, dependency graphs, artefacts, team and repo management
- **Zero local infrastructure** — no Docker, no Qdrant, no Ollama for the team to manage

Currently onboarding a small number of engineering teams. **[Request early access →](https://socraticode.cloud)**

> The open-source engine in this repository is and will always be the same engine that powers Cloud. No bait-and-switch, no feature gating of the OSS core. Cloud only adds the team, deployment and compliance layer around it.

---

## License

SocratiCode is dual-licensed:

- **Open Source** — [AGPL-3.0](LICENSE). Free to use, modify, and distribute.
  If you modify SocratiCode and offer it as a network service, you must release
  your modifications under AGPL-3.0.

- **Commercial** — For organisations that need to use SocratiCode in proprietary
  products or services without AGPL obligations. See [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL)
  or contact [giancarlo@altaire.com](mailto:giancarlo@altaire.com).

Copyright (C) 2026 Giancarlo Erra - Altaire Limited.

### Third-Party Licenses

SocratiCode includes open-source dependencies under their own licenses
(MIT, Apache 2.0, ISC, BSD 3-Clause). See [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES) for details.

### Contributing

Contributions are welcome. By submitting a pull request, you agree to the
[Contributor License Agreement](CLA.md).

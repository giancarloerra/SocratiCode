<p align="center">
  <img src="./socraticode_logo_thumbnail.png" alt="SocratiCode logo" />
</p>

# SocratiCode

<p align="center">
  <a href="https://github.com/giancarloerra/socraticode/actions/workflows/ci.yml"><img src="https://github.com/giancarloerra/socraticode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://www.npmjs.com/package/socraticode"><img src="https://img.shields.io/npm/v/socraticode.svg" alt="npm version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18"></a>
  <a href="https://github.com/giancarloerra/socraticode"><img src="https://img.shields.io/github/stars/giancarloerra/socraticode?style=social" alt="GitHub stars"></a>
  <a href="https://mcptoplist.com/server/io.github.giancarloerra%2Fsocraticode"><img src="https://mcptoplist.com/badge/io.github.giancarloerra%2Fsocraticode.svg" alt="MCP Toplist rank"></a>
  <a href="https://discord.gg/dHNMKVY2J2"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="#claude-code-plugin-recommended-for-claude-code-users"><img src="https://img.shields.io/badge/Claude_Code-Install_Plugin-CC785C?style=flat-square&logoColor=white" alt="Install Claude Code Plugin"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=giancarloerra.socraticode"><img src="https://vsmarketplacebadges.dev/version-short/giancarloerra.socraticode.svg?style=flat-square&label=VS%20Code%20Marketplace&logo=visualstudiocode&color=0098FF" alt="VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/giancarloerra/socraticode"><img src="https://img.shields.io/open-vsx/v/giancarloerra/socraticode?style=flat-square&label=Open%20VSX&color=A52A2A" alt="Open VSX"></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22socraticode%22%5D%7D"><img src="https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white" alt="Install in VS Code"></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22socraticode%22%5D%7D&quality=insiders"><img src="https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white" alt="Install in VS Code Insiders"></a>
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=socraticode&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNvY3JhdGljb2RlIl19"><img src="https://img.shields.io/badge/Cursor-Install_MCP_Server-F14C28?style=flat-square&logo=cursor&logoColor=white" alt="Install in Cursor"></a>
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

**One thing, done well: deep codebase intelligence — zero setup, no bloat, fully automatic.** SocratiCode gives AI assistants deep semantic understanding of your codebase — **hybrid search, cross-project search, polyglot code dependency graphs, symbol-level impact analysis and flow, interactive HTML graph explorer for visual navigation, and searchable context artifacts (database schemas, API specs, infra configs, architecture docs)**. Zero configuration — add it to **any MCP host**, or install the **Native Plugin** for Claude Code, Cursor, VS Code Copilot, Codex or Gemini CLI. It manages everything automatically.

**Production-ready**, battle-tested on **enterprise-level** large repositories (up to and over **~40 million lines of code**). **Batched**, automatic **resumable** indexing checkpoints progress — pauses, crashes, restarts, and interruptions don't lose work. The file watcher keeps the **index automatically updated** at every file change and across sessions. **Multi-branch, multi-repo** and **multi-agent ready** — multiple AI agents can work on the same codebase simultaneously, sharing a single index with automatic coordination and zero configuration.

**Private and local by default** — Docker handles everything, no API keys required, no data leaves your machine. **Cloud ready** for embeddings (OpenAI, Google Gemini) and Qdrant, and a **full suite of configuration options** are all available when you need them.

**Code intelligence that belongs to you, AI and host agnostic** — your codebase's understanding lives with the code, not locked to any one assistant, IDE or model. And because SocratiCode pre-computes the hard parts (blast radius, call-flow, dependency traversal), **smaller models can handle architectural complex tasks that would otherwise need top-tier reasoning**, saving even more on token cost.

The first Qdrant‑based MCP/Claude Plugin/Skill that pairs auto‑managed, zero‑config local Docker deployment with **AST‑aware code chunking, hybrid semantic + BM25 (RRF‑fused) code search**, polyglot dependency **graphs** with circular‑dependency visualisation, **symbol‑level Impact Analysis** (blast‑radius & call‑flow tracing across 18 languages), and searchable **infra/API/database artifacts** in a single focused, zero-config and easy to use code intelligence engine.

> **Benchmarked on VS Code (2.45M lines):** SocratiCode uses **61% less context**, **84% fewer tool calls**, and is **37x faster** than grep‑based exploration — tested live with Claude Opus 4.6. [See the full benchmark →](#real-world-benchmark-vs-code-245m-lines-of-code-with-claude-opus-46)

## Contents

- [Quick Start](#quick-start)
- [Plugins](#plugins)
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

> **Only [Docker](https://www.docker.com/products/docker-desktop/) (running) required.**

**One-click install** — Claude Code, VS Code and Cursor:

[![Install Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Install_Plugin-CC785C?style=flat-square&logoColor=white)](#claude-code-plugin-recommended-for-claude-code-users)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22socraticode%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=socraticode&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22socraticode%22%5D%7D&quality=insiders) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_MCP_Server-F14C28?style=flat-square&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=socraticode&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNvY3JhdGljb2RlIl19) 

**All MCP hosts** — add the following to your `mcpServers` (Claude Desktop, Windsurf, Cline, Roo Code) or `servers` (VS Code project-local `.vscode/mcp.json`) config:

```json
"socraticode": {
  "command": "npx",
  "args": ["-y", "socraticode"]
}
```

**Claude Code** — install the plugin (recommended, includes workflow skills for best results):

From your shell:

```bash
claude plugin marketplace add giancarloerra/socraticode
claude plugin install socraticode@socraticode
```

Or from within Claude Code:

```
/plugin marketplace add giancarloerra/socraticode
/plugin install socraticode@socraticode
```

> **Auto-updates:** After installing, enable automatic updates by opening `/plugin` → Marketplaces → select `socraticode` → Enable auto-update.

Or as MCP only (without skills):

```bash
claude mcp add socraticode -- npx -y socraticode
```

> **Updating:** `npx` caches the package after the first run. To get the latest version, clear the cache and restart your MCP host: `rm -rf ~/.npm/_npx && claude mcp restart socraticode`. Alternatively, use `npx -y socraticode@latest` in your config to always check for updates on startup (slightly slower).

**OpenCode** — add to your `opencode.json` (or `opencode.jsonc`):

```json
{
  "mcp": {
    "socraticode": {
      "type": "local",
      "command": ["npx", "-y", "socraticode"],
      "enabled": true
    }
  }
}
```

**OpenAI Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.socraticode]
command = "npx"
args = ["-y", "socraticode"]
```

Restart your host. On first use SocratiCode automatically pulls Docker images, starts its own Qdrant and Ollama containers, and downloads the embedding model — one-time setup, ~5 minutes depending on your connection. After that, it starts in seconds.

**First time on a project** — ask your AI: **"Index this codebase"**. Indexing runs in the background; ask **"What is the codebase index status?"** to monitor progress. Depending on codebase size and whether you're using GPU-accelerated Ollama or cloud embeddings, first-time indexing can take anywhere from a few seconds to a few minutes (it takes under 10 minutes to first-index +3 million lines of code on a Macbook Pro M4). Once complete it doesn't need to be run again, you can search, explore the dependency graph, and query context artifacts.

**Every time after that** — just use the tools (search, graph, etc.). On server startup SocratiCode automatically detects previously indexed projects, restarts the file watcher, and runs an incremental update to catch any changes made while the server was down. If indexing was interrupted, it resumes automatically from the last checkpoint. You can also explicitly start or restart the watcher with `codebase_watch { action: "start" }`.

> **macOS / Windows on large codebases**: Docker containers can't use the GPU. For medium-to-large repos, [install native Ollama](https://ollama.com/download) (auto-detected, no config change needed) for Metal/CUDA acceleration, or use [OpenAI embeddings](#openai-embeddings) for speed without a local install. [Full details.](#embedding-performance-on-macos--windows)

> **Recommended**: For best results, add the [Agent Instructions](#agent-instructions) to your AI assistant's system prompt or project instructions file (`CLAUDE.md`, `AGENTS.md`, etc.). The key principle — **search before reading** — helps your AI use SocratiCode's tools effectively and avoid unnecessary file reads.

> **Claude Code users**: If you installed the SocratiCode plugin, the Agent Instructions are included automatically as skills — no need to add them to your `CLAUDE.md`. The plugin also bundles the MCP server, so you don't need a separate `claude mcp add`.

> **Advanced**: cloud embeddings (OpenAI / Google), external Qdrant, remote Ollama, native Ollama, and dozens of tuning options are all available. See [Configuration](#configuration) below.

## Plugins

SocratiCode is available as a native plugin on multiple AI coding platforms. Plugins bundle the MCP server with workflow skills and agent instructions — one install gives you everything.

| Platform | Install method |
|:---------|:---------------|
| Claude Code | `claude plugin marketplace add giancarloerra/socraticode && claude plugin install socraticode@socraticode` — [full instructions](#claude-code-plugin-recommended-for-claude-code-users) |
| **VS Code / Cursor / VSCodium / Gitpod / code-server / Theia / Antigravity / Particle Workbench** (extension) | Search **SocratiCode** in the Extensions panel (VS Code Marketplace or Open VSX). The extension auto-registers the MCP server in Copilot agent mode, Cline, Continue and Roo Code, and adds a sidebar, interactive graph webview, and onboarding walkthrough. _Source: [`extension/`](./extension)._ |
| Cursor | `/add-plugin https://github.com/giancarloerra/socraticode` (plugin format with skills). Also listed in the Cursor Marketplace at [cursor.com/marketplace](https://cursor.com/marketplace). |
| VS Code Copilot | Command Palette → `Chat: Install Plugin From Source` → `https://github.com/giancarloerra/socraticode` (plugin format with skills) |
| Zed | Add as a custom MCP server in Zed settings — [config example](#zed) |
| Gemini CLI | `gemini extensions install https://github.com/giancarloerra/socraticode` |
| OpenAI Codex | No public plugin directory yet — use the [MCP config](#quick-start) or see **Codex local install** below |

> **Extension vs plugin (what to install in VS Code / Cursor):**
>
> - The **extension** (Marketplace / Open VSX listing) is a regular VS Code-style extension. It auto-registers the MCP server in Copilot agent mode, Cline, Continue, Roo Code, plus adds a sidebar, status-bar item, interactive graph webview, walkthrough and palette commands. Best for most users.
> - The **plugins** (`/add-plugin` for Cursor, `Chat: Install Plugin From Source` for VS Code Copilot) bundle the MCP server **plus skills + agent instructions** that teach the AI to use SocratiCode tools effectively. Best when you want the agent to be opinionated about using SocratiCode.
> - You can install both. The extension only registers the MCP server once, so they don't conflict.
> - **VS Code Copilot note**: the chat plugins feature is in preview. Enable it with `chat.plugins.enabled: true` in your VS Code settings.

> **Codex local plugin install**: Clone the repo and register it in your personal plugin marketplace:
> ```bash
> git clone https://github.com/giancarloerra/socraticode.git ~/.agents/plugins/socraticode
> ```
> Then add it to `~/.agents/plugins/marketplace.json`:
> ```json
> {
>   "plugins": [
>     {
>       "name": "socraticode",
>       "path": "~/.agents/plugins/socraticode"
>     }
>   ]
> }
> ```
> Codex will discover the plugin from `.codex-plugin/plugin.json` on next launch.

> **All other MCP hosts** (Claude Desktop, Windsurf, Cline, Roo Code, OpenCode): Use the [MCP config](#quick-start) — works with any host that supports the MCP protocol.

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
- **Polyglot code dependency graph** — Static analysis of import/require/use/include statements using ast-grep for 18+ languages. No external tools like dependency-cruiser required. Detects circular dependencies and generates visual Mermaid diagrams.
- **Language-agnostic** — Works with every programming language, framework, and file type out of the box. No per-language parsers to install, no grammar files to maintain, no "unsupported language" limitations. If your AI can read it, SocratiCode can index it.
- **Incremental indexing** — After the first full index, only changed files are re-processed. Content hashes are persisted in Qdrant so state survives server restarts.
- **Batched & resumable indexing** — Files are processed in batches of 50, with progress checkpointed to Qdrant after each batch. If the process crashes or is interrupted, the next run automatically resumes from where it left off — already-indexed files are skipped via hash comparison. This keeps peak memory low and makes indexing reliable even for very large codebases.
- **Live file watching** — Optionally watch for file changes and keep the index updated in real time (debounced 2s). Watcher also invalidates the code graph cache.
- **Parallel processing** — Files are scanned and chunked in parallel batches (50 at a time) for fast I/O, while embedding generation and upserts are batched separately for optimal throughput.
- **Multi-project** — Index multiple projects simultaneously. Each gets its own isolated collection with full project path tracking.
- **Cross-project search** — Search across multiple related projects in a single query. Link projects via `.socraticode.json` or the `SOCRATICODE_LINKED_PROJECTS` env var, then set `includeLinked: true` on `codebase_search`. Results are tagged with project labels and ranked by cosine similarity, which is comparable across projects of very different sizes (falling back to rank fusion when a cosine is unavailable for any hit).
- **Branch-aware indexing** — Maintain separate indexes per git branch by setting `SOCRATICODE_BRANCH_AWARE=true`. Each branch gets its own Qdrant collections, so switching branches instantly switches to the correct index. Ideal for CI/CD pipelines and PR review workflows.
- **Respects ignore rules** — Honors all `.gitignore` files (root + nested), plus an optional `.socraticodeignore` for additional exclusions. Includes sensible built-in defaults. `.gitignore` processing can be disabled via `RESPECT_GITIGNORE=false`. Dot-directories (e.g. `.agent`) can be included via `INCLUDE_DOT_FILES=true`.
- **Custom file extensions** — Projects with non-standard extensions (e.g. `.tpl`, `.blade`) can be included via `EXTRA_EXTENSIONS` env var or `extraExtensions` tool parameter. Such files are indexed as plaintext and appear as leaf nodes in the code graph (no AST chunking or symbols). To instead treat a custom extension as a real language (full AST chunking, symbols, call graph), map it with `EXTENSION_LANGUAGE_MAP` (e.g. `.inc:php`).
- **Configurable infrastructure** — All ports, hosts, and API keys are configurable via environment variables. Qdrant API key support for enterprise deployments.
- **Enterprise-ready simplicity** — No agent coordination tuning, no memory limit environment variables, no coordinator/conductor capacity knobs, no backpressure configuration. SocratiCode scales by relying on production-grade infrastructure (Qdrant, proven embedding APIs) rather than complex in-process orchestration.
- **Auto-setup & zero configuration** — Just install the Claude Plugin/Skill or add the MCP server to your AI host config. On first use, the server automatically checks Docker, pulls images, starts Qdrant and Ollama containers, and downloads the embedding model. No config files, no YAML, no environment variables to tune, no native dependencies to compile. Works everywhere Docker runs.
- **Session resume** — When reopening a previously indexed project, the file watcher starts automatically on first tool use (search, status, update, or graph query). It catches any changes made since the last session and keeps the index live — no manual action needed.
- **Auto-start watcher** — The file watcher is automatically activated when you use any SocratiCode tool on an indexed project. It starts after `codebase_index` completes, after `codebase_update`, and on the first `codebase_search`, `codebase_status`, or graph query. You can also start it manually with `codebase_watch { action: "start" }` if needed.
- **Auto-build code graph** — The code dependency graph is automatically built after indexing and rebuilt when watched files change. No need to call `codebase_graph_build` manually unless you want to force a rebuild.
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
| Node.js 18+ | Runs the MCP server | [nodejs.org](https://nodejs.org/) |

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
| Zed | `AGENTS.md` at project root (Zed auto-reads it), or use the Rules Library to create a default rule |
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

#### Claude Code plugin (recommended for Claude Code users)

The SocratiCode plugin bundles both the MCP server and workflow skills that teach Claude how to use the tools effectively. One install gives you everything:

From your shell:

```bash
claude plugin marketplace add giancarloerra/socraticode
claude plugin install socraticode@socraticode
```

Or from within Claude Code:

```
/plugin marketplace add giancarloerra/socraticode
/plugin install socraticode@socraticode
```

The plugin includes:
- **MCP server** — all 21 SocratiCode tools (search, graph, context artifacts, etc.)
- **Exploration skill** — teaches Claude the search-before-reading workflow
- **Management skill** — guides setup, indexing, watching, and troubleshooting
- **Explorer agent** — delegatable subagent for deep codebase analysis

> If you previously installed SocratiCode as a standalone MCP (`claude mcp add socraticode`), remove it after installing the plugin to avoid duplicates: `claude mcp remove socraticode`

**Auto-updates:** Third-party plugins don't auto-update by default. To enable automatic updates, open `/plugin` → Marketplaces → select `socraticode` → Enable auto-update. To update manually:

From your shell:

```bash
claude plugin marketplace update socraticode
claude plugin update socraticode@socraticode
```

Or from within Claude Code:

```
/plugin marketplace update socraticode
/plugin update socraticode@socraticode
```

**Configuring environment variables:** SocratiCode works with zero config for most users (local Ollama + managed Qdrant). If you need cloud embeddings, a remote Qdrant, or other customisation:

1. **Claude Code settings** (recommended) — add to `~/.claude/settings.json`:
   ```json
   {
     "env": {
       "EMBEDDING_PROVIDER": "openai",
       "OPENAI_API_KEY": "sk-..."
     }
   }
   ```
   This works in all environments — CLI, VS Code, and JetBrains.

2. **Shell profile** — set vars in `~/.zshrc` or `~/.bashrc`:
   ```bash
   export EMBEDDING_PROVIDER=openai
   export OPENAI_API_KEY=sk-...
   ```
   Works when Claude Code is launched from a terminal. Note: IDE-launched sessions (e.g. VS Code opened from Finder/Dock) may not inherit shell profile variables — use option 1 instead.

Restart Claude Code after changing variables. See [Environment Variables](#environment-variables) for all options.

#### npx (recommended for all other MCP hosts — no installation)

Requires Node.js 18+ and Docker (running). Already covered in [Quick Start](#quick-start) above, add the following to your `mcpServers` (Claude Desktop, Windsurf, Cline, Roo Code) or `servers` (VS Code project-local `.vscode/mcp.json`) config:

```json
    "socraticode": {
      "command": "npx",
      "args": ["-y", "socraticode"]
    }
```

#### Zed

Add SocratiCode as a custom MCP server in Zed's settings (`Zed > Settings > Settings` or `cmd+,`). Under `context_servers`, add:

```json
{
  "context_servers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "socraticode"],
      "env": {}
    }
  }
}
```

To pass environment variables (e.g. for cloud embeddings or branch-aware indexing), add them to the `env` object:

```json
{
  "context_servers": {
    "socraticode": {
      "command": "npx",
      "args": ["-y", "socraticode"],
      "env": {
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Zed auto-reads `AGENTS.md` from the project root for agent instructions. Copy the [Agent Instructions](#agent-instructions) block into your project's `AGENTS.md` to ensure the agent uses SocratiCode tools effectively. You can also add them as a default rule in Zed's Rules Library (`agent: open rules library`).

#### From source (for contributors)

```bash
git clone https://github.com/giancarloerra/socraticode.git
cd socraticode
npm install
npm run build
```

Then use `node /absolute/path/to/socraticode/dist/index.js` in place of `npx -y socraticode` in the config examples below.

### MCP host config variants

> All `env` options below apply equally to the `npx` install. Just add the `"env"` block to the npx config shown above.

Add to your MCP settings - `mcpServers` (Claude Desktop, Windsurf, Cline, Roo Code) or `servers` (VS Code project-local `.vscode/mcp.json`):

#### Default (zero config, from source)

> Using **npx**? Your config is already in [Quick Start](#quick-start). Add any `"env"` block from the examples below as needed.

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
> `LMSTUDIO_API_KEY` if you've enabled API key auth in LM Studio.

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
claude mcp add -e SOCRATICODE_PROJECT_ID=my-project --scope local socraticode -- npx -y socraticode
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
      "args": ["-y", "socraticode"],
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
| `codebase_graph_status` | Check graph build progress or persisted graph metadata (advises when few captured imports resolved, so a near-empty graph is not read as a healthy one) |
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

JavaScript, TypeScript, TSX, Python, Java, Kotlin, Scala, C, C++, C#, Go, Rust, Ruby, PHP, Swift, Dart, Bash/Shell, HTML, CSS/SCSS, Svelte, Vue

Svelte and Vue: imports extracted from `<script>` blocks (re-parsed as TypeScript) and CSS `@import`/`@require` from `<style>` blocks (any combination of `lang`, `scoped`, `module`, `global` attributes). Path aliases from `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` are resolved (including `extends` chains). SCSS partial resolution (`_` prefix convention) is supported.

Python: absolute imports resolve through the import roots implied by the project's `pyproject.toml` files — root and nested, so uv workspaces get cross-package edges — covering both the `src/` layout (`packages/<dist>/src/<module>/…`, what `uv init --lib`, hatchling and setuptools generate) and the flat layout beside each manifest, including PEP 420 namespace packages and single-module distributions. A manifest applies to a file only when it sits on that file's ancestor path or an ancestor manifest declares it a `[tool.uv.workspace]` member, so a sample app, docs project or checked-in sdist carrying its own manifest does not become an import root for unrelated code; only `[tool.uv.workspace]` is read, so poetry, pdm and hatch path-dependency monorepos get ancestor-path scoping and no cross-package edges; applicable roots are tried nearest first, so a package resolves its own modules before a sibling's. Relative imports and the project-root `src/`/`lib/` and sibling-flat conventions are unchanged — the sibling-flat fallback still takes precedence over these roots, matching CPython, which puts the script's own directory at `sys.path[0]`.

Dart: symbols (classes, mixins, enums, extensions, typedefs, functions, getters, setters, operators, constructors including named and factory, and abstract/bodyless members), call sites (method calls, cascades, constructor invocations), `main()` entry-point detection, and AST chunking are all tree-sitter based; import/export/part edges are extracted via regex. Intra-project `package:` imports (the Flutter convention) resolve through the project's `pubspec.yaml` files — root and nested, so pub-workspace/melos monorepos get cross-package edges — via pub's `package:<name>/<rest>` → `<package_root>/lib/<rest>` mapping; `dart:` and unknown package names stay external. The bundled grammar (`@ast-grep/lang-dart`) predates Dart 3 class modifiers (`sealed`/`base`/`interface`/`final`/`mixin class`) and `extension type`: declarations using those are skipped (with a one-time warning logged) until the upstream grammar is updated, while the rest of each file still indexes normally.

### Code Graph via Regex + Indexing

Lua (require/dofile/loadfile), SASS, LESS, Stylus (CSS `@import`/`@require` extraction)

### Indexing Only (hybrid search, line-based chunking)

JSON, YAML, TOML, XML, INI/CFG, Markdown/MDX, RST, SQL, R, Dockerfile, TXT, and any file matching a supported extension or special filename (Dockerfile, Makefile, Gemfile, Rakefile, etc.)

**55 file extensions** + 8 special filenames supported out of the box.

Extensionless files (Unix scripts, health probes, sourced libraries) are also indexed via content-based language detection when `INDEX_EXTENSIONLESS` is enabled (the default) — see that environment variable below.

## Ignore Rules

The indexer combines three layers of ignore rules:

1. **Built-in defaults** — `node_modules`, `.git`, `dist`, `build`, lock files, IDE folders, etc.
2. **`.gitignore`** — All `.gitignore` files in the project (root and nested subdirectories). Set `RESPECT_GITIGNORE=false` to skip `.gitignore` processing entirely.
3. **`.socraticodeignore`** — Optional file for indexer-specific exclusions. Same syntax as `.gitignore`.

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
- **`path`** — Path to a file or directory (relative to project root, or absolute). Directories are read recursively.
- **`description`** — Tells the AI what this artifact is and how to use it

### How it works

Artifacts are chunked and embedded into Qdrant using the same hybrid dense + BM25 search as code. On first search, artifacts are auto-indexed. On subsequent searches, staleness is auto-detected via content hashing — changed files are re-indexed transparently.

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

SocratiCode reads configuration from environment variables. The way you pass them depends on your MCP host — the key name and file format differ across the three main config flavours. If env vars appear to be ignored, check the host's config format first — most "it's not picking up my settings" issues are a mismatched key.

### Passing env vars by host

| Host | Config file | Env-var syntax |
|------|-------------|---------|
| Claude Code / Claude Desktop / Windsurf / Cline / Roo Code / Cursor / VS Code Copilot | MCP JSON (`mcpServers` or `servers`) | `"env": { "KEY": "value" }` |
| **OpenCode** | `opencode.json` / `opencode.jsonc` ([schema](https://opencode.ai/config.json)) | **`"environment": { "KEY": "value" }`** — *not* `"env"`, which is silently ignored |
| **OpenAI Codex CLI** | `~/.codex/config.toml` ([reference](https://developers.openai.com/codex/config-reference/)) | **Nested TOML table** — a `[mcp_servers.NAME.env]` block with `KEY = "value"` lines. Inline `env = { ... }` is *not* the Codex form. |

Worked examples with a few env vars set:

**Standard MCP JSON** — Claude Code, Claude Desktop, Windsurf, Cline, Roo Code, Cursor, VS Code Copilot:

```json
"socraticode": {
  "command": "npx",
  "args": ["-y", "socraticode"],
  "env": {
    "QDRANT_MODE": "external",
    "QDRANT_URL": "https://xyz.qdrant.io"
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
      "command": ["npx", "-y", "socraticode"],
      "enabled": true,
      "environment": {
        "QDRANT_MODE": "external",
        "QDRANT_URL": "https://xyz.qdrant.io"
      }
    }
  }
}
```

**OpenAI Codex CLI** — env vars go in a separate `[mcp_servers.NAME.env]` table:

```toml
[mcp_servers.socraticode]
command = "npx"
args = ["-y", "socraticode"]

[mcp_servers.socraticode.env]
QDRANT_MODE = "external"
QDRANT_URL = "https://xyz.qdrant.io"
```

The rest of this section documents the variables themselves. Pass them using whichever syntax matches your host.

### Embedding Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | `ollama` | Embedding backend: `ollama` (local, default), `openai`, `google`, `lmstudio`, or `litellm` |
| `EMBEDDING_MODEL` | *(per provider)* | Model name. Defaults: `nomic-embed-text` (ollama), `text-embedding-3-small` (openai), `gemini-embedding-001` (google). **Required** for `lmstudio` and `litellm` (no default). |
| `EMBEDDING_DIMENSIONS` | *(per provider)* | Vector dimensions. Defaults: `768` (ollama), `1536` (openai), `3072` (google). **Required** for `lmstudio` and `litellm` (no default; varies per loaded model / proxy alias). |
| `EMBEDDING_CONTEXT_LENGTH` | *(auto-detected)* | Model context window in tokens. Auto-detected for known model names (works for LiteLLM aliases that match the underlying model name). Set manually for custom LM Studio models or arbitrary LiteLLM aliases. |

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
| `EXTENSION_LANGUAGE_MAP` | *(none)* | Comma-separated `extension:language` overrides that make a non-standard extension be treated as a real language end to end (semantic/AST chunking, symbols, call graph), e.g. `EXTENSION_LANGUAGE_MAP=.inc:php,.module:php` for Drupal/PHP. Unlike `EXTRA_EXTENSIONS` (which indexes as plaintext), the mapped extension gets the full language treatment and is auto-discovered without also listing it in `EXTRA_EXTENSIONS`. The target must be a language SocratiCode has an AST grammar for (the Full Support list above plus the AST-graph languages); unknown targets are ignored with a startup warning. Overrides built-in mappings too (e.g. `.h:cpp`). |
| `INDEX_EXTENSIONLESS` | `true` | When enabled (default), files with **no extension** are indexed when their content identifies them as code — a shebang (`#!/bin/bash`, `#!/usr/bin/env python3`, …) or a conservative content sniff (no-shebang Python/shell). A shebang with an unmapped interpreter (perl, awk, make, …) is indexed as searchable plaintext. Binaries (NUL byte in the head) and undetectable text (configs, licenses, data) are never indexed. The real on-disk path is always preserved — only the detected language/grammar is inferred, so `.txt`-detected files stay out of the code graph. Set `false` or `0` to restore the previous behavior (extensionless files indexed only when their exact name is a special file such as `Dockerfile`/`Makefile`). **Writer-consistency:** every process writing to one collection must agree on this flag — a mixed fleet would flap extensionless chunks on alternating runs. |
| `MAX_FILE_SIZE_MB` | `5` | Maximum file size in MB. Files larger than this are skipped during indexing. Increase for repos with large generated or data files you want indexed. |
| `SEARCH_DEFAULT_LIMIT` | `10` | Default number of results returned by `codebase_search` (1-50). Each result is a ranked code chunk with file path, line range, and content. Higher values give broader coverage but produce more output. Can still be overridden per-query via the `limit` tool parameter. |
| `SEARCH_MIN_SCORE` | `0.10` | Minimum score threshold (0-1). Results below this score are filtered out. Helps remove low-relevance noise from search results. Set to `0` to disable filtering (returns all results up to `limit`). Can be overridden per-query via the `minScore` tool parameter. Works together with `limit`: results are first filtered by score, then capped at `limit`. The score is an RRF (Reciprocal Rank Fusion) value for a single-project search, and a cosine similarity for a cross-project one (`includeLinked: true`), which falls back to RRF when a cosine is unavailable for any hit — see Cross-Project Search below for why the scales differ and what that means for this threshold. |
| `SOCRATICODE_PROJECT_ID` | *(none)* | Override the auto-generated project ID. When set, all paths resolve to the same Qdrant collections, allowing multiple directories (e.g. git worktrees of the same repo) to share a single index. Must match `[a-zA-Z0-9_-]+`. Takes precedence over the `projectId` field in `.socraticode.json`. |
| `SOCRATICODE_BRANCH_AWARE` | `false` | When `true`, append the current git branch name to the project ID, creating separate Qdrant collections per branch. Ignored when `SOCRATICODE_PROJECT_ID` is set or when `projectId` is set in `.socraticode.json`. |
| `SOCRATICODE_LINKED_PROJECTS` | *(none)* | Comma-separated list of additional project paths to include in cross-project search. Merged with paths from `.socraticode.json`. Non-existent paths are silently skipped. |
| `SOCRATICODE_AUTO_RESUME` | *(none)* | When set to `all`, server startup auto-resumes the file watcher plus an incremental catch-up update for **every** indexed project that has a stored path, not just the current working directory. Projects resume one at a time (sequentially) to avoid overloading the embedding provider. Skipped projects (directory no longer exists, or indexed before path tracking was added) are logged at warn level. Useful when one MCP server session should keep many canonical checkouts fresh. |
| `SOCRATICODE_AUTO_RESUME_PROJECTS` | *(none)* | Comma-separated list of project paths to auto-resume on server startup (sequentially), e.g. `/repos/api,/repos/web`. Takes precedence over `SOCRATICODE_AUTO_RESUME`. Paths that do not exist or are not indexed are skipped with a warning. |
| `SOCRATICODE_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SOCRATICODE_LOG_FILE` | *(none)* | Absolute path to a log file. When set, all log entries are appended to this file (a session separator is written on each server start). Useful for debugging when the MCP host doesn't surface log notifications. |

> **Important**: If you change `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, or `EMBEDDING_DIMENSIONS` after indexing, you must re-index your projects (`codebase_remove` then `codebase_index`) since existing vectors have different dimensions.

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

SocratiCode has a comprehensive test suite with **634 tests** across unit, integration, and end-to-end layers.

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

| Layer | Tests | Docker? | Description |
|-------|-------|---------|-------------|
| **Unit** (`tests/unit/`) | 477 | No | Config, constants, ignore rules, cross-process locking, logging, graph analysis, import extraction, path resolution, embedding config, indexer utilities, embeddings, startup lifecycle, watcher cross-process awareness |
| **Integration** (`tests/integration/`) | 137 | Yes | Docker/Ollama setup, Qdrant CRUD, real embeddings, indexer, watcher, code graph, all MCP tools |
| **E2E** (`tests/e2e/`) | 20 | Yes | Complete lifecycle: health → index → search → graph → watch → remove  |

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

The file watcher auto-starts on first tool use for any previously indexed project. When it
starts, it catches up all files modified while SocratiCode was down before watching for
future changes.

If you want to force an immediate catch-up before searching, ask your AI to *"start watching
this project"* or *"update the index"* — both run an incremental update synchronously and
then start watching.

The watcher will not auto-start if a full index or incremental update is currently in
progress, if the project has not been indexed yet, or if another MCP process is already
watching the same project.

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

Each collection is created with a fixed vector size matching the model used at index time.
If you change `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, or `EMBEDDING_DIMENSIONS` in your
MCP config, any projects indexed with the old model will return a dimension mismatch error.
Ask your AI to *"remove the index for this project"* and then to index again with the new
model. Projects you haven't touched are unaffected.

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

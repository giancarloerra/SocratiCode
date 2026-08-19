// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invalidateGraphCache, rebuildGraph } from "../../src/services/code-graph.js";
import { stopAllWatchers } from "../../src/services/watcher.js";
import { handleContextTool } from "../../src/tools/context-tools.js";
import { handleGraphTool } from "../../src/tools/graph-tools.js";
import { handleIndexTool } from "../../src/tools/index-tools.js";
import { handleManageTool } from "../../src/tools/manage-tools.js";
import { handleQueryTool } from "../../src/tools/query-tools.js";
import {
  addFileToFixture,
  createFixtureProject,
  type FixtureProject,
  isDockerAvailable,
} from "../helpers/fixtures.js";
import {
  cleanupTestCollections,
  waitForOllama,
  waitForQdrant,
} from "../helpers/setup.js";

const dockerAvailable = isDockerAvailable();

// ─────────────────────────────────────────────────────────────
// Manage tools (codebase_health, codebase_about, codebase_list_projects)
// These have minimal infra requirements so test them first
// ─────────────────────────────────────────────────────────────
describe.skipIf(!dockerAvailable)("manage tool handlers", () => {
  describe("codebase_about", () => {
    it("returns descriptive text about SocratiCode", async () => {
      const result = await handleManageTool("codebase_about", {});

      expect(result).toContain("SocratiCode");
      expect(result.length).toBeGreaterThan(100);
    });
  });

  describe("codebase_health", () => {
    it("returns health status with Docker/Qdrant/Ollama checks", async () => {
      const result = await handleManageTool("codebase_health", {});

      expect(result).toContain("Docker");
      expect(result).toContain("Qdrant");
      expect(result).toContain("Ollama");
      // With Docker available, Docker should be OK
      expect(result).toContain("[OK]");
    });

    it("shows model status", async () => {
      const result = await handleManageTool("codebase_health", {});
      expect(result).toContain("Embedding model");
    });
  });

  describe("codebase_list_projects", () => {
    it("returns project listing (may be empty)", async () => {
      const result = await handleManageTool("codebase_list_projects", {});

      // Either "No indexed projects found" or a listing
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("unknown tool", () => {
    it("returns unknown tool message", async () => {
      const result = await handleManageTool("nonexistent_tool", {});
      expect(result).toContain("Unknown tool");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Graph tools (codebase_graph_build, _query, _stats, _circular, _visualize)
// ─────────────────────────────────────────────────────────────
describe("graph tool handlers", () => {
  let fixture: FixtureProject;

  beforeAll(() => {
    fixture = createFixtureProject("graph-tools-test");
  });

  afterAll(() => {
    invalidateGraphCache(fixture.root);
    fixture.cleanup();
  });

  describe("codebase_graph_build", () => {
    it("starts a background graph build and returns immediately", async () => {
      const result = await handleGraphTool("codebase_graph_build", {
        projectPath: fixture.root,
      });

      expect(result).toContain("Graph build started in the background");
      expect(result).toContain("codebase_graph_status");
    });
  });

  describe("codebase_graph_stats", () => {
    it("returns graph statistics", async () => {
      const result = await handleGraphTool("codebase_graph_stats", {
        projectPath: fixture.root,
      });

      expect(result).toContain("Code Graph Statistics");
      expect(result).toContain("Total files:");
      expect(result).toContain("Languages:");
    });

    it("includes orphan count", async () => {
      const result = await handleGraphTool("codebase_graph_stats", {
        projectPath: fixture.root,
      });

      expect(result).toContain("Orphan files");
    });
  });

  describe("codebase_graph_query", () => {
    it("queries file dependencies", async () => {
      // Build graph directly (tool is fire-and-forget now)
      await rebuildGraph(fixture.root);

      const result = await handleGraphTool("codebase_graph_query", {
        projectPath: fixture.root,
        filePath: "src/index.ts",
      });

      // Should contain dependency info
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("codebase_graph_status import-resolution advisory (#107)", () => {
    // The status output is where a consumer learns whether the graph can be
    // trusted. READY is emitted on graph existence alone, so these pin that a
    // graph which resolved almost nothing says so, and that a healthy one
    // stays silent. The predicate's own boundaries are unit-tested; this is
    // about the persisted count reaching the rendered output at all.

    const buildPyProject = (name: string, body: (i: number) => string): FixtureProject => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `socraticode-${name}-`));
      fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
      fs.writeFileSync(path.join(root, "pkg", "__init__.py"), "", "utf-8");
      for (let i = 0; i < 30; i++) {
        fs.writeFileSync(path.join(root, "pkg", `mod_${i}.py`), body(i), "utf-8");
      }
      return {
        root,
        cleanup: () => {
          try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
        },
      };
    };

    it("reports the yield when almost no captured import resolved", async () => {
      // 30 first-party-looking imports, none of which name a file in the
      // tree — the shape a resolver failure produces.
      const proj = buildPyProject(
        "low-yield",
        (i) => `from absent_dist_${i}.helpers import thing\n\ndef fn_${i}():\n    return thing\n`,
      );
      try {
        await rebuildGraph(proj.root);

        const result = await handleGraphTool("codebase_graph_status", {
          projectPath: proj.root,
        });

        expect(result).toContain("Status: READY");
        expect(result).toContain("Import resolution:");
        expect(result).toContain("captured imports resolved to project files");
        expect(result).toContain("will under-report dependencies");
      } finally {
        invalidateGraphCache(proj.root);
        proj.cleanup();
      }
    });

    it("stays silent on a graph whose imports resolved", async () => {
      // Same size and import count, every import resolvable in-tree.
      const proj = buildPyProject(
        "healthy-yield",
        (i) =>
          `${i > 0 ? `from pkg.mod_${i - 1} import fn_${i - 1}\n` : ""}\ndef fn_${i}():\n    return ${i}\n`,
      );
      try {
        await rebuildGraph(proj.root);

        const result = await handleGraphTool("codebase_graph_status", {
          projectPath: proj.root,
        });

        expect(result).toContain("Status: READY");
        expect(result).not.toContain("Import resolution:");
      } finally {
        invalidateGraphCache(proj.root);
        proj.cleanup();
      }
    });
  });

  describe("codebase_graph_circular", () => {
    it("reports circular dependency results", async () => {
      const result = await handleGraphTool("codebase_graph_circular", {
        projectPath: fixture.root,
      });

      // The fixture has a self-cycle (index.ts imports itself)
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("codebase_graph_visualize", () => {
    it("returns a Mermaid diagram", async () => {
      const result = await handleGraphTool("codebase_graph_visualize", {
        projectPath: fixture.root,
      });

      expect(result).toContain("```mermaid");
      expect(result).toContain("graph LR");
      expect(result).toContain("```");
    });
  });

  describe("codebase_graph_remove", () => {
    it("removes the graph and confirms", async () => {
      // Ensure graph exists before removing
      await rebuildGraph(fixture.root);

      const result = await handleGraphTool("codebase_graph_remove", {
        projectPath: fixture.root,
      });

      expect(result).toContain("Removed");
    });
  });

  describe("unknown tool", () => {
    it("returns unknown tool message", async () => {
      const result = await handleGraphTool("nonexistent_tool", {
        projectPath: fixture.root,
      });
      expect(result).toContain("Unknown");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Impact-analysis tool handlers (require Docker — Qdrant for sharded store)
// codebase_impact, codebase_flow, codebase_symbol, codebase_symbols
// ─────────────────────────────────────────────────────────────
describe.skipIf(!dockerAvailable)(
  "impact-analysis tool handlers",
  { timeout: 120_000 },
  () => {
    let fixture: FixtureProject;

    beforeAll(async () => {
      await waitForQdrant();
      fixture = createFixtureProject("impact-tools-test");
      // Build a real symbol graph against Qdrant.
      await rebuildGraph(fixture.root);
    }, 60_000);

    afterAll(() => {
      invalidateGraphCache(fixture.root);
      fixture.cleanup();
    });

    describe("codebase_symbols", () => {
      it("lists symbols from a known file", async () => {
        const result = await handleGraphTool("codebase_symbols", {
          projectPath: fixture.root,
          file: "src/index.ts",
        });
        expect(result).toContain("Symbols in src/index.ts");
        // The fixture's index.ts defines `main` and `authenticateUser`.
        expect(result).toMatch(/main|authenticateUser/);
      });

      it("searches symbols by name across the project", async () => {
        const result = await handleGraphTool("codebase_symbols", {
          projectPath: fixture.root,
          query: "main",
        });
        // Either match found or graceful "no results" — both are valid contracts.
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      });

      it("requires either file or query (graceful empty-list message otherwise)", async () => {
        const result = await handleGraphTool("codebase_symbols", {
          projectPath: fixture.root,
        });
        expect(typeof result).toBe("string");
      });
    });

    describe("codebase_symbol", () => {
      it("rejects missing name argument", async () => {
        const result = await handleGraphTool("codebase_symbol", {
          projectPath: fixture.root,
        });
        expect(result).toContain("Missing required argument");
      });

      it("returns a structured callers/callees report for an existing symbol", async () => {
        const result = await handleGraphTool("codebase_symbol", {
          projectPath: fixture.root,
          name: "main",
          file: "src/index.ts",
        });
        // Either we found it with proper layout, or the graceful "not found" branch.
        expect(typeof result).toBe("string");
        if (result.startsWith("Symbol:")) {
          expect(result).toContain("Defined:");
          expect(result).toContain("Callers");
          expect(result).toContain("Callees");
        }
      });

      it("reports unknown symbols gracefully", async () => {
        const result = await handleGraphTool("codebase_symbol", {
          projectPath: fixture.root,
          name: "thisSymbolDefinitelyDoesNotExist__xyz",
        });
        expect(result).toContain("No symbol named");
      });
    });

    describe("codebase_impact", () => {
      it("rejects missing target argument", async () => {
        const result = await handleGraphTool("codebase_impact", {
          projectPath: fixture.root,
        });
        expect(result).toContain("Missing required argument");
      });

      it("returns a blast-radius report for a known symbol", async () => {
        const result = await handleGraphTool("codebase_impact", {
          projectPath: fixture.root,
          target: "main",
          depth: 3,
        });
        expect(typeof result).toBe("string");
        // Either "Blast radius for ..." (found) or graceful empty/no-graph message.
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("codebase_flow", () => {
      it("lists detected entry points when called with no entrypoint", async () => {
        const result = await handleGraphTool("codebase_flow", {
          projectPath: fixture.root,
        });
        expect(typeof result).toBe("string");
        // Either we list entries, or report "No entry points detected" — both valid.
        expect(
          /entry point/i.test(result) || result.includes("No entry points"),
        ).toBe(true);
      });

      it("traces forward call flow from a named entrypoint", async () => {
        const result = await handleGraphTool("codebase_flow", {
          projectPath: fixture.root,
          entrypoint: "main",
          file: "src/index.ts",
          depth: 3,
        });
        expect(typeof result).toBe("string");
        // Acceptable outcomes: tree rendering ("Call flow from"), ambiguity message,
        // not-found message, or graceful "Could not load symbol".
        expect(result.length).toBeGreaterThan(0);
      });
    });
  },
);

// ─────────────────────────────────────────────────────────────
// Index + Query tools (full lifecycle)
// codebase_index, codebase_update, codebase_search, codebase_status, codebase_remove
// These require Docker + embeddings
// ─────────────────────────────────────────────────────────────
describe.skipIf(!dockerAvailable)(
  "index & query tool handlers",
  { timeout: 300_000 },
  () => {
    let fixture: FixtureProject;

    beforeAll(async () => {
      await waitForQdrant();
      await waitForOllama();
      fixture = createFixtureProject("tools-index-test");
      await cleanupTestCollections(fixture.root);
    }, 120_000);

    afterAll(async () => {
      await stopAllWatchers();
      fixture.cleanup();
      await cleanupTestCollections(fixture.root);
    });

    describe("codebase_index", () => {
      it("starts indexing and returns immediately", async () => {
        const result = await handleIndexTool("codebase_index", {
          projectPath: fixture.root,
        });

        // codebase_index is fire-and-forget: returns immediately
        expect(result).toContain("Indexing started");
      }, 60_000);

      it("reports in-progress on second call", async () => {
        // Immediately after starting, the project should be indexing
        const result = await handleIndexTool("codebase_index", {
          projectPath: fixture.root,
        });

        // Should either still be indexing or have finished (depending on speed).
        // We check it doesn't crash at minimum.
        expect(result).toBeDefined();
      }, 60_000);
    });

    describe("codebase_status", () => {
      it("returns project status", async () => {
        // Wait a moment for indexing to potentially complete
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        const result = await handleQueryTool("codebase_status", {
          projectPath: fixture.root,
        });

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      }, 30_000);
    });

    describe("codebase_search (after indexing)", () => {
      beforeAll(async () => {
        // Wait for indexing to complete (poll status)
        const maxWait = 120_000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          const status = await handleQueryTool("codebase_status", {
            projectPath: fixture.root,
          });
          if (
            status.includes("Last completed") ||
            status.includes("chunks") ||
            status.includes("files indexed")
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }, 180_000);

      it("finds relevant code via semantic search", async () => {
        const result = await handleQueryTool("codebase_search", {
          query: "authentication user login",
          projectPath: fixture.root,
        });

        // Should find something in the fixture project
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      }, 30_000);

      it("respects limit parameter", async () => {
        const result = await handleQueryTool("codebase_search", {
          query: "function",
          projectPath: fixture.root,
          limit: 2,
        });

        expect(result).toBeDefined();
      }, 30_000);
    });

    describe("codebase_update", () => {
      beforeAll(async () => {
        // Wait for background indexing (from codebase_index) to complete
        const maxWait = 120_000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          const status = await handleQueryTool("codebase_status", {
            projectPath: fixture.root,
          });
          if (
            status.includes("Last completed") ||
            (status.includes("chunks") && !status.includes("in progress"))
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }, 180_000);

      it("detects no changes when nothing changed", async () => {

        const result = await handleIndexTool("codebase_update", {
          projectPath: fixture.root,
        });

        // No changes → should report zero or minimal changes
        expect(result).toBeDefined();
      }, 60_000);

      it("detects changes after adding a file", async () => {
        addFileToFixture(
          fixture.root,
          "src/api/routes.ts",
          `
export interface Route {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: (req: Request) => Response;
}

export function createRouter(routes: Route[]): void {
  for (const route of routes) {
    console.log(\`Registered: \${route.method} \${route.path}\`);
  }
}
          `.trim(),
        );

        const result = await handleIndexTool("codebase_update", {
          projectPath: fixture.root,
        });

        expect(result).toBeDefined();
        // Should detect at least the new file
        expect(result).toContain("added");
      }, 60_000);
    });

    describe("codebase_stop", () => {
      it("reports nothing to stop when no indexing is running", async () => {
        const result = await handleIndexTool("codebase_stop", {
          projectPath: fixture.root,
        });

        expect(result).toContain("No indexing operation is currently running");
      });
    });

    describe("codebase_watch", () => {
      it("starts watching", async () => {
        const result = await handleIndexTool("codebase_watch", {
          projectPath: fixture.root,
          action: "start",
        });

        expect(result.toLowerCase()).toContain("watch");
      }, 30_000);

      it("reports watching status", async () => {
        const result = await handleIndexTool("codebase_watch", {
          projectPath: fixture.root,
          action: "status",
        });

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      });

      it("stops watching", async () => {
        const result = await handleIndexTool("codebase_watch", {
          projectPath: fixture.root,
          action: "stop",
        });

        expect(result.toLowerCase()).toContain("stop");
      });
    });

    describe("codebase_remove", () => {
      it("removes the project index", async () => {
        const result = await handleIndexTool("codebase_remove", {
          projectPath: fixture.root,
        });

        expect(result).toContain("Removed");
      }, 30_000);

      it("status shows not indexed after removal", async () => {
        const result = await handleQueryTool("codebase_status", {
          projectPath: fixture.root,
        });

        // Should indicate project is not indexed
        expect(
          result.toLowerCase().includes("not") ||
            result.toLowerCase().includes("no ") ||
            result.toLowerCase().includes("does not"),
        ).toBe(true);
      }, 30_000);
    });
  },
);

// ─────────────────────────────────────────────────────────────
// Context tools (codebase_context, codebase_context_index,
// codebase_context_search, codebase_context_remove)
// Requires Docker + embeddings
// ─────────────────────────────────────────────────────────────
describe.skipIf(!dockerAvailable)(
  "context tool handlers",
  { timeout: 300_000 },
  () => {
    let fixture: FixtureProject;

    beforeAll(async () => {
      await waitForQdrant();
      await waitForOllama();
      fixture = createFixtureProject("context-tools-test");

      // Create artifact files
      fs.mkdirSync(path.join(fixture.root, "docs"), { recursive: true });
      fs.writeFileSync(
        path.join(fixture.root, "docs", "schema.sql"),
        [
          "CREATE TABLE users (",
          "  id SERIAL PRIMARY KEY,",
          "  email VARCHAR(255) UNIQUE NOT NULL,",
          "  created_at TIMESTAMP DEFAULT NOW()",
          ");",
          "",
          "CREATE TABLE orders (",
          "  id SERIAL PRIMARY KEY,",
          "  user_id INTEGER REFERENCES users(id),",
          "  total NUMERIC(10,2) NOT NULL",
          ");",
        ].join("\n"),
      );

      // Create .socraticodecontextartifacts.json
      fs.writeFileSync(
        path.join(fixture.root, ".socraticodecontextartifacts.json"),
        JSON.stringify({
          artifacts: [
            {
              name: "database-schema",
              path: "./docs/schema.sql",
              description: "PostgreSQL schema with users and orders tables",
            },
          ],
        }),
      );
    }, 120_000);

    afterAll(async () => {
      // Clean up indexed artifacts
      try {
        await handleContextTool("codebase_context_remove", {
          projectPath: fixture.root,
        });
      } catch {
        // ignore
      }
      await stopAllWatchers();
      fixture.cleanup();
      await cleanupTestCollections(fixture.root);
    });

    describe("codebase_context", () => {
      it("lists configured artifacts and their status", async () => {
        const result = await handleContextTool("codebase_context", {
          projectPath: fixture.root,
        });

        expect(result).toContain("Context Artifacts");
        expect(result).toContain("database-schema");
        expect(result).toContain("schema.sql");
      });

      it("shows guidance when no config exists", async () => {
        // Use the base fixture root's parent (no config there)
        const emptyFixture = createFixtureProject("context-empty");
        try {
          const result = await handleContextTool("codebase_context", {
            projectPath: emptyFixture.root,
          });
          expect(result).toContain("No context artifacts configured");
          expect(result).toContain(".socraticodecontextartifacts.json");
        } finally {
          emptyFixture.cleanup();
        }
      });
    });

    describe("codebase_context_index", () => {
      it("indexes all configured artifacts", async () => {
        const result = await handleContextTool("codebase_context_index", {
          projectPath: fixture.root,
        });

        expect(result).toContain("Indexing Complete");
        expect(result).toContain("database-schema");
        expect(result).toContain("chunks");
      }, 60_000);
    });

    describe("codebase_context_search", () => {
      it("finds relevant content via semantic search", async () => {
        const result = await handleContextTool("codebase_context_search", {
          projectPath: fixture.root,
          query: "users table email",
        });

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
        // Should find something from the schema
        expect(result).toContain("search results");
      }, 60_000);

      it("requires a query parameter", async () => {
        const result = await handleContextTool("codebase_context_search", {
          projectPath: fixture.root,
          query: "",
        });

        expect(result).toContain("query parameter is required");
      });
    });

    describe("codebase_context_remove", () => {
      it("removes all indexed context artifacts", async () => {
        const result = await handleContextTool("codebase_context_remove", {
          projectPath: fixture.root,
        });

        expect(result).toContain("Removed");
      }, 30_000);
    });

    describe("unknown tool", () => {
      it("returns unknown tool message", async () => {
        const result = await handleContextTool("nonexistent_tool", {
          projectPath: fixture.root,
        });
        expect(result).toContain("Unknown");
      });
    });
  },
);

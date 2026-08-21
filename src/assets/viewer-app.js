/* SocratiCode interactive graph viewer — app logic
 * Loaded after Cytoscape + Dagre + cytoscape-dagre are on window.
 * Reads embedded graph data from window.__SOCRATICODE_DATA__.
 *
 * All DOM rendering uses createElement + textContent for XSS safety — no
 * innerHTML is used anywhere, so data fields with HTML-looking content
 * (rare but possible in symbol names) cannot escape into markup.
 */
(function () {
  "use strict";

  const DATA = window.__SOCRATICODE_DATA__;
  if (!DATA) throw new Error("Missing __SOCRATICODE_DATA__");

  // Language → colour palette (kept in sync with Mermaid generator)
  const LANG_COLORS = {
    typescript: "#3178C6", javascript: "#F7DF1E", python: "#3776AB",
    java: "#ED8B00", kotlin: "#7F52FF", go: "#00ADD8",
    rust: "#CE422B", ruby: "#CC342D", php: "#777BB4",
    swift: "#FA7343", c: "#A8B9CC", cpp: "#00599C",
    csharp: "#239120", scala: "#DC322F", dart: "#0175C2",
    elixir: "#4B275F", lua: "#2C2D72", shell: "#4EAA25", html: "#E34F26",
    css: "#1572B6", json: "#808080",
  };
  const FALLBACK_COLOR = "#607D8B";
  const colourFor = (lang) => LANG_COLORS[lang] || FALLBACK_COLOR;

  // Symbol-kind → colour
  const KIND_COLORS = {
    function: "#3b82f6", class: "#a855f7", method: "#06b6d4",
    constructor: "#0891b2", interface: "#f59e0b", trait: "#f59e0b",
    enum: "#ec4899", module: "#6b7280", struct: "#a855f7", variable: "#84cc16",
  };

  // ── Tiny DOM builder (XSS-safe — all text via textContent) ───────
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k.startsWith("data-")) el.setAttribute(k, String(v));
        else if (k === "title") el.title = String(v);
        else if (k === "disabled") el.disabled = true;
        else el[k] = v;
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  // ── Register layouts ──────────────────────────────────────────────
  if (window.cytoscapeDagre) window.cytoscapeDagre(cytoscape);

  // ── Build Cytoscape elements from data ───────────────────────────
  const FILE_NODES = DATA.files.map((f) => ({
    group: "nodes",
    data: {
      id: `f::${f.id}`,
      label: f.label,
      nodeType: "file",
      file: f.id,
      language: f.language,
      deps: f.deps,
      dependents: f.dependents,
      symbolCount: f.symbolCount || 0,
    },
  }));
  const FILE_EDGES = DATA.fileEdges.map((e, i) => ({
    group: "edges",
    data: {
      id: `fe${i}`,
      source: `f::${e.source}`,
      target: `f::${e.target}`,
      edgeType: e.type,
      cyclic: e.cyclic,
      scope: "file",
    },
    classes: `${e.cyclic ? "cyclic" : ""} ${e.type === "dynamic-import" ? "dynamic" : ""}`.trim(),
  }));

  // Symbol-side indices — Symbol view is a FOCUS graph that builds on
  // demand, not a pre-rendered global graph. These lookup maps let
  // setSymbolSeed() compute a 2-hop neighbourhood around any symbol in
  // O(neighbours) time without touching Cytoscape.
  const SYMBOL_BY_ID = new Map();
  for (const s of DATA.symbols || []) SYMBOL_BY_ID.set(s.id, s);
  const OUTGOING_BY_CALLER = new Map();
  const INCOMING_BY_CALLEE = new Map();
  for (const e of DATA.symbolEdges || []) {
    if (!OUTGOING_BY_CALLER.has(e.source)) OUTGOING_BY_CALLER.set(e.source, []);
    OUTGOING_BY_CALLER.get(e.source).push(e);
    if (!INCOMING_BY_CALLEE.has(e.target)) INCOMING_BY_CALLEE.set(e.target, []);
    INCOMING_BY_CALLEE.get(e.target).push(e);
  }

  /** Stable pastel colour derived from a file path — used as border
   *  colour on symbol nodes so users can eyeball "which symbols live in
   *  the same file" even when nodes are small. */
  function fileBorderColor(filePath) {
    if (!filePath) return "#0f172a";
    let h = 5381;
    for (let i = 0; i < filePath.length; i++) h = ((h << 5) + h + filePath.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360}, 55%, 45%)`;
  }

  // Hide labels below this zoom (too cluttered with 100+ nodes rendered at
  // full zoom-out). Selected / neighbour nodes always show their label
  // via explicit overrides in the stylesheet.
  // NOTE: both this constant and `currentZoom` MUST be declared before the
  // STYLE array — Cytoscape evaluates the label closures during the cy()
  // constructor call, which happens before any `const` below it binds. A
  // forward reference would hit the temporal dead zone and blank the graph.
  const LABEL_ZOOM_THRESHOLD = 0.55;

  // Tracked zoom state — a plain variable readable from the style
  // functions below, which run inside the cytoscape() constructor call
  // before `cy` itself is bound. Using `cy.zoom()` inside those closures
  // would hit the TDZ (`Cannot access 'cy' before initialization`) the
  // very first time Cytoscape styles the initial elements.
  let currentZoom = 1;

  // ── Cytoscape style ──────────────────────────────────────────────
  const STYLE = [
    {
      selector: 'node[nodeType = "file"]',
      style: {
        "background-color": (ele) => colourFor(ele.data("language")),
        // Hide label below threshold unless the node is selected/highlighted.
        "label": (ele) => (currentZoom >= LABEL_ZOOM_THRESHOLD || ele.hasClass("always-label")) ? ele.data("label") : "",
        "font-size": 10, "color": "#1f2937", "text-valign": "bottom",
        "text-margin-y": 4, "text-background-color": "#fff",
        "text-background-opacity": 0.8, "text-background-padding": 2,
        "width": (ele) => 14 + Math.min(30, (ele.data("dependents") || 0) * 2),
        "height": (ele) => 14 + Math.min(30, (ele.data("dependents") || 0) * 2),
        "border-width": 1, "border-color": "#0f172a",
      },
    },
    {
      selector: 'node[nodeType = "symbol"]',
      style: {
        "background-color": (ele) => KIND_COLORS[ele.data("kind")] || "#64748b",
        "label": (ele) => (currentZoom >= LABEL_ZOOM_THRESHOLD || ele.hasClass("always-label") || ele.hasClass("seed")) ? ele.data("label") : "",
        "font-size": 10, "color": "#1f2937", "text-valign": "bottom",
        "text-margin-y": 4, "shape": "round-rectangle",
        "width": 44, "height": 20,
        // Border colour encodes the symbol's file — "light" compound-node
        // behaviour without actual nesting. Same file → same border.
        "border-width": 2, "border-color": (ele) => fileBorderColor(ele.data("file")),
      },
    },
    // The focus-graph seed — the symbol the user searched for / clicked
    // into. Bigger, pinned-label, distinctive ring so it's obvious which
    // node is the anchor.
    {
      selector: 'node[nodeType = "symbol"].seed',
      style: {
        "width": 64, "height": 28,
        "border-width": 4, "border-color": "#f59e0b",
        "font-size": 12, "font-weight": 600,
        "z-index": 1001,
      },
    },
    {
      selector: "edge",
      style: {
        "width": 1.5, "line-color": "#cbd5e1",
        "target-arrow-color": "#cbd5e1", "target-arrow-shape": "triangle",
        "curve-style": "bezier", "arrow-scale": 0.8,
      },
    },
    { selector: "edge.dynamic", style: { "line-style": "dashed" } },
    { selector: "edge.cyclic", style: { "line-color": "#dc2626", "target-arrow-color": "#dc2626", "width": 2.5, "line-style": "dashed" } },
    { selector: "edge.conf-multiple-candidates", style: { "line-style": "dashed", "line-color": "#a78bfa", "target-arrow-color": "#a78bfa" } },
    { selector: "edge.conf-unresolved", style: { "line-style": "dotted", "line-color": "#94a3b8", "target-arrow-color": "#94a3b8" } },
    { selector: ".faded", style: { "opacity": 0.15, "text-opacity": 0.1 } },
    {
      selector: ".highlight",
      style: {
        "background-color": "#ef4444", "border-color": "#991b1b",
        "border-width": 2, "z-index": 999,
      },
    },
    {
      selector: ".highlight-flow",
      style: {
        "background-color": "#3b82f6", "border-color": "#1e40af",
        "border-width": 2, "z-index": 999,
      },
    },
    { selector: "edge.highlight-edge", style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", "width": 3, "z-index": 999 } },
    { selector: "edge.highlight-flow-edge", style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", "width": 3, "z-index": 999 } },
    // Plain node-click neighbourhood highlight (less aggressive than blast
    // radius; just surfaces a node's direct imports + dependents).
    { selector: ".highlight-selected", style: { "background-color": "#2563eb", "border-color": "#1e40af", "border-width": 3, "z-index": 1000 } },
    { selector: ".highlight-neighbour", style: { "border-color": "#2563eb", "border-width": 2, "z-index": 998 } },
    { selector: "edge.highlight-neighbour-edge", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", "width": 2.5, "z-index": 998 } },
    // Force-show label on the currently-selected node and its neighbours.
    { selector: ".always-label", style: { "text-opacity": 1 } },
  ];

  // ── Instantiate Cytoscape ────────────────────────────────────────
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [...FILE_NODES, ...FILE_EDGES],
    style: STYLE,
    wheelSensitivity: 0.2,
    minZoom: 0.1,
    maxZoom: 3,
    // Disable single-click drag: trackpad "clicks" always have some motion,
    // which Cytoscape's default interprets as a node grab. This is an
    // exploration viewer — users tap to inspect, not to rearrange.
    autoungrabify: true,
    // Disable box (rectangle) selection to avoid accidental selections.
    boxSelectionEnabled: false,
  });

  // ── Layout runner ────────────────────────────────────────────────
  let currentView = "files";
  // Default to Dagre TB for small graphs (clean layered look) and Dagre
  // for large graphs too. Cose is available but not default — it's non-
  // deterministic and looks chaotic on dense code dep graphs.
  let currentLayout = "dagre";

  // Per-view cached positions — restored when switching back to a view so
  // "files → symbols → files" lands back on the same layout the user had.
  const savedPositions = { files: null, symbols: null };

  function capturePositions() {
    const map = {};
    cy.nodes().forEach((n) => { map[n.id()] = { ...n.position() }; });
    savedPositions[currentView] = map;
  }

  function restorePositions(map) {
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const p = map[n.id()];
        if (p) n.position(p);
      });
    });
    cy.fit(undefined, 50);
    if (cy.zoom() > 1.4) cy.zoom({ level: 1.4, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  function runLayout(name) {
    currentLayout = name;
    const n = cy.nodes().length;
    const opts = { name, animate: n < 200, animationDuration: 250, fit: true, padding: 50 };
    if (name === "dagre") {
      // TB (top-bottom) reads better than LR for code graphs because the
      // dependency chain is typically shallow but fan-in is wide.
      opts.rankDir = "TB";
      opts.nodeSep = 28;
      opts.rankSep = 80;
      opts.edgeSep = 14;
    }
    if (name === "concentric") {
      opts.concentric = (node) => node.degree();
      opts.levelWidth = () => 2;
      opts.minNodeSpacing = 30;
    }
    if (name === "breadthfirst") {
      opts.directed = true;
      opts.spacingFactor = 1.4;
    }
    const layout = cy.layout(opts);
    layout.one("layoutstop", () => {
      // Cap zoom after auto-fit so we never start in an absurd view.
      if (cy.zoom() > 1.4) cy.zoom({ level: 1.4, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      capturePositions();
    });
    layout.run();
  }

  // Symbol focus-graph state — the id of the symbol the view is currently
  // anchored on. `null` = empty state (no seed picked yet).
  let symbolSeedId = null;

  // ── View toggle ──────────────────────────────────────────────────
  function switchView(next) {
    if (next === currentView) return;

    // Snapshot the view we're leaving (only the Files view uses saved
    // positions — Symbols view is seeded on every entry).
    if (currentView === "files") capturePositions();

    currentView = next;
    clearHighlights();
    closeSidebar();

    document.querySelectorAll(".view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === next));

    if (next === "files") {
      cy.elements().remove();
      cy.add([...FILE_NODES, ...FILE_EDGES]);
      hideSymbolEmptyState();
      if (savedPositions.files) restorePositions(savedPositions.files);
      else runLayout(currentLayout);
      return;
    }

    // Symbols view — focus graph.
    if (symbolSeedId && SYMBOL_BY_ID.has(symbolSeedId)) {
      // Re-seed with the last-used symbol so toggling back feels continuous.
      setSymbolSeed(symbolSeedId);
    } else {
      cy.elements().remove();
      showSymbolEmptyState();
    }
  }

  // ── Symbol focus graph ───────────────────────────────────────────
  /** BFS a bounded neighbourhood around `seedId`, capping total size so
   *  the focus graph stays readable. Follows both directions:
   *  callers (incoming) and callees (outgoing) alike. */
  function buildSymbolNeighbourhood(seedId, maxDepth) {
    if (!SYMBOL_BY_ID.has(seedId)) return new Set();
    const visited = new Set([seedId]);
    const queue = [[seedId, 0]];
    while (queue.length) {
      const [id, depth] = queue.shift();
      if (depth >= maxDepth) continue;
      for (const e of OUTGOING_BY_CALLER.get(id) || []) {
        if (!visited.has(e.target)) { visited.add(e.target); queue.push([e.target, depth + 1]); }
      }
      for (const e of INCOMING_BY_CALLEE.get(id) || []) {
        if (!visited.has(e.source)) { visited.add(e.source); queue.push([e.source, depth + 1]); }
      }
    }
    return visited;
  }

  function setSymbolSeed(seedId) {
    if (!SYMBOL_BY_ID.has(seedId)) {
      showSymbolEmptyState(`Symbol not found: ${seedId}`);
      return;
    }
    symbolSeedId = seedId;

    // Make sure we're in Symbols view regardless of where the call came
    // from. If we're coming from Files, capture its positions BEFORE we
    // switch so toggling back to Files lands on the same layout.
    if (currentView !== "symbols") {
      if (currentView === "files") capturePositions();
      currentView = "symbols";
      document.querySelectorAll(".view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === "symbols"));
    }

    // Depth 2 by default; fall back to depth 1 if the neighbourhood
    // explodes (popular utility symbols can have hundreds of callers).
    let visited = buildSymbolNeighbourhood(seedId, 2);
    if (visited.size > 60) visited = buildSymbolNeighbourhood(seedId, 1);

    // Build Cytoscape elements for exactly this neighbourhood.
    const nodes = [];
    for (const id of visited) {
      const s = SYMBOL_BY_ID.get(id);
      if (!s) continue;
      nodes.push({
        group: "nodes",
        data: { id: `s::${s.id}`, label: s.name, nodeType: "symbol", qualifiedName: s.qualifiedName, kind: s.kind, file: s.file, line: s.line },
        classes: id === seedId ? "seed always-label" : "",
      });
    }
    const edges = [];
    let edgeCounter = 0;
    for (const e of DATA.symbolEdges || []) {
      if (visited.has(e.source) && visited.has(e.target)) {
        edges.push({
          group: "edges",
          data: { id: `se-${edgeCounter++}`, source: `s::${e.source}`, target: `s::${e.target}`, confidence: e.confidence, scope: "symbol" },
          classes: `conf-${e.confidence}`,
        });
      }
    }

    clearHighlights();
    cy.elements().remove();
    if (nodes.length <= 1 && edges.length === 0) {
      // Seed has no connections — show the seed alone with an explanation.
      if (nodes.length === 1) cy.add(nodes);
      showSymbolEmptyState(`${SYMBOL_BY_ID.get(seedId).name} has no resolved callers or callees in this project.`);
      return;
    }
    hideSymbolEmptyState();
    cy.add([...nodes, ...edges]);
    runLayout("dagre");
    openSymbol(seedId);
  }

  function showSymbolEmptyState(msg) {
    const el = document.getElementById("symbol-empty");
    if (!el) return;
    el.style.display = "flex";
    if (msg) {
      const p = el.querySelector("[data-msg]");
      if (p) p.textContent = msg;
    }
  }
  function hideSymbolEmptyState() {
    const el = document.getElementById("symbol-empty");
    if (el) el.style.display = "none";
  }

  // ── Highlighting ─────────────────────────────────────────────────
  function clearHighlights() {
    cy.elements().removeClass("faded highlight highlight-flow highlight-edge highlight-flow-edge highlight-selected highlight-neighbour highlight-neighbour-edge always-label");
  }

  /**
   * Default highlight on node tap: the tapped node + its direct
   * incomers/outgoers. Less aggressive than "Blast radius" (transitive),
   * just surfaces what's wired directly to this node.
   */
  function highlightNeighbourhood(rootId) {
    clearHighlights();
    const root = cy.getElementById(rootId);
    if (root.empty()) return;
    const neighbourhood = root.closedNeighborhood();
    cy.elements().difference(neighbourhood).addClass("faded");
    root.addClass("highlight-selected always-label");
    neighbourhood.nodes().difference(root).addClass("highlight-neighbour always-label");
    neighbourhood.edges().addClass("highlight-neighbour-edge");
  }

  function bfsHighlight(rootId, direction) {
    clearHighlights();
    const root = cy.getElementById(rootId);
    if (root.empty()) return;
    const visited = new Set([rootId]);
    const queue = [rootId];
    const edges = [];
    while (queue.length) {
      const id = queue.shift();
      const neighbours = direction === "reverse" ? cy.getElementById(id).incomers() : cy.getElementById(id).outgoers();
      neighbours.edges().forEach((e) => edges.push(e.id()));
      neighbours.nodes().forEach((n) => { if (!visited.has(n.id())) { visited.add(n.id()); queue.push(n.id()); } });
    }
    cy.elements().addClass("faded");
    const nodeClass = direction === "reverse" ? "highlight" : "highlight-flow";
    const edgeClass = direction === "reverse" ? "highlight-edge" : "highlight-flow-edge";
    visited.forEach((id) => cy.getElementById(id).removeClass("faded").addClass(nodeClass));
    edges.forEach((id) => cy.getElementById(id).removeClass("faded").addClass(edgeClass));
  }
  const highlightImpact = (id) => bfsHighlight(id, "reverse");
  const highlightFlow = (id) => bfsHighlight(id, "forward");

  // ── Sidebar (safe DOM builders — no innerHTML) ───────────────────
  const sidebar = document.getElementById("sidebar");

  function clearSidebar() { while (sidebar.firstChild) sidebar.removeChild(sidebar.firstChild); }

  /**
   * Reset the sidebar to its default state for the current view:
   *  - Files view                  → "click a node" hint
   *  - Symbols view with no seed   → alphabetical list of all symbols
   *                                   (so the page isn't blank and users
   *                                   have something to start from)
   *  - Symbols view with a seed    → called rarely; same hint as Files
   */
  function closeSidebar() {
    clearSidebar();
    if (currentView === "symbols" && !symbolSeedId) {
      renderSymbolList();
      return;
    }
    sidebar.className = "empty";
    sidebar.appendChild(document.createTextNode("Click a node to see details"));
  }

  /** Alphabetical list of all symbols — the landing-state sidebar for
   *  Symbol view. Clicking any row seeds the focus graph on that symbol
   *  (handled by the existing `li[data-symbol-id]` handler below). */
  function renderSymbolList() {
    clearSidebar();
    sidebar.className = "list";
    const symbols = DATA.symbols || [];
    sidebar.appendChild(h("h2", null, "All symbols"));
    sidebar.appendChild(h("div", { class: "list-count" },
      `${symbols.length} symbols — click to explore, or type in the search bar to jump to one.`));

    const sorted = [...symbols].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const ul = h("ul", null);
    for (const s of sorted) {
      const basename = (s.file || "").split("/").pop() || s.file || "";
      const li = h("li", { "data-symbol-id": s.id, title: `${s.qualifiedName} @ ${s.file}:${s.line}` },
        h("span", { style: `color:${KIND_COLORS[s.kind] || "#64748b"};font-weight:600;` }, s.kind),
        " ",
        s.name,
        h("span", { class: "file-suffix" }, basename),
      );
      ul.appendChild(li);
    }
    sidebar.appendChild(ul);
  }

  /** Explicit clear for the focus graph — used by the "Back to symbol
   *  list" link in openSymbol's sidebar output. Resets seed, removes the
   *  graph, shows the empty-state overlay + list. */
  function clearSymbolSeed() {
    symbolSeedId = null;
    clearHighlights();
    cy.elements().remove();
    showSymbolEmptyState();
    closeSidebar(); // re-renders the list because seed is null
  }

  function actionBar(nodeId) {
    return h("div", { class: "actions" },
      h("button", { "data-action": "impact", "data-id": nodeId }, "Blast radius"),
      h("button", { class: "flow", "data-action": "flow", "data-id": nodeId }, "Call flow"),
      h("button", { class: "reset", "data-action": "reset" }, "Clear"),
    );
  }

  function metaRow(label, value) {
    return h("div", { class: "meta" }, h("strong", null, `${label}: `), String(value));
  }

  function openFile(id) {
    const file = DATA.files.find((f) => f.id === id);
    if (!file) return closeSidebar();
    const color = colourFor(file.language);
    const syms = (DATA.symbolsByFile && DATA.symbolsByFile[id]) || [];
    const preview = syms.slice(0, 30);

    clearSidebar();
    sidebar.className = "";
    sidebar.appendChild(h("h2", null, file.label));
    sidebar.appendChild(h("div", { style: "font-size:11px;color:#6b7280;margin-bottom:8px;word-break:break-all;" }, file.id));
    sidebar.appendChild(h("span", { class: "lang-badge", style: `background:${color}` }, file.language));

    const connections = h("div", { class: "section" },
      h("h3", null, "Connections"),
      h("div", { class: "meta" },
        "imports: ", h("strong", null, String(file.deps)),
        " · imported by: ", h("strong", null, String(file.dependents)),
        " · symbols: ", h("strong", null, String(file.symbolCount || 0)),
      ),
    );
    sidebar.appendChild(connections);

    if (syms.length > 0) {
      const section = h("div", { class: "section" },
        h("h3", null, `Symbols (${syms.length})`),
      );
      const ul = h("ul", null);
      for (const s of preview) {
        const li = h("li", { "data-symbol-id": s.id, title: `${s.qualifiedName}:${s.line}` },
          h("span", { style: `color:${KIND_COLORS[s.kind] || "#64748b"};font-weight:600;` }, s.kind),
          " ",
          s.name,
          h("span", { style: "color:#94a3b8" }, `:${s.line}`),
        );
        ul.appendChild(li);
      }
      section.appendChild(ul);
      if (syms.length > preview.length) {
        section.appendChild(h("div", { style: "color:#9ca3af;font-size:11px;margin-top:4px" },
          `+ ${syms.length - preview.length} more — use codebase_symbols to list all`));
      }
      sidebar.appendChild(section);
    }

    sidebar.appendChild(actionBar(`f::${file.id}`));
  }

  function openSymbol(id) {
    const sym = (DATA.symbols || []).find((s) => s.id === id);
    if (!sym) return closeSidebar();
    clearSidebar();
    sidebar.className = "";
    // Back link at the top — the deliberate way out of the focus graph,
    // visible in the one place users look when they want to exit (top of
    // the sidebar). Clicking empty canvas no longer hides this.
    if (currentView === "symbols") {
      sidebar.appendChild(h("button", { class: "back-btn", "data-action": "back-to-list" }, "← Back to symbol list"));
    }
    sidebar.appendChild(h("h2", null, sym.name));
    sidebar.appendChild(h("span", { class: "kind-badge" }, sym.kind));
    sidebar.appendChild(metaRow("Qualified", sym.qualifiedName));
    sidebar.appendChild(h("div", { class: "meta" }, h("strong", null, "File: "), h("code", null, sym.file)));
    sidebar.appendChild(metaRow("Line", sym.line));
    sidebar.appendChild(actionBar(`s::${sym.id}`));
  }

  // ── Event wiring ─────────────────────────────────────────────────
  cy.on("tap", "node", (evt) => {
    const n = evt.target;
    if (n.data("nodeType") === "file") {
      // File view: highlight the direct neighbourhood + open sidebar.
      highlightNeighbourhood(n.id());
      openFile(n.data("file"));
    } else {
      // Symbol view: clicking a non-seed node RE-CENTRES the focus graph
      // on that symbol (SourceTrail-style exploration). Clicking the
      // current seed just refreshes the sidebar.
      const symId = n.id().slice(3);
      if (symId !== symbolSeedId) {
        setSymbolSeed(symId);
      } else {
        openSymbol(symId);
      }
    }
  });
  // Empty-canvas tap — clears highlights. In Symbol view with an active
  // seed we deliberately DO NOT close the sidebar, so the "Back to symbol
  // list" link stays visible (accidental-click-destroys-context is a
  // common graph-viewer anti-pattern).
  cy.on("tap", (evt) => {
    if (evt.target !== cy) return;
    clearHighlights();
    if (currentView === "symbols" && symbolSeedId) return; // keep sidebar
    closeSidebar();
  });

  // Keep the `currentZoom` module variable in sync and re-render labels
  // when it crosses the threshold (the style functions read it).
  currentZoom = cy.zoom();
  let lastLabelState = currentZoom >= LABEL_ZOOM_THRESHOLD;
  cy.on("zoom", () => {
    currentZoom = cy.zoom();
    const state = currentZoom >= LABEL_ZOOM_THRESHOLD;
    if (state !== lastLabelState) {
      lastLabelState = state;
      cy.style().update();
    }
  });

  sidebar.addEventListener("click", (evt) => {
    const btn = evt.target.closest("button[data-action]");
    if (btn) {
      const action = btn.dataset.action;
      if (action === "impact") highlightImpact(btn.dataset.id);
      else if (action === "flow") highlightFlow(btn.dataset.id);
      else if (action === "reset") clearHighlights();
      else if (action === "back-to-list") clearSymbolSeed();
      return;
    }
    // Clicking a symbol in either (a) a file's sidebar list in File view,
    // or (b) the all-symbols list in Symbol empty state, seeds the focus
    // graph on that symbol. Same action inside Symbol view re-centres.
    const li = evt.target.closest("li[data-symbol-id]");
    if (li) setSymbolSeed(li.dataset.symbolId);
  });

  // ── Toolbar wiring ───────────────────────────────────────────────
  document.getElementById("layout").addEventListener("change", (e) => runLayout(e.target.value));
  document.querySelectorAll(".view-toggle button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  document.getElementById("fit").addEventListener("click", () => cy.fit(undefined, 30));
  document.getElementById("reset").addEventListener("click", () => { clearHighlights(); closeSidebar(); cy.fit(undefined, 30); });
  document.getElementById("export").addEventListener("click", () => {
    const png = cy.png({ full: true, scale: 2, bg: "#f8fafc" });
    const a = document.createElement("a");
    // Sanitise the project name for cross-platform filesystem safety:
    // strip characters forbidden on Windows (<>:"/\\|?*), control chars,
    // collapse whitespace, cap length, and fall back to "graph" if empty.
    const rawName = String(DATA.project.name || "graph");
    const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 120) || "graph";
    a.href = png; a.download = `${safeName}.png`; a.click();
  });

  // ── Live search ──────────────────────────────────────────────────
  // File view  → live-filter visible file nodes, highlight + fit matches.
  // Symbol view → debounced search across ALL symbols (not just what's
  //               on screen); best match seeds the focus graph.
  let searchDebounce = null;
  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();

    if (currentView === "files") {
      clearHighlights();
      if (!q) return;
      const matches = cy.nodes().filter((n) => {
        const label = (n.data("label") || "").toLowerCase();
        const file = (n.data("file") || "").toLowerCase();
        return label.includes(q) || file.includes(q);
      });
      if (matches.length === 0) return;
      cy.elements().addClass("faded");
      matches.removeClass("faded").addClass("highlight");
      if (matches.length <= 20) cy.animate({ fit: { eles: matches, padding: 80 } }, { duration: 300 });
      return;
    }

    // Symbols view: debounce so we don't re-layout on every keystroke.
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!q) { if (!symbolSeedId) showSymbolEmptyState(); return; }
    searchDebounce = setTimeout(() => {
      // Prefer exact name match, then qualified-name match, then substring.
      const symbols = DATA.symbols || [];
      const exact = symbols.find((s) => s.name.toLowerCase() === q);
      const qname = exact || symbols.find((s) => s.qualifiedName.toLowerCase() === q);
      const sub = qname || symbols.find((s) =>
        s.name.toLowerCase().includes(q) || s.qualifiedName.toLowerCase().includes(q),
      );
      if (sub) setSymbolSeed(sub.id);
      else showSymbolEmptyState(`No symbol matching "${q}".`);
    }, 250);
  });

  // ── Tooltip on hover ─────────────────────────────────────────────
  const tooltip = document.getElementById("tooltip");
  cy.on("mouseover", "node", (evt) => {
    const n = evt.target;
    const pos = evt.renderedPosition || n.renderedPosition();
    tooltip.textContent = n.data("nodeType") === "file"
      ? `${n.data("file")} — ${n.data("language")}`
      : `${n.data("qualifiedName")} — ${n.data("kind")} @ ${n.data("file")}:${n.data("line")}`;
    tooltip.style.left = `${pos.x + 14}px`;
    tooltip.style.top = `${pos.y + 14}px`;
    tooltip.style.opacity = "1";
  });
  cy.on("mouseout", "node", () => { tooltip.style.opacity = "0"; });

  // Right-click node → blast radius
  cy.on("cxttap", "node", (evt) => highlightImpact(evt.target.id()));

  // ── Symbols-unavailable banner ───────────────────────────────────
  const banner = document.getElementById("banner");
  if (DATA.symbolMode !== "full") {
    banner.classList.add("visible");
    banner.textContent = DATA.symbolMode === "omitted"
      ? `Symbol view disabled: ${DATA.symbolOmitReason || "no symbol graph available"}. Run codebase_graph_build first.`
      : `Symbol view partial (${DATA.symbolOmitReason}). Use codebase_symbols / codebase_impact for full detail.`;
    if (DATA.symbolMode === "omitted") {
      document.querySelectorAll('.view-toggle button[data-view="symbols"]').forEach((b) => { b.disabled = true; b.title = "No symbol graph available"; });
    }
  }

  // ── Initial layout + sidebar ─────────────────────────────────────
  runLayout(currentLayout);
  closeSidebar();
})();

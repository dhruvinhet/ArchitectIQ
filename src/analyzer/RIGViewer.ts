import * as fs from 'fs';
import * as path from 'path';
import { RIGData } from './GraphStore';

export class RIGViewer {
  generateHtml(rigData: RIGData): string {
    const nodeCount = rigData.metadata?.node_count ?? (rigData.nodes?.length ?? 0);
    const edgeCount = rigData.metadata?.edge_count ?? (rigData.edges?.length ?? 0);
    const graphJson = JSON.stringify(rigData).replace(/<\/script/gi, '<\\/script');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RIG Viewer</title>
  <script type="text/javascript" src="https://unpkg.com/vis-network@9.1.9/dist/vis-network.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f4f5f8;
      --panel: #ffffffd9;
      --panel-border: #d8dde8;
      --text: #1b2430;
      --muted: #627086;
      --accent: #2d5bff;
      --chip-bg: #eef2f8;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      font-family: 'Manrope', system-ui, sans-serif;
      background:
        radial-gradient(1100px 680px at -10% -10%, #dce6ff 0%, transparent 65%),
        radial-gradient(900px 620px at 110% 110%, #ffe9da 0%, transparent 68%),
        var(--bg);
      color: var(--text);
      overflow: hidden;
    }
    
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

    #toolbar {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 12px 20px;
      background: var(--panel);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--panel-border);
      position: absolute; top: 0; left: 0; right: 0; z-index: 20;
      box-shadow: 0 8px 32px rgba(8, 25, 67, 0.08);
    }
    #toolbar strong {
      font-family: 'Fraunces', serif;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #17202f;
    }
    .badge {
      padding: 4px 11px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: var(--chip-bg);
      color: #314157;
      border: 1px solid #dce3ef;
    }
    #status {
      font-size: 12px;
      color: var(--muted);
      flex: 1;
      min-width: 80px;
      text-align: right;
      font-weight: 600;
    }
    #searchBox {
      padding: 7px 14px;
      border-radius: 12px;
      border: 1px solid #d7dfed;
      background: #fff;
      color: #1b2430;
      font-size: 13px;
      width: 260px;
      outline: none; transition: all 0.2s ease;
    }
    #searchBox:focus {
      border-color: #b7c6f3;
      box-shadow: 0 0 0 3px rgba(45, 91, 255, 0.14);
    }
    button {
      padding: 7px 14px;
      border-radius: 12px;
      border: 1px solid #d3dbeb;
      background: #fff;
      color: #2a3648;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }
    button:hover { background: #f7faff; border-color: #b8c9f1; transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    button.active {
      background: #1f5bff;
      border-color: #1f5bff;
      color: #fff;
      box-shadow: 0 8px 20px rgba(31, 91, 255, 0.28);
    }

    #kindFilters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .kind-pill {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid #d4dded; transition: all 0.2s;
      user-select: none; background: #fff;
    }
    .kind-pill:hover { border-color: #b7c7ea; }
    .kind-pill input { display: none; }
    .kind-pill .dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
    .kind-pill.off { opacity: 0.4; filter: grayscale(100%); }

    #main { position: relative; height: 100vh; width: 100vw; padding-top: 56px; }
    #graph { width: 100%; height: 100%; }

    #infoPanel {
      position: absolute; right: 20px; top: 76px; bottom: 20px;
      width: 320px; border-radius: 16px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border: 1px solid #d8deeb;
      box-shadow: 0 18px 40px rgba(16, 36, 79, 0.18);
      padding: 24px; overflow-y: auto;
      font-size: 13px; display: none; flex-direction: column; gap: 16px;
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 10;
    }
    #infoPanel.visible { display: flex; transform: translateX(0); }

    #infoPanel h3 {
      font-size: 16px; font-weight: 700; color: #131c2b;
      word-break: break-all; margin-bottom: 4px;
    }
    .ip-section {
      background: #f8fbff;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid #dce5f5;
    }
    .ip-section strong {
      display: block; color: #4f6078; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;
    }
    #infoPanel ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
    #infoPanel li { color: #1f2c42; word-break: break-all; line-height: 1.45; }
    #infoPanel li code {
      background: #e9effb;
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      color: #22324a;
    }
    .neighbor-link { color: #2b5cff; cursor: pointer; text-decoration: none; font-weight: 600; transition: color 0.15s; }
    .neighbor-link:hover { color: #1132a1; text-decoration: underline; }

    .empty-row {
      color: #73839a !important;
      font-style: italic;
    }

    #expandSubgraphBtn {
      margin-top: auto; width: 100%;
      background: #edf2ff; color: #2147cc;
      border: 1px solid #cad8ff;
      padding: 10px; border-radius: 8px; font-weight: 600;
    }
    #expandSubgraphBtn:hover { background: #dfe9ff; border-color: #b6c9ff; }

    @media (max-width: 980px) {
      #searchBox { width: 100%; order: 6; }
      #toolbar { padding: 10px 12px; }
      #status { width: 100%; text-align: left; }
      #infoPanel {
        left: 10px;
        right: 10px;
        width: auto;
        top: 126px;
        bottom: 10px;
      }
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <strong>RIG</strong>
    <span class="badge" id="nodeCountBadge">Nodes: ${nodeCount}</span>
    <span class="badge" id="edgeCountBadge">Edges: ${edgeCount}</span>
    <input id="searchBox" type="search" placeholder="Search nodes..." autocomplete="off" />
    <div id="kindFilters"></div>
    <button id="resetBtn">Reset View</button>
    <button id="fitBtn">Fit All</button>
    <button id="physicsBtn" class="active">Physics: On</button>
    <span id="status">Preparing...</span>
  </div>
  <div id="main">
    <div id="graph"></div>
    <div id="infoPanel">
      <h3 id="ipName">-</h3>
      <div class="ip-section">
        <strong>Kind</strong>
        <span id="ipKind" class="badge" style="border:none; padding:4px 10px;">-</span>
      </div>
      <div class="ip-section" id="ipPropsSection">
        <strong>Properties</strong>
        <ul id="ipProps"></ul>
      </div>
      <div class="ip-section" id="ipEvidenceSection">
        <strong>Evidence</strong>
        <ul id="ipEvidence"></ul>
      </div>
      <div class="ip-section">
        <strong>Neighbors</strong>
        <ul id="ipNeighbors"></ul>
      </div>
      <button id="expandSubgraphBtn">Focus Subgraph</button>
    </div>
  </div>

  <script>
    const graphData = ${graphJson};

    // Minimal premium palette with explicit node-kind mapping
    const kindColor = {
      Target:             { bg: "#2457ff", border: "#123bc2" },
      Module:             { bg: "#14a36f", border: "#0b7f54" },
      Class:              { bg: "#6f47d6", border: "#4e31a3" },
      Component:          { bg: "#0089b5", border: "#006a8d" },
      Function:           { bg: "#de4f00", border: "#a63a00" },
      Schema:             { bg: "#c026d3", border: "#861d93" },
      Interface:          { bg: "#7c3aed", border: "#5a28b8" },
      Service:            { bg: "#0f766e", border: "#0a5a54" },
      Endpoint:           { bg: "#0284c7", border: "#0369a1" },
      ApiRoute:           { bg: "#0369a1", border: "#075985" },
      Database:           { bg: "#16a34a", border: "#15803d" },
      File:               { bg: "#64748b", border: "#475569" },
      Test:               { bg: "#d97706", border: "#b45309" },
      ExternalDependency: { bg: "#475569", border: "#334155" },
    };
    const defaultColor = { bg: "#546277", border: "#3a4659" };

    const relationColor = {
      depends_on:  "#818cf8",
      imports:     "#34d399",
      calls:       "#fbbf24",
      tested_by:   "#f472b6",
      contains:    "#94a3b8",
    };

    const statusEl = document.getElementById("status");
    const searchBox = document.getElementById("searchBox");
    const kindFiltersEl = document.getElementById("kindFilters");
    const fitBtn = document.getElementById("fitBtn");
    const resetBtn = document.getElementById("resetBtn");
    const physicsBtn = document.getElementById("physicsBtn");
    const nodeCountBadge = document.getElementById("nodeCountBadge");
    const edgeCountBadge = document.getElementById("edgeCountBadge");
    const infoPanel = document.getElementById("infoPanel");
    const ipName = document.getElementById("ipName");
    const ipKind = document.getElementById("ipKind");
    const ipProps = document.getElementById("ipProps");
    const ipEvidence = document.getElementById("ipEvidence");
    const ipNeighbors = document.getElementById("ipNeighbors");
    const expandSubgraphBtn = document.getElementById("expandSubgraphBtn");

    const rawNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
    const rawEdges = Array.isArray(graphData.edges) ? graphData.edges : [];

    nodeCountBadge.textContent = "Nodes: " + rawNodes.length;
    edgeCountBadge.textContent = "Edges: " + rawEdges.length;

    const nodeById = new Map(rawNodes.map((n) => [n.id, n]));
    const adjForward = new Map();
    const adjReverse = new Map();
    for (const e of rawEdges) {
      if (!adjForward.has(e.source)) adjForward.set(e.source, []);
      adjForward.get(e.source).push({ relation: e.relation, id: e.target });
      if (!adjReverse.has(e.target)) adjReverse.set(e.target, []);
      adjReverse.get(e.target).push({ relation: e.relation, id: e.source });
    }

    const allKinds = [...new Set(rawNodes.map((n) => n.kind || "Unknown"))].sort();
    const kindVisible = Object.fromEntries(allKinds.map((k) => [k, true]));

    for (const kind of allKinds) {
      const c = kindColor[kind] || defaultColor;
      const pill = document.createElement("label");
      pill.className = "kind-pill";
      pill.style.color = c.border;
      pill.innerHTML = '<input type="checkbox" checked /><span class="dot" style="background:' + c.border + '; box-shadow: 0 0 8px ' + c.border + '"></span>' + kind;
      const cb = pill.querySelector("input");
      cb.addEventListener("change", () => {
        kindVisible[kind] = cb.checked;
        pill.classList.toggle("off", !cb.checked);
        applyFilters();
      });
      kindFiltersEl.appendChild(pill);
    }

    const visNodes = new vis.DataSet();
    const visEdges = new vis.DataSet();

    function getNodeLabel(n) {
      const source = n.name || n.id || "";
      const normalized = String(source).replace(/\\\\/g, "/");
      const parts = normalized.split("/");
      return parts[parts.length - 1] || source;
    }

    function makeVisNode(n) {
      const c = kindColor[n.kind] || defaultColor;
      return {
        id: n.id,
        label: getNodeLabel(n),
        title: n.name,
        color: { 
          background: c.bg, border: c.border, 
          highlight: { background: c.border, border: "#ffffff" },
          hover: { background: c.border, border: "#ffffff" } 
        },
        shape: "dot",
        size: n.kind === "Module" || n.kind === "Target" ? 14 : 9,
        font: { color: "#0f172a", size: 12, face: "Manrope", strokeWidth: 3, strokeColor: "#ffffff" },
        shadow: { enabled: true, color: "rgba(15, 23, 42, 0.16)", size: 10, x: 2, y: 2 }
      };
    }

    function highlightSelection(nid) {
      visNodes.forEach((vn) => {
        const raw = nodeById.get(vn.id);
        const base = makeVisNode(raw);
        if (vn.id === nid) {
          visNodes.update({
            ...base,
            id: vn.id,
            size: (base.size || 10) + 6,
            borderWidth: 4,
            color: {
              ...base.color,
              background: "#ffd166",
              border: "#7c2d12",
              highlight: { background: "#ffb703", border: "#7c2d12" },
              hover: { background: "#ffb703", border: "#7c2d12" }
            },
            shadow: { enabled: true, color: "rgba(124,45,18,0.35)", size: 18, x: 0, y: 0 }
          });
        } else {
          visNodes.update({ ...base, id: vn.id, borderWidth: 1 });
        }
      });
    }

    function makeVisEdge(e, i) {
      const col = relationColor[e.relation] || "#475569";
      return {
        id: i,
        from: e.source,
        to: e.target,
        color: { color: col, opacity: 0.65, highlight: col },
        width: 1.5,
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        smooth: { type: "dynamic" }
      };
    }

    const container = document.getElementById("graph");
    const network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, {
      interaction: { hover: true, navigationButtons: true, keyboard: { enabled: true, bindToWindow: false } },
      physics: { enabled: true, barnesHut: { gravitationalConstant: -3000, springLength: 100 } }
    });

    function loadInChunks(items, batchSize, mapFn, dataset, label, done) {
      let idx = 0;
      function tick() {
        const batch = items.slice(idx, idx + batchSize).map(mapFn);
        if (batch.length) dataset.add(batch);
        idx += batchSize;
        updateStatus(label + ': ' + Math.min(idx, items.length) + '/' + items.length);
        if (idx < items.length) { requestAnimationFrame(tick); return; }
        done();
      }
      tick();
    }

    loadInChunks(rawNodes, 600, makeVisNode, visNodes, "Loading nodes", () => {
      loadInChunks(rawEdges, 1200, makeVisEdge, visEdges, "Loading edges", () => {
        network.fit({ animation: false });
        updateStatus("Ready");
      });
    });

    function updateStatus(msg) { statusEl.textContent = msg; }

    let selectedNodeId = null;

    network.on("click", (params) => {
      if (params.nodes.length === 0) {
        infoPanel.classList.remove("visible");
        selectedNodeId = null;
        highlightSelection(null);
        return;
      }
      const nid = params.nodes[0];
      selectedNodeId = nid;
      highlightSelection(nid);
      showInfoPanel(nid);
    });

    function showInfoPanel(nid) {
      const raw = nodeById.get(nid);
      if (!raw) return;

      ipName.textContent = raw.name || nid;
      ipKind.textContent = raw.kind || "-";
      const c = kindColor[raw.kind] || defaultColor;
      ipKind.style.background = c.bg + '33';
      ipKind.style.color = c.border;
      ipKind.style.border = '1px solid ' + c.border + '33';

      const props = raw.properties || {};
      ipProps.innerHTML = "";
      let propCount = 0;
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === "") continue;
        const li = document.createElement("li");
        li.innerHTML = '<code>' + k + '</code> ' + String(v).slice(0, 120);
        ipProps.appendChild(li);
        propCount += 1;
      }
      if (propCount === 0) {
        const li = document.createElement("li");
        li.className = "empty-row";
        li.textContent = "No properties available";
        ipProps.appendChild(li);
      }

      const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
      ipEvidence.innerHTML = "";
      for (const e of evidence.slice(0, 6)) {
        const li = document.createElement("li");
        li.innerHTML = '<code>' + e + '</code>';
        ipEvidence.appendChild(li);
      }
      if (evidence.length === 0) {
        const li = document.createElement("li");
        li.className = "empty-row";
        li.textContent = "No evidence available";
        ipEvidence.appendChild(li);
      }

      ipNeighbors.innerHTML = "";
      const fwd = (adjForward.get(nid) || []).slice(0, 8);
      const rev = (adjReverse.get(nid) || []).slice(0, 8);
      for (const { relation, id } of fwd) {
        const neighbor = nodeById.get(id);
        const li = document.createElement("li");
        const a = document.createElement("span");
        a.className = "neighbor-link";
        a.textContent = neighbor ? neighbor.name : id;
        a.dataset.nid = id;
        a.title = '-> ' + relation;
        li.appendChild(document.createTextNode('↗ [' + relation + '] '));
        li.appendChild(a);
        ipNeighbors.appendChild(li);
      }
      for (const { relation, id } of rev) {
        const neighbor = nodeById.get(id);
        const li = document.createElement("li");
        const a = document.createElement("span");
        a.className = "neighbor-link";
        a.textContent = neighbor ? neighbor.name : id;
        a.dataset.nid = id;
        a.title = '<- ' + relation;
        li.appendChild(document.createTextNode('↙ [' + relation + '] '));
        li.appendChild(a);
        ipNeighbors.appendChild(li);
      }
      if (!fwd.length && !rev.length) {
        const li = document.createElement("li"); li.textContent = "No neighbors"; ipNeighbors.appendChild(li);
      }

      ipNeighbors.querySelectorAll(".neighbor-link").forEach((el) => {
        el.addEventListener("click", () => {
          const tnid = el.dataset.nid;
          network.selectNodes([tnid]);
          network.focus(tnid, { animation: { duration: 300 } });
          highlightSelection(tnid);
          showInfoPanel(tnid);
          selectedNodeId = tnid;
        });
      });

      infoPanel.classList.add("visible");
    }

    expandSubgraphBtn.addEventListener("click", () => {
      if (!selectedNodeId) return;
      const reachable = new Set();
      reachable.add(selectedNodeId);
      for (const { id } of (adjForward.get(selectedNodeId) || [])) reachable.add(id);
      for (const { id } of (adjReverse.get(selectedNodeId) || [])) reachable.add(id);

      const subNodes = rawNodes.filter((n) => reachable.has(n.id)).map(makeVisNode);
      const subEdges = rawEdges
        .filter((e) => reachable.has(e.source) && reachable.has(e.target))
        .map(makeVisEdge);

      visNodes.clear(); visEdges.clear();
      visNodes.add(subNodes); visEdges.add(subEdges);
      network.fit({ animation: { duration: 250 } });
      updateStatus('Focused Subgraph');
    });

    let searchTimer = null;
    searchBox.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 250);
    });

    function applyFilters() {
      const q = searchBox.value.trim().toLowerCase();
      const matching = new Set();
      for (const n of rawNodes) {
        if (!kindVisible[n.kind || "Unknown"]) continue;
        if (q && !(n.name || "").toLowerCase().includes(q)) continue;
        matching.add(n.id);
      }

      const filteredNodes = rawNodes.filter((n) => matching.has(n.id)).map((n) => {
        const vn = makeVisNode(n);
        if (q && (n.name || "").toLowerCase().includes(q)) {
          vn.borderWidth = 3;
          vn.size = 18;
          vn.shadow = { enabled: true, color: "rgba(255,255,255,0.4)", size: 20, x: 0, y: 0 };
        }
        return vn;
      });
      const filteredEdges = rawEdges
        .filter((e) => matching.has(e.source) && matching.has(e.target))
        .map(makeVisEdge);

      visNodes.clear(); visEdges.clear();
      visNodes.add(filteredNodes); visEdges.add(filteredEdges);
      if (q) {
        const first = filteredNodes[0];
        if (first) network.focus(first.id, { animation: { duration: 250 } });
      }
      updateStatus(q ? ('Filtering: ' + filteredNodes.length + ' nodes') : ('Showing ' + filteredNodes.length + ' nodes'));
    }

    fitBtn.addEventListener("click", () => network.fit({ animation: { duration: 250 } }));

    resetBtn.addEventListener("click", () => {
      searchBox.value = "";
      for (const kind of allKinds) { kindVisible[kind] = true; }
      document.querySelectorAll(".kind-pill").forEach((p) => {
        p.classList.remove("off");
        p.querySelector("input").checked = true;
      });
      visNodes.clear(); visEdges.clear();
      visNodes.add(rawNodes.map(makeVisNode));
      visEdges.add(rawEdges.map(makeVisEdge));
      network.fit({ animation: { duration: 250 } });
      updateStatus("Ready");
    });

    let physicsOn = true;
    physicsBtn.addEventListener("click", () => {
      physicsOn = !physicsOn;
      network.setOptions({ physics: { enabled: physicsOn } });
      physicsBtn.textContent = physicsOn ? "Physics: On" : "Physics: Off";
      physicsBtn.classList.toggle("active", physicsOn);
    });
  </script>
</body>
</html>`;
  }

  saveHtml(rigJsonPath: string, outHtmlPath: string): void {
    try {
      const rigData = JSON.parse(fs.readFileSync(rigJsonPath, 'utf-8'));
      const html = this.generateHtml(rigData);
      fs.writeFileSync(outHtmlPath, html, 'utf-8');
    } catch (err) {
      console.error('Failed to generate RIG HTML viewer', err);
    }
  }
}

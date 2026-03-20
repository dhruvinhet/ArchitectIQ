import * as fs from 'fs';
import { FileGraph, FileInfo } from '../analyzer/WorkspaceScanner';
import { LanguageDetector, DetectedStack } from '../analyzer/LanguageDetector';
import { DependencyMap } from '../analyzer/DependencyMapper';
import { RIGData } from '../analyzer/GraphStore';
import { CoOccurrenceIndex } from './CoOccurrenceIndex';
import { ChangeCouplingAnalyzer } from './ChangeCouplingAnalyzer';

const DEBUG_RELEVANCE_PIPELINE = false;
const MAX_TRAVERSAL_DEPTH = 2;

const INTENT_STOPLIST = new Set([
  'add', 'create', 'update', 'delete', 'remove', 'implement', 'build', 'make', 'fix',
  'change', 'modify', 'refactor', 'a', 'an', 'the', 'at', 'in', 'of', 'to', 'for',
  'with', 'and', 'or', 'this', 'that', 'time', 'during', 'when', 'where', 'how',
  'what', 'which', 'i', 'we', 'my', 'our', 'use', 'using', 'used', 'need', 'want',
  'should', 'will', 'can', 'do', 'does', 'is', 'are', 'was', 'be', 'been', 'get',
  'set', 'new', 'page', 'feature', 'functionality', 'button', 'field', 'form',
]);

const STRIP_SUFFIXES = [
  'store', 'controller', 'service', 'router', 'route', 'routes',
  'handler', 'manager', 'helper', 'util', 'utils', 'hook',
  'page', 'view', 'component', 'widget', 'screen',
  'model', 'schema', 'type', 'types', 'interface',
  'test', 'spec', 'index',
];

const TRAVERSAL_ROLES = new Set(['controller', 'service', 'api-route', 'model', 'schema', 'store', 'middleware']);
const TRAVERSAL_SKIP_ROLES = new Set(['util', 'config', 'style', 'test']);
const NOISE_ROLES = new Set(['util', 'config', 'style', 'type']);
const NOISE_BASENAMES = new Set(['index', 'constants', 'helpers', 'utils']);
const UI_ROLES = new Set(['component', 'page', 'hook', 'context', 'store']);
const API_ROLES = new Set(['api-route', 'controller', 'service', 'model', 'schema', 'middleware', 'serializer', 'view']);

const SEMANTIC_EXPANSION: Record<string, string[]> = {
  dark: ['theme', 'appearance'],
  mode: ['theme', 'preference'],
  toggle: ['switch', 'enable', 'disable'],
  style: ['theme', 'appearance', 'css'],
  auth: ['authentication', 'login', 'token'],
  performance: ['optimize', 'latency', 'cache'],
  test: ['spec', 'coverage', 'assert'],
  api: ['endpoint', 'route', 'handler'],
  data: ['schema', 'model', 'database'],
};

const CRITICAL_STYLE_CONFIG_BASENAMES = new Set([
  'index.css',
  'global.css',
  'globals.css',
  'theme.css',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.ts',
  'vite.config.ts',
  'vite.config.js',
]);

const BOOTSTRAP_BASENAMES = new Set([
  'main.ts', 'main.tsx',
  'index.ts', 'index.tsx',
  'app.tsx',
  'server.ts',
  'app.py', 'main.py',
]);

const LAYOUT_HINTS = ['layout', 'navbar', 'rootlayout', 'shell', 'header', 'footer', 'router'];
const RESPONSIBILITY_KEYWORDS = [
  'calculate', 'price', 'fee', 'booking', 'preview', 'close_trip', 'complete_trip', 'finalize_trip', 'payment', 'preview_fee',
  'close trip', 'finalize trip', 'preview fee',
];

interface CandidateScore {
  path: string;
  info: FileInfo;
  keywordRaw: number;
  keywordScore?: number;
  responsibilityScore?: number;
  dependencyDistance: number;
  graphProximity: number;
  clusterSimilarity: number;
  pathSimilarity: number;
  clusterId: number;
  semanticPairScore: number;
  centralityScore: number;
  hubPenalty: number;
  connectorBoost: number;
  bridgeBoost: number;
  clusterPenalty: number;
  infraPenalty: number;
  layerPenalty: number;
  leafPenalty: number;
  relevanceScore: number;
  reason: string;
  connectionPath: string[];
}

interface ResponsibilityVector {
  ui: number;
  backend: number;
  data: number;
  store: number;
  style: number;
}

interface SeedCandidate {
  path: string;
  info: FileInfo;
  keywordRaw: number;
  keywordScore: number;
  responsibilityScore: number;
  graphProximityScore: number;
  anchorBoost: number;
  semanticPairScore: number;
  centralityScore: number;
  seedScore: number;
}

type DebugFn = (line: string) => void;
type RepoLayer =
  | 'frontend-ui'
  | 'frontend-layout'
  | 'frontend-style'
  | 'frontend-state'
  | 'frontend-page'
  | 'backend-api'
  | 'backend-service'
  | 'backend-schema'
  | 'backend-config'
  | 'backend-database'
  | 'test'
  | 'infrastructure';
type IntentCategory =
  | 'UI_FEATURE'
  | 'UI_STYLE'
  | 'DATA_MODEL'
  | 'API_ENDPOINT'
  | 'AUTHENTICATION'
  | 'PERFORMANCE'
  | 'TESTING'
  | 'CONFIGURATION';

interface TraversalResult {
  distances: Map<string, number>;
  proximityByPath: Map<string, number>;
  parents: Map<string, string>;
  clusterTransitions: string[];
}

interface ClusterContext {
  fileCluster: Map<string, number>;
  clusterMembers: Map<number, Set<string>>;
  clusterAdjacency: Map<number, Set<number>>;
}

interface AnchorMetrics {
  outNorm: number;
  invInNorm: number;
  anchorScore: number;
}

interface SelectionDebug {
  seeds: string[];
  traversal: Array<{ path: string; distance: number }>;
  architectureChains: string[];
  filteredNoise: string[];
  clusterCount: number;
  seedCluster: number;
  clusterFilteredOut: string[];
  clusterTransitions: string[];
  responsibilitySignals: string[];
  anchorBoostedFiles: string[];
  topRejectedBeforeSeed: string[];
  seedScoreBreakdown: string[];
  originalKeywordWeights: string[];
  expansionKeywordWeights: string[];
  anchorScores: string[];
  graphProximityTop: string[];
  leafPenaltyTop: string[];
  hubPenaltyTop: string[];
  connectorBoostTop: string[];
  bridgeBoostTop: string[];
  clusterPenaltyTop: string[];
  infraPenaltyTop: string[];
  layerPenaltyTop: string[];
  detectedIntents: string[];
  intentLayers: string[];
  seedReasoning: string[];
  keywordExpansionSource: string;
}

export interface Intent {
  action: 'add' | 'refactor' | 'fix' | 'delete' | 'update';
  domains: string[];
  keywords: string[];
  raw: string;
}

export interface RelevantFile {
  path: string;
  info: FileInfo;
  score: number;
  reason: string;
  connectionPath: string[];
}

export class PromptGenerator {
  private readonly graph: FileGraph;
  private readonly stack: DetectedStack;
  private readonly depMap: DependencyMap;
  private readonly coIndex: CoOccurrenceIndex;
  private readonly changeCoupling: ChangeCouplingAnalyzer;
  private _hubNodeCache: Set<string> | null = null;
  private _lastPipelineDebug: string[] = [];
  private _lastSelectionDebug: SelectionDebug = {
    seeds: [],
    traversal: [],
    architectureChains: [],
    filteredNoise: [],
    clusterCount: 0,
    seedCluster: -1,
    clusterFilteredOut: [],
    clusterTransitions: [],
    responsibilitySignals: [],
    anchorBoostedFiles: [],
    topRejectedBeforeSeed: [],
    seedScoreBreakdown: [],
    originalKeywordWeights: [],
    expansionKeywordWeights: [],
    anchorScores: [],
    graphProximityTop: [],
    leafPenaltyTop: [],
    hubPenaltyTop: [],
    connectorBoostTop: [],
    bridgeBoostTop: [],
    clusterPenaltyTop: [],
    infraPenaltyTop: [],
    layerPenaltyTop: [],
    detectedIntents: [],
    intentLayers: [],
    seedReasoning: [],
    keywordExpansionSource: 'semantic-only',
  };

  constructor(
    graph: FileGraph,
    private readonly rigData: RIGData,
    depMap: DependencyMap
  ) {
    this.graph = graph;
    this.stack = LanguageDetector.detect(graph);
    this.depMap = depMap;
    this.coIndex = new CoOccurrenceIndex(graph);
    this.changeCoupling = new ChangeCouplingAnalyzer(graph);
  }

  public generate(userInput: string): string {
    const debug: string[] = [];
    const dbg = (line: string): void => {
      if (DEBUG_RELEVANCE_PIPELINE) debug.push(line);
    };

    const intent = this._parseIntent(userInput);
    dbg('---- INTENT PARSING ----');
    dbg('Request: ' + userInput);
    dbg('Keywords: ' + JSON.stringify(intent.keywords));

    const expandedKeywords = this._expandKeywords(intent);
    dbg('---- KEYWORD EXPANSION ----');
    dbg('Expanded keywords: ' + JSON.stringify([...expandedKeywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)));

    const relevantFiles = this._findRelevantFiles(intent, expandedKeywords, dbg);
    const patterns = this._findExistingPatterns(relevantFiles, expandedKeywords);
    const cascadingFiles = this._findCascadingFiles(relevantFiles, expandedKeywords);
    const conventions = this._extractConventions();

    dbg('---- FINAL SELECTED FILES ----');
    relevantFiles.forEach((f) => dbg('SELECTED: ' + f.path + ' | score=' + f.score.toFixed(3)));

    this._lastPipelineDebug = DEBUG_RELEVANCE_PIPELINE ? [...debug] : [];
    if (DEBUG_RELEVANCE_PIPELINE) {
      console.log('\n===== ARCHITECTIQ RELEVANCE DEBUG =====');
      console.log(debug.join('\n'));
      console.log('===== END DEBUG =====\n');
    }

    return this._buildPrompt(userInput, intent, relevantFiles, patterns, cascadingFiles, conventions);
  }

  public generateAnalysis(userInput: string): string {
    const intent = this._parseIntent(userInput);
    const expandedKeywords = this._expandKeywords(intent);
    const relevantFiles = this._findRelevantFiles(intent, expandedKeywords);

    const lines: string[] = [
      '=== ANALYSIS ===',
      'Request: ' + userInput,
      'Stack: ' + this.stack.summary,
      'Files scanned: ' + this.graph.size + ' | Graph: ' + this.rigData.metadata.node_count + ' nodes, ' + this.rigData.metadata.edge_count + ' edges',
      '',
      'EXPANDED KEYWORDS:',
      '  ' + [...expandedKeywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, w]) => k + '(' + w.toFixed(2) + ')').join(', '),
      '',
    ];

    if (this._lastSelectionDebug.seeds.length > 0) {
      lines.push('DETECTED SEEDS:');
      this._lastSelectionDebug.seeds.forEach((p) => lines.push('  * ' + p));
      lines.push('');
    }

    if (this._lastSelectionDebug.responsibilitySignals.length > 0) {
      lines.push('RESPONSIBILITY SIGNALS DETECTED:');
      this._lastSelectionDebug.responsibilitySignals.forEach((s) => lines.push('  * ' + s));
      lines.push('');
    }

    if (this._lastSelectionDebug.detectedIntents.length > 0) {
      lines.push('DETECTED REQUEST INTENTS:');
      this._lastSelectionDebug.detectedIntents.forEach((s) => lines.push('  * ' + s));
      lines.push('');
    }

    if (this._lastSelectionDebug.intentLayers.length > 0) {
      lines.push('INFERRED INTENT LAYERS:');
      this._lastSelectionDebug.intentLayers.forEach((s) => lines.push('  * ' + s));
      lines.push('');
    }

    if (this._lastSelectionDebug.traversal.length > 0) {
      lines.push('TRAVERSAL RESULTS (BFS depth<=' + MAX_TRAVERSAL_DEPTH + '):');
      this._lastSelectionDebug.traversal.slice(0, 20).forEach((t) => lines.push('  -> ' + t.path + ' (distance=' + t.distance + ')'));
      lines.push('');
    }

    lines.push('KEYWORD EXPANSION SOURCE: ' + this._lastSelectionDebug.keywordExpansionSource);
    lines.push('');

    if (relevantFiles.length > 0) {
      lines.push('FINAL RELEVANT FILES:');
      relevantFiles.forEach((f) => lines.push('  * ' + f.path + ' [' + f.info.role + '] score=' + f.score.toFixed(3)));
      lines.push('');
    }

    lines.push('Graph: .architectiq/rig.json');
    lines.push('Viewer: open .architectiq/rig-view.html in browser');

    return lines.join('\n');
  }

  private _parseIntent(input: string): Intent {
    const raw = input.toLowerCase();
    const tokens = this._tokenize(input);
    const keywords = [...new Set(tokens.filter((w) => w.length > 2 && !INTENT_STOPLIST.has(w)))];

    let action: Intent['action'] = 'add';
    if (/refactor|restructure|reorganize/.test(raw)) action = 'refactor';
    else if (/fix|debug|resolve/.test(raw)) action = 'fix';
    else if (/delete|remove|drop/.test(raw)) action = 'delete';
    else if (/update|upgrade|modify|change|edit/.test(raw)) action = 'update';

    return { action, domains: [], keywords, raw };
  }

  private _tokenize(text: string): string[] {
    const normalized = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, ' ');
    const rough = normalized.split(/\s+/).filter(Boolean);
    const out: string[] = [];

    for (const token of rough) {
      for (const part of this._splitIdentifier(token)) {
        if (part.length > 1) out.push(part);
      }
    }

    return out;
  }

  private _splitIdentifier(identifier: string): string[] {
    const splitByCase = identifier
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-\/\\]/g, ' ')
      .toLowerCase();

    return splitByCase
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private _expandKeywords(intent: Intent): Map<string, number> {
    const base = new Map<string, number>();
    for (const kw of intent.keywords) {
      base.set(kw, 1.0);
    }

    if (intent.keywords.length < 4) {
      return base;
    }

    const expanded = new Map<string, number>();
    for (const kw of intent.keywords) {
      const related = SEMANTIC_EXPANSION[kw] || [];
      for (const synonym of related) {
        if (base.has(synonym)) continue;
        expanded.set(synonym, Math.max(expanded.get(synonym) || 0, 0.22));
      }
    }

    for (const [term, weight] of expanded) {
      base.set(term, weight);
    }

    return base;
  }

  private _clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  private _boundedWeightedScore(components: Array<{ score: number; weight: number }>): number {
    const raw = components.map((c) => this._clamp01(c.score) * c.weight);
    const baseTotal = raw.reduce((a, b) => a + b, 0);
    if (baseTotal <= 0) return 0;

    const maxContribution = 0.5 * baseTotal;
    const boundedTotal = raw.reduce((sum, r) => sum + Math.min(r, maxContribution), 0);
    return this._clamp01(boundedTotal);
  }

  private _normalizeByRange(value: number, min: number, max: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
    if (max <= min) return 0;
    return this._clamp01((value - min) / (max - min));
  }

  private _computeAnchorMetrics(adjacency: Map<string, string[]>): Map<string, AnchorMetrics> {
    const outByPath = new Map<string, number>();
    const invInByPath = new Map<string, number>();

    let minOut = Number.POSITIVE_INFINITY;
    let maxOut = Number.NEGATIVE_INFINITY;
    let minInvIn = Number.POSITIVE_INFINITY;
    let maxInvIn = Number.NEGATIVE_INFINITY;

    for (const p of this.graph.keys()) {
      const outDegree = (this.depMap.dependencies.get(p) || []).length;
      const inDegree = (this.depMap.dependents.get(p) || []).length;
      const invIn = 1 / (1 + inDegree);
      outByPath.set(p, outDegree);
      invInByPath.set(p, invIn);

      minOut = Math.min(minOut, outDegree);
      maxOut = Math.max(maxOut, outDegree);
      minInvIn = Math.min(minInvIn, invIn);
      maxInvIn = Math.max(maxInvIn, invIn);
    }

    const metrics = new Map<string, AnchorMetrics>();
    for (const p of this.graph.keys()) {
      const outNorm = this._normalizeByRange(outByPath.get(p) || 0, minOut, maxOut);
      const invInNorm = this._normalizeByRange(invInByPath.get(p) || 0, minInvIn, maxInvIn);
      const anchorScore = this._clamp01(outNorm * 0.6 + invInNorm * 0.4);
      metrics.set(p, { outNorm, invInNorm, anchorScore });
    }

    return metrics;
  }

  private _computeAnchorBoosts(metrics: Map<string, AnchorMetrics>): Map<string, number> {
    const scores = [...metrics.entries()].map(([path, m]) => ({ path, score: m.anchorScore }));
    if (scores.length === 0) return new Map<string, number>();

    const values = scores.map((s) => s.score);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + (0.35 * stdDev);

    scores.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const maxAnchors = Math.max(4, Math.min(20, Math.floor(scores.length * 0.1)));

    const boosts = new Map<string, number>();
    for (const s of scores) {
      if (boosts.size >= maxAnchors) break;
      if (s.score <= threshold) continue;
      const boost = this._clamp01(0.1 + (s.score - threshold) * 0.35);
      boosts.set(s.path, Math.min(0.25, Math.max(0.1, boost)));
    }

    return boosts;
  }

  private _computeLeafPenaltyByPath(): Map<string, number> {
    const inDegreeByPath = new Map<string, number>();
    const invOutByPath = new Map<string, number>();

    let minIn = Number.POSITIVE_INFINITY;
    let maxIn = Number.NEGATIVE_INFINITY;
    let minInvOut = Number.POSITIVE_INFINITY;
    let maxInvOut = Number.NEGATIVE_INFINITY;

    for (const p of this.graph.keys()) {
      const inDegree = (this.depMap.dependents.get(p) || []).length;
      const outDegree = (this.depMap.dependencies.get(p) || []).length;
      const invOut = 1 / (1 + outDegree);

      inDegreeByPath.set(p, inDegree);
      invOutByPath.set(p, invOut);

      minIn = Math.min(minIn, inDegree);
      maxIn = Math.max(maxIn, inDegree);
      minInvOut = Math.min(minInvOut, invOut);
      maxInvOut = Math.max(maxInvOut, invOut);
    }

    const penalties = new Map<string, number>();
    for (const p of this.graph.keys()) {
      const inNorm = this._normalizeByRange(inDegreeByPath.get(p) || 0, minIn, maxIn);
      const invOutNorm = this._normalizeByRange(invOutByPath.get(p) || 0, minInvOut, maxInvOut);
      penalties.set(p, this._clamp01(inNorm * 0.6 + invOutNorm * 0.4));
    }

    return penalties;
  }

  private _computeHubPenaltyByPath(): Map<string, number> {
    const logDegreeByPath = new Map<string, number>();
    let minLog = Number.POSITIVE_INFINITY;
    let maxLog = Number.NEGATIVE_INFINITY;

    for (const p of this.graph.keys()) {
      const inDegree = (this.depMap.dependents.get(p) || []).length;
      const outDegree = (this.depMap.dependencies.get(p) || []).length;
      const hubScore = Math.log(1 + inDegree + outDegree);
      logDegreeByPath.set(p, hubScore);
      minLog = Math.min(minLog, hubScore);
      maxLog = Math.max(maxLog, hubScore);
    }

    const penalties = new Map<string, number>();
    for (const p of this.graph.keys()) {
      const normalized = this._normalizeByRange(logDegreeByPath.get(p) || 0, minLog, maxLog);
      penalties.set(p, this._clamp01(normalized * 0.25));
    }

    return penalties;
  }

  private _computeConnectorBoostByPath(clusters: ClusterContext, adjacency: Map<string, string[]>): Map<string, number> {
    const outDegreeByPath = new Map<string, number>();
    const clusterNeighborByPath = new Map<string, number>();

    let minOut = Number.POSITIVE_INFINITY;
    let maxOut = Number.NEGATIVE_INFINITY;
    let minClusterN = Number.POSITIVE_INFINITY;
    let maxClusterN = Number.NEGATIVE_INFINITY;

    for (const p of this.graph.keys()) {
      const outDegree = (this.depMap.dependencies.get(p) || []).length;
      const neighbors = adjacency.get(p) || [];
      const uniqueNeighborClusters = new Set<number>();
      for (const n of neighbors) {
        const cid = clusters.fileCluster.get(n);
        if (cid !== undefined) uniqueNeighborClusters.add(cid);
      }

      outDegreeByPath.set(p, outDegree);
      clusterNeighborByPath.set(p, uniqueNeighborClusters.size);

      minOut = Math.min(minOut, outDegree);
      maxOut = Math.max(maxOut, outDegree);
      minClusterN = Math.min(minClusterN, uniqueNeighborClusters.size);
      maxClusterN = Math.max(maxClusterN, uniqueNeighborClusters.size);
    }

    const connectorRaw = new Map<string, number>();
    const values: number[] = [];
    for (const p of this.graph.keys()) {
      const outNorm = this._normalizeByRange(outDegreeByPath.get(p) || 0, minOut, maxOut);
      const clusterNorm = this._normalizeByRange(clusterNeighborByPath.get(p) || 0, minClusterN, maxClusterN);
      const score = this._clamp01(outNorm * 0.6 + clusterNorm * 0.4);
      connectorRaw.set(p, score);
      values.push(score);
    }

    const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length > 0 ? values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length : 0;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + (0.30 * stdDev);

    const boosts = new Map<string, number>();
    for (const p of this.graph.keys()) {
      const s = connectorRaw.get(p) || 0;
      boosts.set(p, s > threshold ? 0.15 : 0);
    }

    return boosts;
  }

  private _isInfraUtilityFile(filePath: string, info: FileInfo, centralityScore: number, responsibilityScore: number): boolean {
    const lower = filePath.toLowerCase();
    const base = lower.split('/').pop() || '';
    const nameIndicatesInfra = /types|utils|helpers|api/.test(lower);
    const isDefinition = base.endsWith('.d.ts') || base.endsWith('.d.mts') || base.endsWith('.d.cts');
    const structuralInfra = centralityScore >= 0.65 && responsibilityScore <= 0.20;
    return nameIndicatesInfra || isDefinition || structuralInfra;
  }

  private _scoreFileForIntent(
    filePath: string,
    info: FileInfo,
    expandedKeywords: Map<string, number>
  ): number {
    if (info.role === 'test' || info.role === 'config') return -1;

    if (info.role === 'style') {
      const terms = [...expandedKeywords.keys()];
      const isStylingIntent = terms.some((t) => /style|css|theme|dark|light|color|palette|toggle|mode/.test(t));
      if (!isStylingIntent) return -1;
    }

    let score = 0;
    const pathLower = filePath.toLowerCase();
    const contentLower = info.contentFull.toLowerCase();
    const allSymbols = [...info.exports, ...info.functions, ...info.classes].map((s) => s.toLowerCase()).join(' ');

    for (const [term, weight] of expandedKeywords) {
      if (pathLower.includes(term)) score += Math.round(15 * weight);
      if (allSymbols.includes(term)) score += Math.round(8 * weight);
      if (contentLower.includes(term)) score += Math.round(3 * weight);
    }

    return score;
  }

  private _computeHubs(): Set<string> {
    if (this._hubNodeCache) return this._hubNodeCache;

    const counts: number[] = [];
    for (const filePath of this.graph.keys()) {
      const dependents = this.depMap.dependents.get(filePath) || [];
      counts.push(dependents.length);
    }

    if (counts.length === 0) {
      this._hubNodeCache = new Set();
      return this._hubNodeCache;
    }

    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stddev = Math.sqrt(variance);
    const threshold = mean + (1.5 * stddev);

    const LEAF_ROLES = new Set(['api-route', 'controller', 'page', 'view', 'migration', 'test', 'serializer']);

    const hubs = new Set<string>();
    for (const [filePath, info] of this.graph) {
      if (LEAF_ROLES.has(info.role)) continue;
      const deps = (this.depMap.dependents.get(filePath) || []).length;
      if (deps > threshold) hubs.add(filePath);
    }

    this._hubNodeCache = hubs;
    return hubs;
  }

  private _isHubNode(filePath: string): boolean {
    return this._computeHubs().has(filePath);
  }

  private _buildSemanticRootIndex(): Map<string, string[]> {
    const rootToFiles = new Map<string, string[]>();

    for (const filePath of this.graph.keys()) {
      let basename = filePath.split('/').pop() || '';
      basename = basename.replace(/\.[^.]+$/, '').toLowerCase();

      let root = basename;
      for (const suffix of STRIP_SUFFIXES) {
        if (root.endsWith(suffix) && root.length > suffix.length) {
          root = root.slice(0, root.length - suffix.length);
          break;
        }
      }

      root = root.replace(/_?(controller|service|router|handler|model|schema|test|spec|store|view|page)$/, '');
      root = root.replace(/^(test_|spec_)/, '');

      if (root.length >= 3) {
        if (!rootToFiles.has(root)) rootToFiles.set(root, []);
        rootToFiles.get(root)!.push(filePath);
      }
    }

    const GENERIC_ROOTS = new Set([
      'index', 'main', 'app', 'base', 'core', 'common', 'shared',
      'utils', 'util', 'helpers', 'helper', 'lib', 'api', 'types',
      'config', 'constants', 'globals', 'setup', 'init', 'root',
    ]);
    for (const root of GENERIC_ROOTS) {
      rootToFiles.delete(root);
    }

    const totalFiles = this.graph.size;
    for (const [root, files] of rootToFiles) {
      if (files.length / totalFiles > 0.08) {
        rootToFiles.delete(root);
      }
    }

    return rootToFiles;
  }

  private _findSemanticPairs(seeds: RelevantFile[], expandedKeywords: Map<string, number>): RelevantFile[] {
    const rootIndex = this._buildSemanticRootIndex();
    const pairs: RelevantFile[] = [];
    const seedPaths = new Set(seeds.map((s) => s.path));

    for (const seed of seeds) {
      let seedBasename = seed.path.split('/').pop() || '';
      seedBasename = seedBasename.replace(/\.[^.]+$/, '').toLowerCase();

      let seedRoot = seedBasename;
      for (const suffix of STRIP_SUFFIXES) {
        if (seedRoot.endsWith(suffix) && seedRoot.length > suffix.length) {
          seedRoot = seedRoot.slice(0, seedRoot.length - suffix.length);
          break;
        }
      }
      seedRoot = seedRoot.replace(/_?(controller|service|router|handler|model|schema|test|spec|store|view|page)$/, '');

      if (seedRoot.length < 3) continue;

      const siblings = rootIndex.get(seedRoot) || [];
      for (const sibling of siblings) {
        if (seedPaths.has(sibling)) continue;
        const sibInfo = this.graph.get(sibling);
        if (!sibInfo) continue;

        const pairScore = this._scoreFileForIntent(sibling, sibInfo, expandedKeywords);
        if (pairScore <= 0) continue;

        const seedLayer = this._architecturalLayer(seed.info.role);
        const siblingLayer = this._architecturalLayer(sibInfo.role);
        if (!this._areAdjacentOrSameLayer(seedLayer, siblingLayer)) continue;

        pairs.push({
          path: sibling,
          info: sibInfo,
          score: pairScore,
          reason: 'semantic-pair',
          connectionPath: [seed.path, '--same-root-->', sibling],
        });
      }
    }

    return pairs;
  }

  private _findDependencyModels(candidates: RelevantFile[]): RelevantFile[] {
    const models: RelevantFile[] = [];
    for (const c of candidates) {
      const deps = this.depMap.dependencies.get(c.path) || [];
      for (const dep of deps) {
        const info = this.graph.get(dep);
        if (info && (info.role === 'model' || info.role === 'schema')) {
          models.push({ path: dep, info, score: 12, reason: 'data-model', connectionPath: [c.path, 'imports model', dep] });
        }
      }

      if (c.info.language === 'python') {
        for (const imp of c.info.imports) {
          if (!imp.includes('model') && !imp.includes('schema')) continue;
          const tail = imp.split('.').pop()?.toLowerCase() || '';
          for (const [filePath, info] of this.graph) {
            if ((info.role === 'model' || info.role === 'schema') && filePath.toLowerCase().includes(tail)) {
              models.push({ path: filePath, info, score: 14, reason: 'python-model-import', connectionPath: [c.path, 'imports', filePath] });
            }
          }
        }
      }
    }
    return models;
  }

  private _architecturalLayer(role: string): 'UI' | 'STATE' | 'SERVICE' | 'DATA' | 'INFRA' {
    if (role === 'store' || role === 'context') return 'STATE';
    if (role === 'component' || role === 'page' || role === 'hook' || role === 'view' || role === 'style') return 'UI';
    if (role === 'service' || role === 'controller' || role === 'api-route' || role === 'middleware' || role === 'serializer') return 'SERVICE';
    if (role === 'model' || role === 'schema') return 'DATA';
    return 'INFRA';
  }

  private _inferFileLayer(filePath: string, info: FileInfo): RepoLayer {
    const pathLower = filePath.toLowerCase();
    const base = pathLower.split('/').pop() || '';
    const isStyleExt = /\.(css|scss|sass|less|styl)$/.test(base);

    if (info.role === 'test' || /(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(pathLower)) return 'test';
    if (/config|settings|env|dotenv|vite\.config|webpack\.config|rollup\.config|tailwind\.config|postcss\.config/.test(pathLower)) return 'backend-config';

    if (info.role === 'style' || isStyleExt) return 'frontend-style';
    if (info.role === 'store' || info.role === 'context') return 'frontend-state';
    if (info.role === 'page' || /(^|\/)(pages|routes)(\/|$)/.test(pathLower)) return 'frontend-page';

    if (info.role === 'model' || info.role === 'schema') {
      if (/migration|migrations|prisma|sequelize|typeorm|sql|database|\bdb\b/.test(pathLower)) {
        return 'backend-database';
      }
      return 'backend-schema';
    }

    if (info.role === 'api-route') return 'backend-api';

    if (info.role === 'service' || info.role === 'controller' || info.role === 'middleware' || info.role === 'serializer') {
      return 'backend-service';
    }

    if (info.role === 'component' || info.role === 'page' || info.role === 'hook' || info.role === 'view') {
      if (/layout|router|route|app\.|main\.|shell|nav|header|footer/.test(pathLower)) {
        return 'frontend-layout';
      }
      return 'frontend-ui';
    }

    if (/client|frontend|web|ui/.test(pathLower)) return 'frontend-ui';
    if (/api|endpoint|routes?/.test(pathLower)) return 'backend-api';
    if (/server|backend|controller|service/.test(pathLower)) return 'backend-service';
    if (/schema|model|entity/.test(pathLower)) return 'backend-schema';
    if (/migration|migrations|sql|database|prisma|sequelize|typeorm|\bdb\b/.test(pathLower)) return 'backend-database';

    return 'infrastructure';
  }

  private _inferRequestLayers(req: ResponsibilityVector): RepoLayer[] {
    const layers = new Set<RepoLayer>();

    if (req.ui > 0) {
      layers.add('frontend-ui');
      layers.add('frontend-layout');
    }
    if (req.style > 0) {
      layers.add('frontend-style');
      layers.add('frontend-layout');
    }
    if (req.store > 0) {
      layers.add('frontend-state');
    }
    if (req.backend > 0) {
      layers.add('backend-service');
    }
    if (req.data > 0) {
      layers.add('backend-schema');
      layers.add('backend-database');
    }

    if (layers.size === 0) {
      layers.add('frontend-ui');
      layers.add('backend-service');
    }

    return [...layers];
  }

  private _detectIntentCategories(intent: Intent, req: ResponsibilityVector): Set<IntentCategory> {
    const raw = intent.raw.toLowerCase();
    const terms = new Set<string>([...intent.keywords, ...this._tokenize(raw)]);
    const intents = new Set<IntentCategory>();

    if (req.ui > 0.3) intents.add('UI_FEATURE');
    if (req.style > 0.3 || /dark|light|theme|style|css|appearance|palette|toggle/.test(raw)) intents.add('UI_STYLE');
    if (req.data > 0.3 || /schema|model|entity|column|table|database|migration/.test(raw)) intents.add('DATA_MODEL');
    if (req.backend > 0.3 || /api|endpoint|route|webhook|handler/.test(raw)) intents.add('API_ENDPOINT');
    if (/auth|login|jwt|token|oauth|permission|role/.test(raw)) intents.add('AUTHENTICATION');
    if (/performance|optimi|latency|throughput|cache|slow/.test(raw)) intents.add('PERFORMANCE');
    if (/test|spec|coverage|assert|mock/.test(raw)) intents.add('TESTING');
    if (/config|setting|env|flag|option|parameter/.test(raw)) intents.add('CONFIGURATION');

    if (intents.size === 0) {
      if (req.ui >= req.backend && req.ui >= req.data) intents.add('UI_FEATURE');
      else if (req.backend >= req.data) intents.add('API_ENDPOINT');
      else intents.add('DATA_MODEL');
    }

    if (terms.has('toggle') && terms.has('mode')) intents.add('UI_STYLE');
    return intents;
  }

  private _intentLayersFromCategories(intents: Set<IntentCategory>, req: ResponsibilityVector): Set<RepoLayer> {
    const out = new Set<RepoLayer>();
    const add = (layers: RepoLayer[]) => layers.forEach((l) => out.add(l));

    for (const i of intents) {
      if (i === 'UI_FEATURE') add(['frontend-ui', 'frontend-layout', 'frontend-page']);
      if (i === 'UI_STYLE') add(['frontend-style', 'frontend-ui', 'frontend-layout']);
      if (i === 'DATA_MODEL') add(['backend-schema', 'backend-database']);
      if (i === 'API_ENDPOINT') add(['backend-api', 'backend-service']);
      if (i === 'AUTHENTICATION') add(['backend-service', 'backend-api', 'frontend-state']);
      if (i === 'PERFORMANCE') add(['backend-service', 'backend-api', 'frontend-state', 'infrastructure']);
      if (i === 'TESTING') add(['test']);
      if (i === 'CONFIGURATION') add(['backend-config', 'infrastructure']);
    }

    for (const l of this._inferRequestLayers(req)) out.add(l);
    return out;
  }

  private _isCriticalStyleConfig(filePath: string): boolean {
    const base = (filePath.split('/').pop() || '').toLowerCase();
    if (CRITICAL_STYLE_CONFIG_BASENAMES.has(base)) return true;
    if (base.startsWith('tailwind.config.')) return true;
    if (base.startsWith('postcss.config.')) return true;
    return false;
  }

  private _bootstrapDecision(filePath: string): { isBootstrap: boolean; reason: string } {
    const lower = filePath.toLowerCase();
    const segments = lower.split('/').filter(Boolean);
    const base = segments[segments.length - 1] || '';

    if (!BOOTSTRAP_BASENAMES.has(base)) {
      return { isBootstrap: false, reason: 'basename not in entrypoint patterns' };
    }

    // index.ts/index.tsx are only valid when directly under the root source directory.
    if (base === 'index.ts' || base === 'index.tsx') {
      const isRootSrcIndex = segments.length === 2 && segments[0] === 'src';
      if (!isRootSrcIndex) {
        return { isBootstrap: false, reason: 'not root entrypoint' };
      }
    }

    return { isBootstrap: true, reason: 'entrypoint pattern matched' };
  }

  private _isBootstrapFile(filePath: string): boolean {
    return this._bootstrapDecision(filePath).isBootstrap;
  }

  private _isLayoutShellFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return LAYOUT_HINTS.some((h) => lower.includes(h));
  }

  private _isPageFile(filePath: string, info: FileInfo): boolean {
    if (info.role === 'page') return true;
    const lower = filePath.toLowerCase();
    return /(^|\/)(pages|routes)(\/|$)/.test(lower);
  }

  private _isComponentFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return /(^|\/)components(\/|$)/.test(lower);
  }

  private _layerPenaltyFor(fileLayer: RepoLayer, requestLayers: Set<RepoLayer>, keywordScore: number): number {
    if (requestLayers.has(fileLayer)) return 0;
    return 0.60;
  }

  private _areAdjacentOrSameLayer(a: 'UI' | 'STATE' | 'SERVICE' | 'DATA' | 'INFRA', b: 'UI' | 'STATE' | 'SERVICE' | 'DATA' | 'INFRA'): boolean {
    if (a === b) return true;

    const adjacent = new Set<string>([
      'UI|STATE', 'STATE|UI',
      'STATE|SERVICE', 'SERVICE|STATE',
      'SERVICE|DATA', 'DATA|SERVICE',
      'SERVICE|INFRA', 'INFRA|SERVICE',
      'DATA|INFRA', 'INFRA|DATA',
    ]);

    return adjacent.has(a + '|' + b);
  }

  private _extractFileResponsibilitySignals(filePath: string, info: FileInfo): ResponsibilityVector {
    const content = info.contentFull.toLowerCase();
    const imports = info.imports.map((i) => i.toLowerCase()).join(' ');
    const pathLower = filePath.toLowerCase();

    const vec: ResponsibilityVector = {
      ui: 0,
      backend: 0,
      data: 0,
      store: 0,
      style: 0,
    };

    if (['component', 'page', 'hook', 'context'].includes(info.role)) vec.ui += 2.4;
    if (info.role === 'style') vec.style += 2.8;
    if (['api-route', 'controller', 'service', 'middleware', 'serializer', 'view'].includes(info.role)) vec.backend += 2.2;
    if (['model', 'schema'].includes(info.role)) vec.data += 2.4;
    if (info.role === 'store') vec.store += 2.8;

    if (/<[A-Za-z][^>]*>|\bjsx\b|\btsx\b|className\s*=|\buseState\b|\buseEffect\b/.test(content)) vec.ui += 1.8;
    if (/\.css\b|\.scss\b|\.sass\b|\.less\b/.test(imports) || /tailwind|bg-|text-|rounded-|p-[0-9]|m-[0-9]/.test(content)) {
      vec.ui += 0.9;
      vec.style += 1.5;
    }

    if (/\brouter\b|\broute\b|\bendpoint\b|\brequest\b|\bresponse\b|\breq\b|\bres\b|http|fastapi|flask|django|express|koa|spring|asp\.net/.test(content)) {
      vec.backend += 1.8;
    }

    if (/\bmodel\b|\bschema\b|\bentity\b|\btable\b|\bcolumn\b|\bmigration\b|\bquery\b|\bselect\b|\binsert\b|\bupdate\b|\bprisma\b|\bsequelize\b|\bmongoose\b|\bsqlalchemy\b|\btypeorm\b|\bdrizzle\b/.test(content)) {
      vec.data += 1.8;
    }

    if (/\bredux\b|\bzustand\b|\bpina\b|\bmobx\b|\brecoil\b|\bstore\b|\bstate\b|\bdispatch\b|\bselector\b|getstate|setstate/.test(content)) {
      vec.store += 2.1;
    }

    if (/theme|dark|light|palette|token|typography|spacing|globals?\.css/.test(content) || /globals?\.css|theme|style/.test(pathLower)) {
      vec.style += 1.6;
    }

    return vec;
  }

  private _inferRequestResponsibility(intent: Intent, expandedKeywords: Map<string, number>): ResponsibilityVector {
    const vec: ResponsibilityVector = {
      ui: 0,
      backend: 0,
      data: 0,
      store: 0,
      style: 0,
    };

    const terms = new Set<string>([...intent.keywords, ...expandedKeywords.keys(), ...this._tokenize(intent.raw)]);
    const addWeight = (key: keyof ResponsibilityVector, amount: number) => {
      vec[key] += amount;
    };

    for (const t of terms) {
      if (/ui|frontend|front|screen|view|component|page|dialog|modal|form|input|button|navbar|header|footer|layout/.test(t)) addWeight('ui', 1.3);
      if (/theme|dark|light|toggle|style|css|color|palette|typography|spacing|responsive/.test(t)) {
        addWeight('ui', 0.8);
        addWeight('style', 1.5);
      }
      if (/api|endpoint|route|router|controller|service|middleware|request|response|auth|token|jwt|server|backend/.test(t)) addWeight('backend', 1.4);
      if (/model|schema|entity|table|column|database|db|sql|query|migration|orm|repository/.test(t)) addWeight('data', 1.5);
      if (/state|store|cache|session|context|redux|zustand|mobx|recoil|pinia/.test(t)) addWeight('store', 1.6);
    }

    if (intent.action === 'fix' || intent.action === 'update') {
      vec.backend += 0.2;
      vec.data += 0.2;
    }

    return vec;
  }

  private _responsibilityOverlap(fileVec: ResponsibilityVector, reqVec: ResponsibilityVector): number {
    const keys: Array<keyof ResponsibilityVector> = ['ui', 'backend', 'data', 'store', 'style'];
    const reqNorm = keys.reduce((sum, k) => sum + reqVec[k], 0);
    const fileNorm = keys.reduce((sum, k) => sum + fileVec[k], 0);
    if (reqNorm <= 0 || fileNorm <= 0) return 0;

    let dot = 0;
    for (const k of keys) {
      dot += (reqVec[k] / reqNorm) * (fileVec[k] / fileNorm);
    }
    return Math.max(0, Math.min(1, dot));
  }

  private _semanticSeedHint(filePath: string, info: FileInfo, expandedKeywords: Map<string, number>): number {
    const terms = [...expandedKeywords.keys()];
    if (terms.length === 0) return 0;

    const basename = (filePath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase();
    const symbols = [basename, ...info.exports, ...info.functions, ...info.classes]
      .flatMap((s) => this._splitIdentifier(s.toLowerCase()))
      .filter(Boolean);
    const uniqSymbols = new Set(symbols);

    let hits = 0;
    for (const term of terms) {
      if (term.length < 3) continue;
      if (uniqSymbols.has(term)) {
        hits++;
        continue;
      }

      for (const sym of uniqSymbols) {
        if (sym.includes(term) || term.includes(sym)) {
          hits++;
          break;
        }
      }
    }

    const norm = Math.max(1, Math.min(12, terms.length));
    return Math.max(0, Math.min(1, hits / norm));
  }

  private _responsibilityDebugLabels(vec: ResponsibilityVector): string[] {
    const out: string[] = [];
    const entries: Array<[keyof ResponsibilityVector, number]> = [
      ['ui', vec.ui],
      ['backend', vec.backend],
      ['data', vec.data],
      ['store', vec.store],
      ['style', vec.style],
    ];
    entries
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => out.push(k + '(' + v.toFixed(2) + ')'));
    return out;
  }

  private _selectSeeds(scored: SeedCandidate[]): SeedCandidate[] {
    const priority = (c: SeedCandidate): number => {
      if (this._isBootstrapFile(c.path)) return 4;
      if (this._isLayoutShellFile(c.path)) return 3;
      if (c.responsibilityScore >= 0.45) return 2;
      return 1;
    };

    const nonHubScored = scored.filter((f) => !this._isHubNode(f.path) || priority(f) >= 3);
    if (nonHubScored.length === 0) return [];

    nonHubScored.sort((a, b) =>
      priority(b) - priority(a) ||
      b.responsibilityScore - a.responsibilityScore ||
      b.keywordScore - a.keywordScore ||
      b.seedScore - a.seedScore ||
      a.path.localeCompare(b.path)
    );

    const values = nonHubScored.map((f) => f.seedScore);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const seedThreshold = mean + (0.35 * stdDev);

    const selected = nonHubScored.filter((f) => priority(f) >= 3 || f.seedScore >= seedThreshold);
    if (selected.length >= 2) return selected.slice(0, 6);

    return nonHubScored.slice(0, Math.min(6, Math.max(2, nonHubScored.length)));
  }

  private _buildAdjacency(): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();

    for (const filePath of this.graph.keys()) {
      adjacency.set(filePath, []);
    }

    for (const [filePath, deps] of this.depMap.dependencies) {
      const neighbors = adjacency.get(filePath) || [];
      for (const d of deps) neighbors.push(d);
      adjacency.set(filePath, neighbors);
    }

    for (const [filePath, parents] of this.depMap.dependents) {
      const neighbors = adjacency.get(filePath) || [];
      for (const p of parents) neighbors.push(p);
      adjacency.set(filePath, neighbors);
    }

    for (const [filePath, neighbors] of adjacency) {
      adjacency.set(filePath, [...new Set(neighbors)]);
    }

    return adjacency;
  }

  private _buildClusters(adjacency: Map<string, string[]>): ClusterContext {
    const nodes = [...this.graph.keys()].sort((a, b) => a.localeCompare(b));
    const labelByNode = new Map<string, number>();
    nodes.forEach((n, i) => labelByNode.set(n, i));

    for (let iter = 0; iter < 12; iter++) {
      let changed = false;

      for (const node of nodes) {
        const neighbors = adjacency.get(node) || [];
        if (neighbors.length === 0) continue;

        const counts = new Map<number, number>();
        for (const nb of neighbors) {
          const label = labelByNode.get(nb);
          if (label === undefined) continue;
          counts.set(label, (counts.get(label) || 0) + 1);
        }
        if (counts.size === 0) continue;

        let bestLabel = labelByNode.get(node)!;
        let bestCount = -1;
        for (const [label, count] of counts) {
          if (count > bestCount || (count === bestCount && label < bestLabel)) {
            bestLabel = label;
            bestCount = count;
          }
        }

        if (bestLabel !== labelByNode.get(node)) {
          labelByNode.set(node, bestLabel);
          changed = true;
        }
      }

      if (!changed) break;
    }

    const normalized = new Map<number, number>();
    let nextClusterId = 0;
    const fileCluster = new Map<string, number>();
    const clusterMembers = new Map<number, Set<string>>();

    for (const node of nodes) {
      const raw = labelByNode.get(node)!;
      if (!normalized.has(raw)) normalized.set(raw, nextClusterId++);
      const clusterId = normalized.get(raw)!;
      fileCluster.set(node, clusterId);
      if (!clusterMembers.has(clusterId)) clusterMembers.set(clusterId, new Set<string>());
      clusterMembers.get(clusterId)!.add(node);
    }

    const clusterAdjacency = new Map<number, Set<number>>();
    for (const [node, neighbors] of adjacency) {
      const c1 = fileCluster.get(node);
      if (c1 === undefined) continue;
      if (!clusterAdjacency.has(c1)) clusterAdjacency.set(c1, new Set<number>());

      for (const nb of neighbors) {
        const c2 = fileCluster.get(nb);
        if (c2 === undefined || c1 === c2) continue;
        clusterAdjacency.get(c1)!.add(c2);
        if (!clusterAdjacency.has(c2)) clusterAdjacency.set(c2, new Set<number>());
        clusterAdjacency.get(c2)!.add(c1);
      }
    }

    return { fileCluster, clusterMembers, clusterAdjacency };
  }

  private _dominantSeedCluster(seedPaths: string[], fileCluster: Map<string, number>): number {
    const freq = new Map<number, number>();
    for (const p of seedPaths) {
      const cid = fileCluster.get(p);
      if (cid === undefined) continue;
      freq.set(cid, (freq.get(cid) || 0) + 1);
    }

    let best = -1;
    let count = -1;
    for (const [cid, c] of freq) {
      if (c > count || (c === count && cid < best)) {
        best = cid;
        count = c;
      }
    }
    return best;
  }

  private _distanceScore(depth: number): number {
    if (depth <= 0) return 1.0;
    if (depth === 1) return 0.7;
    if (depth === 2) return 0.4;
    if (depth === 3) return 0.2;
    return 0;
  }

  private _computePathSimilarity(filePath: string, seedPaths: string[]): number {
    const dirs = filePath.split('/').slice(0, -1);
    if (seedPaths.length === 0) return 0;

    let best = 0;
    for (const seed of seedPaths) {
      const seedDirs = seed.split('/').slice(0, -1);
      let common = 0;
      const n = Math.min(dirs.length, seedDirs.length);
      while (common < n && dirs[common] === seedDirs[common]) {
        common++;
      }

      const denom = Math.max(1, Math.max(dirs.length, seedDirs.length));
      const sim = common / denom;
      if (sim > best) best = sim;
    }
    return best;
  }

  private _clusterSimilarity(
    filePath: string,
    seedCluster: number,
    fileCluster: Map<string, number>,
    clusterAdjacency: Map<number, Set<number>>
  ): number {
    if (seedCluster < 0) return 0.1;
    const cid = fileCluster.get(filePath);
    if (cid === undefined) return 0.1;
    if (cid === seedCluster) return 1.0;

    const adjacent = clusterAdjacency.get(seedCluster);
    if (adjacent && adjacent.has(cid)) return 0.4;
    return 0.1;
  }

  private _bfsFromSeeds(
    seedPaths: string[],
    adjacency: Map<string, string[]>,
    maxDepth: number,
    fileCluster: Map<string, number>,
    seedCluster: number,
    keywordRawByPath: Map<string, number>,
    maxKeywordRaw: number,
    dbg?: DebugFn
  ): TraversalResult {
    const distances = new Map<string, number>();
    const proximityByPath = new Map<string, number>();
    const parents = new Map<string, string>();
    const transitions = new Set<string>();
    const queue: Array<{ path: string; depth: number }> = [];

    const decayByDepth = (depth: number): number => {
      if (depth <= 0) return 1.0;
      if (depth === 1) return 0.7;
      if (depth === 2) return 0.4;
      if (depth === 3) return 0.2;
      return 0;
    };

    for (const p of seedPaths) {
      distances.set(p, 0);
      proximityByPath.set(p, 1.0);
      queue.push({ path: p, depth: 0 });
      if (dbg && DEBUG_RELEVANCE_PIPELINE) dbg('Seed: ' + p);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const currentCluster = fileCluster.get(current.path);
      const neighbors = (adjacency.get(current.path) || []).slice().sort((a, b) => {
        const aSame = fileCluster.get(a) === seedCluster ? 1 : 0;
        const bSame = fileCluster.get(b) === seedCluster ? 1 : 0;
        if (aSame !== bSame) return bSame - aSame;
        return a.localeCompare(b);
      });

      for (const next of neighbors) {
        if (distances.has(next)) continue;
        const info = this.graph.get(next);
        if (!info) continue;

        const nextDepth = current.depth + 1;

        const nextCluster = fileCluster.get(next);
        if (currentCluster !== undefined && nextCluster !== undefined && currentCluster !== nextCluster) {
          transitions.add(currentCluster + ' -> ' + nextCluster + ' via ' + next);
        }

        distances.set(next, nextDepth);
        proximityByPath.set(next, decayByDepth(nextDepth));
        parents.set(next, current.path);
        queue.push({ path: next, depth: nextDepth });
        if (dbg && DEBUG_RELEVANCE_PIPELINE) {
          dbg('Depth ' + nextDepth + ' -> ' + next);
          dbg('GraphProximity propagated: ' + next + ' = ' + decayByDepth(nextDepth).toFixed(3));
        }
      }
    }

    return {
      distances,
      proximityByPath,
      parents,
      clusterTransitions: [...transitions].sort((a, b) => a.localeCompare(b)),
    };
  }

  private _detectArchitectureChains(
    selectedPaths: Set<string>,
    adjacency: Map<string, string[]>
  ): Map<string, string> {
    const chains = new Map<string, string>();

    for (const sourcePath of selectedPaths) {
      const sourceInfo = this.graph.get(sourcePath);
      if (!sourceInfo) continue;

      const sourceIsUI = UI_ROLES.has(sourceInfo.role);
      const sourceIsAPI = API_ROLES.has(sourceInfo.role);
      if (!sourceIsUI && !sourceIsAPI) continue;

      const neighbors = adjacency.get(sourcePath) || [];
      for (const target of neighbors) {
        if (selectedPaths.has(target)) continue;
        if (this._isHubNode(target)) continue;

        const targetInfo = this.graph.get(target);
        if (!targetInfo) continue;

        const targetIsUI = UI_ROLES.has(targetInfo.role);
        const targetIsAPI = API_ROLES.has(targetInfo.role);
        const adjacentLayer = (sourceIsUI && targetIsAPI) || (sourceIsAPI && targetIsUI);
        if (!adjacentLayer) continue;

        chains.set(target, sourcePath);
      }
    }

    return chains;
  }

  private _reconstructPath(target: string, parents: Map<string, string>): string[] {
    const path: string[] = [target];
    let current = target;
    while (parents.has(current)) {
      const p = parents.get(current)!;
      path.unshift(p);
      current = p;
    }
    return path;
  }

  private _roleBucket(role: string): string {
    if (role === 'service') return 'service';
    if (role === 'controller') return 'controller';
    if (role === 'model' || role === 'schema') return 'data';
    if (role === 'api-route') return 'api';
    if (role === 'component' || role === 'page' || role === 'hook' || role === 'context' || role === 'store' || role === 'style') return 'ui';
    return 'other';
  }

  private _majoritySeedRoleBucket(): string | null {
    if (this._lastSelectionDebug.seeds.length === 0) return null;
    const counts = new Map<string, number>();

    for (const p of this._lastSelectionDebug.seeds) {
      const info = this.graph.get(p);
      if (!info) continue;
      const b = this._roleBucket(info.role);
      counts.set(b, (counts.get(b) || 0) + 1);
    }

    let best: string | null = null;
    let count = -1;
    for (const [bucket, c] of counts) {
      if (c > count || (c === count && (best === null || bucket.localeCompare(best) < 0))) {
        best = bucket;
        count = c;
      }
    }
    return best;
  }

  private _findRelevantFiles(_intent: Intent, expandedKeywords: Map<string, number>, dbg?: DebugFn): RelevantFile[] {
    const originalKeywordWeights = _intent.keywords.map((k) => k + '=1.00');
    const expansionKeywordWeights = [...expandedKeywords.entries()]
      .filter(([k]) => !_intent.keywords.includes(k))
      .map(([k, w]) => k + '=' + this._clamp01(w).toFixed(2));
    const requestResponsibility = this._inferRequestResponsibility(_intent, expandedKeywords);
    const detectedIntents = this._detectIntentCategories(_intent, requestResponsibility);
    const requestLayers = this._intentLayersFromCategories(detectedIntents, requestResponsibility);

    const adjacency = this._buildAdjacency();
    const dependencyAdjacency = new Map<string, string[]>();
    for (const [k, v] of adjacency) dependencyAdjacency.set(k, [...v]);
    const semanticRawByPath = new Map<string, number>();
    const symbolRawByPath = new Map<string, number>();
    const symbolOwners = new Map<string, Set<string>>();
    const filteredNoise: string[] = [];

    const keywordTerms = [...expandedKeywords.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k.toLowerCase());

    for (const [filePath, info] of this.graph) {
      const semanticRaw = Math.max(0, this._scoreFileForIntent(filePath, info, expandedKeywords));
      semanticRawByPath.set(filePath, semanticRaw);

      const symbols = [...info.exports, ...info.functions, ...info.classes].map((s) => s.toLowerCase());
      let symbolRaw = 0;
      for (const [term, weight] of expandedKeywords) {
        if (symbols.some((s) => s.includes(term))) {
          symbolRaw += 2.5 * weight;
        }
      }
      symbolRawByPath.set(filePath, symbolRaw);

      for (const sym of symbols) {
        for (const token of this._splitIdentifier(sym)) {
          if (token.length < 3) continue;
          if (!symbolOwners.has(token)) symbolOwners.set(token, new Set<string>());
          symbolOwners.get(token)!.add(filePath);
        }
      }
    }

    const maxSemanticRaw = Math.max(1, ...semanticRawByPath.values(), 0);
    const maxSymbolRaw = Math.max(1, ...symbolRawByPath.values(), 0);

    const semanticCandidates: Array<{ path: string; info: FileInfo; semanticScore: number; symbolMatchScore: number }> = [];
    for (const [filePath, info] of this.graph) {
      const semanticScore = this._clamp01((semanticRawByPath.get(filePath) || 0) / maxSemanticRaw);
      const symbolMatchScore = this._clamp01((symbolRawByPath.get(filePath) || 0) / maxSymbolRaw);
      if (semanticScore <= 0) continue;
      semanticCandidates.push({ path: filePath, info, semanticScore, symbolMatchScore });
    }

    const responsibilityScoreByPath = new Map<string, number>();
    for (const [path, info] of this.graph) {
      const symbols = [...info.exports, ...info.functions, ...info.classes].map((s) => s.toLowerCase());
      let hits = 0;
      for (const kw of RESPONSIBILITY_KEYWORDS) {
        if (symbols.some((s) => s.includes(kw))) hits++;
      }
      const score = hits > 0 ? Math.min(1, 0.5 + (0.1 * hits)) : 0;
      responsibilityScoreByPath.set(path, this._clamp01(score));
    }

    semanticCandidates.sort((a, b) => b.semanticScore - a.semanticScore || b.symbolMatchScore - a.symbolMatchScore || a.path.localeCompare(b.path));
    const stage1Candidates = semanticCandidates.slice(0, 20);
    const seedFiltering = stage1Candidates.map((c) => {
      const responsibilityScore = this._clamp01(responsibilityScoreByPath.get(c.path) || 0);
      const seedScore = this._clamp01(c.semanticScore * c.symbolMatchScore * responsibilityScore);
      return {
        path: c.path,
        semanticScore: c.semanticScore,
        symbolMatchScore: c.symbolMatchScore,
        responsibilityScore,
        seedScore,
      };
    });

    seedFiltering.sort((a, b) =>
      b.seedScore - a.seedScore ||
      b.responsibilityScore - a.responsibilityScore ||
      b.semanticScore - a.semanticScore ||
      b.symbolMatchScore - a.symbolMatchScore ||
      a.path.localeCompare(b.path)
    );

    const seedPaths = seedFiltering.slice(0, Math.min(6, seedFiltering.length)).map((c) => c.path);
    const seedPathSet = new Set(seedPaths);

    // Dominant feature cluster over dependency-graph reachability from top-10 semantic seeds.
    const clusterReachable = new Set<string>(seedPaths);
    const clusterQueue: Array<{ path: string; depth: number }> = seedPaths.map((p) => ({ path: p, depth: 0 }));
    while (clusterQueue.length > 0) {
      const current = clusterQueue.shift()!;
      if (current.depth >= 2) continue;
      for (const next of dependencyAdjacency.get(current.path) || []) {
        if (clusterReachable.has(next)) continue;
        clusterReachable.add(next);
        clusterQueue.push({ path: next, depth: current.depth + 1 });
      }
    }

    const visitedStage1 = new Set<string>();
    const stage1Components: string[][] = [];
    for (const path of clusterReachable) {
      if (visitedStage1.has(path)) continue;
      const stack = [path];
      visitedStage1.add(path);
      const comp: string[] = [];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nb of dependencyAdjacency.get(cur) || []) {
          if (!clusterReachable.has(nb) || visitedStage1.has(nb)) continue;
          visitedStage1.add(nb);
          stack.push(nb);
        }
      }
      stage1Components.push(comp.sort((a, b) => a.localeCompare(b)));
    }
    const clusterScored = stage1Components.map((members, idx) => {
      const seedCount = members.filter((m) => seedPathSet.has(m)).length;
      const avgSemantic = members.length > 0
        ? members.reduce((sum, p) => sum + this._clamp01((semanticRawByPath.get(p) || 0) / maxSemanticRaw), 0) / members.length
        : 0;
      const clusterScore = (seedCount * 2) + avgSemantic;
      return { id: idx, members, seedCount, avgSemantic, clusterScore };
    });
    clusterScored.sort((a, b) => b.clusterScore - a.clusterScore || b.seedCount - a.seedCount || a.id - b.id);

    const featureCluster = new Set<string>((clusterScored[0]?.members) || []);
    const dominantClusterId = clusterScored.length > 0 ? clusterScored[0].id : -1;
    if (featureCluster.size === 0) {
      // Fallback when no edges connect top semantic candidates.
      for (const p of seedPaths) featureCluster.add(p);
    }

    if (dbg && DEBUG_RELEVANCE_PIPELINE) {
      dbg('SEMANTIC CANDIDATES:');
      stage1Candidates.forEach((c) => dbg(c.path + ' semantic=' + c.semanticScore.toFixed(3) + ' symbol=' + c.symbolMatchScore.toFixed(3)));
      dbg('SEED FILTERING:');
      seedFiltering.slice(0, 30).forEach((s) => {
        dbg(
          s.path +
          ' -> semantic=' + s.semanticScore.toFixed(3) +
          ' -> symbolMatch=' + s.symbolMatchScore.toFixed(3) +
          ' -> responsibility=' + s.responsibilityScore.toFixed(3) +
          ' -> seedScore=' + s.seedScore.toFixed(3)
        );
      });
      dbg('SELECTED SEEDS:');
      seedPaths.forEach((p) => dbg(p));
      dbg('CLUSTER SCORES:');
      clusterScored.forEach((c) => dbg(
        'cluster_' + c.id +
        ' -> seed_count=' + c.seedCount +
        ' -> avg_semantic=' + c.avgSemantic.toFixed(3) +
        ' -> final_cluster_score=' + c.clusterScore.toFixed(3)
      ));
      dbg('FEATURE CLUSTER MEMBERS:');
      [...featureCluster].sort((a, b) => a.localeCompare(b)).forEach((p) => dbg(p));
    }

    const addUndirectedEdge = (a: string, b: string): void => {
      if (a === b) return;
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.set(a, [...new Set([...(adjacency.get(a) || []), b])]);
      adjacency.set(b, [...new Set([...(adjacency.get(b) || []), a])]);
    };

    // Dependency expansion enrichment: symbol-call edges and API-oriented cross links.
    for (const seed of seedPaths) {
      const seedInfo = this.graph.get(seed);
      if (!seedInfo) continue;
      const contentLower = seedInfo.contentFull.toLowerCase();

      const fnMatches = [...contentLower.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)].slice(0, 120);
      for (const m of fnMatches) {
        const token = (m[1] || '').toLowerCase();
        if (token.length < 3) continue;
        const owners = symbolOwners.get(token);
        if (!owners) continue;
        for (const owner of owners) addUndirectedEdge(seed, owner);
      }

      if (/fetch\(|axios\.|http\.|\/api\//.test(contentLower)) {
        for (const [path, info] of this.graph) {
          if (!['api-route', 'controller', 'service', 'model', 'schema'].includes(info.role)) continue;
          const lower = path.toLowerCase();
          if (keywordTerms.some((k) => k.length >= 3 && lower.includes(k))) {
            addUndirectedEdge(seed, path);
          }
        }
      }
    }

    const distances = new Map<string, number>();
    const parents = new Map<string, string>();
    const queue: Array<{ path: string; depth: number }> = [];
    for (const s of seedPaths) {
      distances.set(s, 0);
      queue.push({ path: s, depth: 0 });
    }

    // Multi-source BFS gives minimum shortest-path distance from any semantic seed.
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of dependencyAdjacency.get(current.path) || []) {
        const nextDepth = current.depth + 1;
        const existing = distances.get(next);
        if (existing !== undefined && existing <= nextDepth) continue;
        distances.set(next, nextDepth);
        if (!seedPathSet.has(next)) parents.set(next, current.path);
        queue.push({ path: next, depth: nextDepth });
      }
    }

    const expandedPaths = new Set<string>([...seedPaths, ...distances.keys()]);
    const expandedOnly = [...expandedPaths]
      .filter((p) => !seedPathSet.has(p))
      .sort((a, b) => (distances.get(a) || 999) - (distances.get(b) || 999) || a.localeCompare(b));
    if (dbg && DEBUG_RELEVANCE_PIPELINE) {
      dbg('DEPENDENCY EXPANSION:');
      expandedOnly.slice(0, 80).forEach((p) => dbg(p + ' distance=' + (distances.get(p) ?? 999)));
      dbg('SHORTEST PATH DISTANCES:');
      [...distances.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .slice(0, 120)
        .forEach(([p, d]) => dbg(p + ' -> ' + d));
    }

    const isStructuralNoise = (filePath: string, info: FileInfo): boolean => {
      const lower = filePath.toLowerCase();
      const base = lower.split('/').pop() || '';
      if (this._isCriticalStyleConfig(filePath)) return false;
      if (seedPathSet.has(filePath)) return false;
      if (/^config\./.test(base) || /\.config\./.test(base)) return true;
      if (info.role === 'config' && !keywordTerms.some((k) => k.length >= 4 && lower.includes(k))) return true;
      if (base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml') return true;
      if (/^vite-env\.d\.ts$/.test(base)) return true;
      if (base === 'seed.py') return true;
      if (base === 'main.py') {
        const directlyReferenced = (adjacency.get(filePath) || []).some((n) => expandedPaths.has(n));
        if (!directlyReferenced) return true;
      }
      if (/^(tsconfig|eslint|prettier|babel|jest|vitest|webpack|rollup|commitlint)(\.|$)/.test(base)) return true;
      if (/(^|\/)(scripts|tooling|build|dist|coverage|\.github|\.vscode)(\/|$)/.test(lower)) return true;
      return false;
    };

    const stage3Paths = [...expandedPaths].filter((p) => {
      const info = this.graph.get(p);
      if (!info) return false;
      if (!isStructuralNoise(p, info)) return true;
      filteredNoise.push(p);
      return false;
    });

    const clusterPenalizedFiles: string[] = stage3Paths
      .filter((p) => !featureCluster.has(p) && !seedPathSet.has(p))
      .sort((a, b) => a.localeCompare(b));

    if (dbg && DEBUG_RELEVANCE_PIPELINE) {
      dbg('FILTERED FILES:');
      [...new Set(filteredNoise)].sort((a, b) => a.localeCompare(b)).forEach((p) => dbg(p));
      dbg('CLUSTER PENALIZED FILES:');
      clusterPenalizedFiles.forEach((p) => dbg(p));
    }

    const dependencyScore = (path: string): number => {
      const d = distances.get(path);
      if (d === undefined) return 0;
      if (!seedPathSet.has(path) && d === 0) return 0;
      return this._clamp01(1 / (1 + d));
    };

    if (dbg && DEBUG_RELEVANCE_PIPELINE) {
      dbg('RESPONSIBILITY SCORES:');
      [...responsibilityScoreByPath.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 80)
        .forEach(([p, v]) => dbg(p + ' -> ' + v.toFixed(3)));
    }

    const ranked: CandidateScore[] = stage3Paths.map((path) => {
      const info = this.graph.get(path)!;
      const semanticScore = this._clamp01((semanticRawByPath.get(path) || 0) / maxSemanticRaw);
      const symbolMatchScore = this._clamp01((symbolRawByPath.get(path) || 0) / maxSymbolRaw);
      const depScore = this._clamp01(dependencyScore(path));
      const responsibilityScore = this._clamp01(responsibilityScoreByPath.get(path) || 0);
      const clusterPenalty = featureCluster.has(path) || seedPathSet.has(path) ? 0 : 0.40;
      const finalScore = this._clamp01(
        0.35 * semanticScore +
        0.25 * depScore +
        0.30 * symbolMatchScore +
        0.10 * responsibilityScore -
        clusterPenalty
      );

      const reason = seedPathSet.has(path) ? 'semantic-candidate' : 'dependency-expanded';
      const connectionPath = seedPathSet.has(path)
        ? [path]
        : (distances.has(path) ? this._reconstructPath(path, parents) : [path]);

      return {
        path,
        info,
        keywordRaw: semanticRawByPath.get(path) || 0,
        keywordScore: semanticScore,
        responsibilityScore,
        dependencyDistance: distances.get(path) ?? 999,
        graphProximity: depScore,
        clusterSimilarity: 0,
        pathSimilarity: 0,
        clusterId: -1,
        semanticPairScore: symbolMatchScore,
        centralityScore: 0,
        hubPenalty: 0,
        connectorBoost: 0,
        bridgeBoost: 0,
        clusterPenalty,
        infraPenalty: 0,
        layerPenalty: 0,
        leafPenalty: 0,
        relevanceScore: finalScore,
        reason,
        connectionPath,
      };
    });

    ranked.sort((a, b) =>
      b.relevanceScore - a.relevanceScore ||
      a.dependencyDistance - b.dependencyDistance ||
      a.path.localeCompare(b.path)
    );

    if (dbg && DEBUG_RELEVANCE_PIPELINE) {
      dbg('FINAL SCORE BREAKDOWN:');
      ranked.slice(0, 20).forEach((r) => {
        dbg(r.path +
          ' -> semantic=' + (r.keywordScore || 0).toFixed(3) +
          ' dependency=' + r.graphProximity.toFixed(3) +
          ' symbolMatch=' + r.semanticPairScore.toFixed(3) +
          ' responsibility=' + (r.responsibilityScore || 0).toFixed(3) +
          ' clusterPenalty=' + r.clusterPenalty.toFixed(2) +
          ' finalScore=' + r.relevanceScore.toFixed(3));
      });
      dbg('FINAL RANKING:');
      ranked.slice(0, 20).forEach((r) => dbg(r.path + ' -> ' + r.relevanceScore.toFixed(3)));
    }

    const selected = ranked.slice(0, 12).map((r) => ({
      path: r.path,
      info: r.info,
      score: Number(r.relevanceScore.toFixed(3)),
      reason: r.reason,
      connectionPath: r.connectionPath,
    }));

    this._lastSelectionDebug = {
      seeds: seedPaths,
      traversal: [...distances.entries()]
        .filter(([p, d]) => d > 0 && !seedPathSet.has(p))
        .map(([path, distance]) => ({ path, distance }))
        .sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path)),
      architectureChains: [],
      filteredNoise: [...new Set(filteredNoise)].sort((a, b) => a.localeCompare(b)),
      clusterCount: stage1Components.length,
      seedCluster: dominantClusterId,
      clusterFilteredOut: [...new Set(clusterPenalizedFiles)].sort((a, b) => a.localeCompare(b)),
      clusterTransitions: [],
      responsibilitySignals: this._responsibilityDebugLabels(requestResponsibility),
      anchorBoostedFiles: [],
      topRejectedBeforeSeed: semanticCandidates
        .slice(20, 35)
        .map((s) => s.path + ' semantic=' + s.semanticScore.toFixed(3)),
      seedScoreBreakdown: stage1Candidates
        .slice(0, 20)
        .map((c) => c.path + ' semantic=' + c.semanticScore.toFixed(3) + ' symbol=' + c.symbolMatchScore.toFixed(3)),
      originalKeywordWeights,
      expansionKeywordWeights,
      anchorScores: [],
      graphProximityTop: ranked
        .slice()
        .sort((a, b) => b.graphProximity - a.graphProximity || a.path.localeCompare(b.path))
        .slice(0, 20)
        .map((r) => r.path + ' dependencyScore=' + r.graphProximity.toFixed(3)),
      leafPenaltyTop: [],
      hubPenaltyTop: [],
      connectorBoostTop: [],
      bridgeBoostTop: [],
      clusterPenaltyTop: ranked
        .slice()
        .filter((r) => r.clusterPenalty > 0)
        .sort((a, b) => b.clusterPenalty - a.clusterPenalty || a.path.localeCompare(b.path))
        .slice(0, 20)
        .map((r) => r.path + ' clusterPenalty=' + r.clusterPenalty.toFixed(3)),
      infraPenaltyTop: [],
      layerPenaltyTop: [],
      detectedIntents: [...detectedIntents],
      intentLayers: [...requestLayers],
      seedReasoning: stage1Candidates
        .slice(0, 20)
        .map((c) => c.path + ' stage1 semantic candidate'),
      keywordExpansionSource: 'semantic-only',
    };

    return selected;
  }

  private _findExistingPatterns(
    relevantFiles: RelevantFile[],
    expandedKeywords: Map<string, number>
  ): Pattern[] {
    const patterns: Pattern[] = [];

    const primaryPaths = new Set(relevantFiles.map((f) => f.path));
    const IMPLEMENTATION_ROLES = new Set([
      'component', 'page', 'service', 'api-route', 'controller',
      'hook', 'store', 'model', 'schema', 'middleware', 'view', 'serializer',
    ]);

    let bestTestScore = -1;
    let bestTestPath = '';
    for (const [p, info] of this.graph) {
      if (info.role !== 'test') continue;
      const score = this._scoreFileForIntent(p, info, expandedKeywords);
      if (score > bestTestScore) {
        bestTestScore = score;
        bestTestPath = p;
      }
    }
    if (!bestTestPath) {
      let latestMtime = -1;
      for (const [p, info] of this.graph) {
        if (info.role !== 'test') continue;
        try {
          const mtime = fs.statSync(info.absolutePath).mtimeMs;
          if (mtime > latestMtime) {
            latestMtime = mtime;
            bestTestPath = p;
          }
        } catch {
          if (!bestTestPath) bestTestPath = p;
        }
      }
    }
    if (bestTestPath) {
      const info = this.graph.get(bestTestPath)!;
      patterns.push({
        type: 'test-pattern',
        path: bestTestPath,
        description: 'Copy this test file structure for new test coverage',
        exports: info.functions.slice(0, 3),
      });
    }

    const majoritySeedBucket = this._majoritySeedRoleBucket();
    const topPrimaryRole = relevantFiles[0]?.info.role;
    let bestImplScore = -1;
    let bestImplPath = '';

    for (const [p, info] of this.graph) {
      if (primaryPaths.has(p)) continue;
      if (!IMPLEMENTATION_ROLES.has(info.role)) continue;
      if (info.role === 'test') continue;
      if (majoritySeedBucket && this._roleBucket(info.role) !== majoritySeedBucket) continue;

      const score = this._scoreFileForIntent(p, info, expandedKeywords);
      if (score <= 0) continue;

      const roleBonus = info.role === topPrimaryRole ? 5 : 0;
      const effectiveScore = score + roleBonus;
      if (effectiveScore > bestImplScore) {
        bestImplScore = effectiveScore;
        bestImplPath = p;
      }
    }

    if (bestImplPath) {
      const info = this.graph.get(bestImplPath)!;
      patterns.push({
        type: 'implementation-pattern',
        path: bestImplPath,
        description: 'Existing ' + info.role + ' to follow for structure and conventions',
        exports: info.exports.slice(0, 3),
      });
    }

    return patterns;
  }

  private _findCascadingFiles(
    relevantFiles: RelevantFile[],
    expandedKeywords: Map<string, number>
  ): string[] {
    const primaryPaths = new Set(relevantFiles.map((f) => f.path));
    const candidates = new Set<string>();

    for (const { path: p } of relevantFiles) {
      const dependents = this.depMap.dependents.get(p) || [];
      for (const dependent of dependents) {
        if (primaryPaths.has(dependent)) continue;
        if (this._isHubNode(dependent)) continue;
        const info = this.graph.get(dependent);
        if (!info) continue;
        if (info.role === 'test' || info.role === 'config' || info.role === 'style') continue;
        candidates.add(dependent);
      }
    }

    const relevant = [...candidates].filter((p) => {
      const info = this.graph.get(p);
      if (!info) return false;
      return this._scoreFileForIntent(p, info, expandedKeywords) > 0;
    });

    return relevant.slice(0, 6);
  }

  private _extractConventions(): Convention[] {
    const conventions: Convention[] = [];
    conventions.push({ name: 'Import Style', description: this.stack.importStyle, example: '' });

    const hasAsync = [...this.graph.values()].some((info) => info.contentFull.includes('async/await') || info.contentFull.includes('async '));
    if (hasAsync) {
      conventions.push({ name: 'Async Pattern', description: 'Use async/await over Promise chaining', example: '' });
    }

    return conventions;
  }

  private _buildPrompt(
    userInput: string,
    intent: Intent,
    relevantFiles: RelevantFile[],
    patterns: Pattern[],
    cascadingFiles: string[],
    conventions: Convention[]
  ): string {
    const lines: string[] = [];

    lines.push('# Architectural Implementation Prompt');
    lines.push(`**Request:** ${userInput}`);
    lines.push(`**Action:** ${intent.action.toUpperCase()}`);
    lines.push('');

    lines.push('## 1. Repository Context');
    lines.push(`- **Stack:** ${this.stack.summary}`);
    if (this.stack.frameworks.length > 0) lines.push(`- **Frameworks:** ${this.stack.frameworks.join(', ')}`);
    if (this.stack.testFramework) lines.push(`- **Test Framework:** ${this.stack.testFramework}`);
    if (this.stack.database) lines.push(`- **Database/ORM:** ${this.stack.database}`);
    if (this.stack.cssApproach) lines.push(`- **CSS Approach:** ${this.stack.cssApproach}`);
    if (this.stack.stateManagement) lines.push(`- **State Management:** ${this.stack.stateManagement}`);
    lines.push(`- **Import Style:** ${this.stack.importStyle}`);
    lines.push(`- **Codebase Size:** ${this.graph.size} files scanned`);
    lines.push('');

    if (patterns.length > 0) {
      lines.push('## 2. Existing Patterns to Follow');
      lines.push('Reuse these existing files as reference implementations:');
      for (const p of patterns) {
        lines.push(`- \`${p.path}\` - ${p.description}${p.exports.length > 0 ? ` (exports: ${p.exports.join(', ')})` : ''}`);
      }
      lines.push('');
    }

    if (relevantFiles.length > 0) {
      lines.push('## 3. Files to Modify');
      lines.push('These files are directly relevant to the request:');
      for (const file of relevantFiles) {
        const keySymbols = [...file.info.functions.slice(0, 3), ...file.info.exports.slice(0, 3)].join(', ');
        lines.push('');
        lines.push(`### \`${file.path}\``);
        lines.push(`- **Role:** ${file.info.role}`);
        if (keySymbols) lines.push(`- **Key symbols:** ${keySymbols}`);
        if (file.info.hasTest && file.info.testFilePath) {
          lines.push(`- **Test file:** \`${file.info.testFilePath}\``);
        }
      }
      lines.push('');
    }

    if (cascadingFiles.length > 0) {
      lines.push('## 4. Cascading Changes Required');
      for (const filePath of cascadingFiles) {
        const info = this.graph.get(filePath);
        lines.push(`- \`${filePath}\`${info ? ` (${info.role})` : ''}`);
      }
      lines.push('');
    }

    if (conventions.length > 0) {
      lines.push('## 5. Code Conventions');
      for (const c of conventions) {
        lines.push(`- **${c.name}:** ${c.description}${c.example ? ` (e.g., \`${c.example}\`)` : ''}`);
      }
      lines.push('');
    }

    lines.push('## 6. Implementation Checklist');
    lines.push('- [ ] Follow the selected patterns');
    lines.push('- [ ] Update all listed relevant files');
    lines.push('- [ ] Apply cascading updates where needed');
    lines.push('- [ ] Update tests for behavioral changes');
    lines.push('- [ ] Keep imports and types clean');
    lines.push('');

    lines.push('## 7. Constraints');
    lines.push('- Do not introduce new dependencies without approval');
    lines.push('- Keep architecture and folder layout stable');
    lines.push('- No debug logs or TODO placeholders in final code');
    lines.push('');

    lines.push('---');
    lines.push('*Generated by ArchitectIQ - Repository-Scale Architectural Intelligence*');
    return lines.join('\n');
  }
}

interface Pattern {
  type: string;
  path: string;
  description: string;
  exports: string[];
}

interface Convention {
  name: string;
  description: string;
  example: string;
}

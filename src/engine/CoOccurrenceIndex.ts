import { FileGraph } from '../analyzer/WorkspaceScanner';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'do', 'does', 'did',
  'this', 'that', 'these', 'those', 'it', 'its', 'from', 'by', 'as', 'not', 'if',
  'return', 'import', 'export', 'const', 'let', 'var', 'function', 'class',
  'def', 'self', 'true', 'false', 'null', 'none', 'undefined', 'type', 'interface',
  'async', 'await', 'new', 'get', 'set', 'use', 'add', 'run', 'all', 'any',
  'str', 'int', 'bool', 'list', 'dict', 'object', 'string', 'number', 'void',
  'pass', 'raise', 'try', 'except', 'finally', 'while', 'print', 'log', 'console',
  'error', 'result', 'data', 'value', 'values', 'response', 'request', 'req', 'res',
  'ctx', 'context', 'params', 'args', 'props', 'state', 'ref', 'key', 'id', 'name',
  'path', 'url', 'file', 'dir',
]);

export class CoOccurrenceIndex {
  private termsByFile = new Map<string, Set<string>>();

  constructor(graph: FileGraph) {
    this.build(graph);
  }

  private build(graph: FileGraph): void {
    for (const [filePath, info] of graph) {
      if (info.role === 'test' || info.role === 'config') continue;

      const terms = new Set<string>();
      const text = (info.contentFull || info.contentPreview).toLowerCase();
      const words = text.split(/[^a-z0-9_]+/);

      for (const word of words) {
        if (word.length >= 3 && word.length <= 25 && !STOPWORDS.has(word)) {
          terms.add(word);
        }
      }

      for (const word of words) {
        if (word.includes('_')) {
          for (const part of word.split('_')) {
            if (part.length >= 3 && !STOPWORDS.has(part)) terms.add(part);
          }
        }

        const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        for (const part of camelParts) {
          if (part.length >= 3 && !STOPWORDS.has(part)) terms.add(part);
        }
      }

      this.termsByFile.set(filePath, terms);
    }
  }

  public expand(keywords: string[], _graph: FileGraph): Map<string, number> {
    const expanded = new Map<string, number>();

    for (const kw of keywords) {
      expanded.set(kw.toLowerCase(), 1.0);
    }

    const seedScores: Array<[string, number]> = [];
    for (const [filePath, terms] of this.termsByFile) {
      const matches = keywords.filter((kw) => terms.has(kw.toLowerCase())).length;
      if (matches > 0) seedScores.push([filePath, matches]);
    }
    seedScores.sort((a, b) => b[1] - a[1]);
    const seedFiles = seedScores.slice(0, 5).map(([fp]) => fp);

    const coTermFrequency = new Map<string, number>();
    for (const filePath of seedFiles) {
      const terms = this.termsByFile.get(filePath) || new Set<string>();
      for (const term of terms) {
        if (!expanded.has(term)) {
          coTermFrequency.set(term, (coTermFrequency.get(term) || 0) + 1);
        }
      }
    }

    for (const [term, freq] of coTermFrequency) {
      if (freq >= 2) {
        expanded.set(term, 0.35);
      }
    }

    return expanded;
  }
}

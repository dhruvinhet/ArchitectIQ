import { GraphStore } from '../GraphStore';
import { FileGraph } from '../WorkspaceScanner';

/**
 * Extractor 2: Test wiring
 * Finds which source files have corresponding test files and adds tested_by edges.
 */
export class TestExtractor {
  run(store: GraphStore, fileGraph: FileGraph): void {
    for (const [testPath, testInfo] of fileGraph) {
      if (testInfo.role !== 'test') continue;

      const testId = GraphStore.makeId('test', testPath);
      if (!store.hasNode(testId)) continue;

      const testBase = testPath
        .replace(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/, '')
        .replace(/^tests?\//, '')
        .replace(/^__tests__\//, '');

      for (const [sourcePath, sourceInfo] of fileGraph) {
        if (sourceInfo.role === 'test') continue;

        const sourceBase = sourcePath.replace(/\.[^.]+$/, '');

        if (
          sourceBase.endsWith(testBase) ||
          testBase.endsWith(sourceBase.split('/').pop() || '') ||
          sourcePath.replace(/\.[^.]+$/, '') === testBase
        ) {
          const sourceId = GraphStore.makeId(sourceInfo.role === 'component' ? 'component' : 'module', sourcePath);
          if (!store.hasNode(sourceId)) continue;

          store.addEdge({
            source: sourceId,
            target: testId,
            relation: 'tested_by',
            properties: { confidence: 'high', evidence_type: 'test' },
            evidence: [testPath],
          });
        }
      }
    }
  }
}

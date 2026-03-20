import { FileGraph } from './WorkspaceScanner';

export interface DetectedStack {
  /** Primary language of the project */
  primaryLanguage: 'typescript' | 'javascript' | 'python' | 'mixed';
  /** Frameworks detected */
  frameworks: string[];
  /** Test framework */
  testFramework: string | null;
  /** CSS approach */
  cssApproach: string | null;
  /** Database/ORM */
  database: string | null;
  /** State management */
  stateManagement: string | null;
  /** Import style */
  importStyle: string;
  /** Summary string */
  summary: string;
}

export class LanguageDetector {
  public static detect(graph: FileGraph): DetectedStack {
    const allRelativePaths = [...graph.keys()];
    const allImports: string[] = [];
    for (const info of graph.values()) {
      allImports.push(...info.imports);
    }
    const importSet = allImports.join(' ');
    const pathStr = allRelativePaths.join(' ');

    const frameworks: string[] = [];

    // Framework detection from imports and config files
    const hasPackageJson = allRelativePaths.includes('package.json');
    let packageContent = '';
    if (hasPackageJson) {
      const pkgInfo = graph.get('package.json');
      if (pkgInfo) packageContent = pkgInfo.contentPreview;
    }
    const allContent = importSet + ' ' + packageContent;

    if (/next/.test(allContent) && allRelativePaths.some(p => p.includes('/pages/') || p.includes('/app/'))) {
      frameworks.push('Next.js');
    } else if (/react/.test(allContent)) {
      frameworks.push('React');
    }

    if (/express/.test(allContent)) frameworks.push('Express.js');
    if (/fastify/.test(allContent)) frameworks.push('Fastify');
    if (/nestjs|@nestjs/.test(allContent)) frameworks.push('NestJS');
    if (/django/.test(allContent)) frameworks.push('Django');
    if (/fastapi/.test(allContent)) frameworks.push('FastAPI');
    if (/flask/.test(allContent)) frameworks.push('Flask');

    // Language detection
    const tsCount = allRelativePaths.filter(p => p.endsWith('.ts') || p.endsWith('.tsx')).length;
    const jsCount = allRelativePaths.filter(p => p.endsWith('.js') || p.endsWith('.jsx')).length;
    const pyCount = allRelativePaths.filter(p => p.endsWith('.py')).length;

    let primaryLanguage: DetectedStack['primaryLanguage'];
    if (pyCount > tsCount + jsCount) primaryLanguage = 'python';
    else if (tsCount > jsCount) primaryLanguage = 'typescript';
    else if (jsCount > 0) primaryLanguage = 'javascript';
    else primaryLanguage = 'mixed';

    // Test framework
    let testFramework: string | null = null;
    if (/jest/.test(allContent)) testFramework = 'Jest';
    else if (/vitest/.test(allContent)) testFramework = 'Vitest';
    else if (/mocha/.test(allContent)) testFramework = 'Mocha';
    else if (/pytest/.test(allContent) || allRelativePaths.some(p => p.startsWith('test_') || p.endsWith('_test.py'))) testFramework = 'Pytest';

    // CSS approach detection: evidence-based across all CSS files
    let cssApproach: string | null = null;
    let tailwindVotes = 0;
    let cssModuleVotes = 0;
    let styledComponentVotes = 0;
    let scssVotes = 0;
    let plainCssVotes = 0;

    for (const [filePath, info] of graph) {
      const content = info.contentFull || info.contentPreview;

      if (filePath.endsWith('.css') || filePath.endsWith('.scss')) {
        if (content.includes('@tailwind')) tailwindVotes += 3;
        if (filePath.includes('.module.')) cssModuleVotes += 2;
        if (filePath.endsWith('.scss')) scssVotes += 1;
        if (!filePath.includes('.module.') && filePath.endsWith('.css')) plainCssVotes += 1;
      }

      if (filePath === 'package.json' || filePath.endsWith('/package.json')) {
        if (content.includes('tailwindcss')) tailwindVotes += 2;
        if (content.includes('styled-components')) styledComponentVotes += 2;
      }

      if (content.includes('styled.') || content.includes('css`')) styledComponentVotes += 1;
    }

    const cssSignals = [
      ['Tailwind CSS', tailwindVotes],
      ['CSS Modules', cssModuleVotes],
      ['styled-components', styledComponentVotes],
      ['SCSS', scssVotes],
      ['Plain CSS', plainCssVotes],
    ] as const;
    const winner = cssSignals.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (winner[1] > 0) cssApproach = winner[0];

    // Database
    let database: string | null = null;
    if (/prisma/.test(allContent)) database = 'Prisma';
    else if (/mongoose/.test(allContent)) database = 'Mongoose (MongoDB)';
    else if (/typeorm/.test(allContent)) database = 'TypeORM';
    else if (/drizzle/.test(allContent)) database = 'Drizzle ORM';
    else if (/sqlalchemy/.test(allContent)) database = 'SQLAlchemy';
    else if (/knex/.test(allContent)) database = 'Knex.js';

    // State management
    let stateManagement: string | null = null;
    if (/zustand/.test(allContent)) stateManagement = 'Zustand';
    else if (/redux/.test(allContent)) stateManagement = 'Redux';
    else if (/jotai/.test(allContent)) stateManagement = 'Jotai';
    else if (/recoil/.test(allContent)) stateManagement = 'Recoil';
    else if (/mobx/.test(allContent)) stateManagement = 'MobX';
    else if (/pinia/.test(allContent)) stateManagement = 'Pinia';

    // Import style detection from actual source imports
    let relativeCount = 0;
    let aliasCount = 0;
    let absoluteCount = 0;

    const tsFiles = [...graph.values()].filter(
      (i) => i.language === 'typescript' || i.language === 'javascript' || i.language === 'tsx' || i.language === 'jsx'
    );

    for (const info of tsFiles) {
      for (const imp of info.imports) {
        if (imp.startsWith('./') || imp.startsWith('../')) relativeCount++;
        else if (imp.startsWith('@/') || imp.startsWith('~/')) aliasCount++;
        else if (!imp.startsWith('@') && !imp.includes('.') && imp.includes('/')) absoluteCount++;
      }
    }

    let importStyle: string;
    const total = relativeCount + aliasCount + absoluteCount;
    if (total === 0) {
      importStyle = 'relative imports';
    } else if (aliasCount / total > 0.3) {
      importStyle = 'alias imports (@/ prefix)';
    } else if (relativeCount > absoluteCount) {
      importStyle = 'relative imports (e.g. ../components/Button)';
    } else {
      importStyle = 'absolute path imports';
    }

    const summary = [
      primaryLanguage.charAt(0).toUpperCase() + primaryLanguage.slice(1),
      ...frameworks,
      testFramework ? `· tested with ${testFramework}` : '',
      cssApproach ? `· styles: ${cssApproach}` : '',
      database ? `· DB: ${database}` : '',
      stateManagement ? `· state: ${stateManagement}` : '',
      `· imports: ${importStyle}`,
    ].filter(Boolean).join(' ');

    return { primaryLanguage, frameworks, testFramework, cssApproach, database, stateManagement, importStyle, summary };
  }
}

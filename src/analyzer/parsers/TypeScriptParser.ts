export interface ParseResult {
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
}

export class TypeScriptParser {
  public static parse(content: string): ParseResult {
    return {
      imports: this._extractImports(content),
      exports: this._extractExports(content),
      functions: this._extractFunctions(content),
      classes: this._extractClasses(content),
    };
  }

  private static _extractImports(content: string): string[] {
    const imports: string[] = [];

    // Standard ES6 imports: import X from 'y', import { X } from 'y', import * as X from 'y'
    const esImportRegex = /^import\s+(?:type\s+)?(?:\*\s+as\s+\w+|{[^}]*}|[\w$]+(?:\s*,\s*{[^}]*})?)\s+from\s+['"]([^'"]+)['"]/gm;
    let match;
    while ((match = esImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Side-effect imports: import 'something'
    const sideEffectRegex = /^import\s+['"]([^'"]+)['"]/gm;
    while ((match = sideEffectRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // CommonJS require: const x = require('y'), require('y')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Dynamic imports: import('y')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return [...new Set(imports)];
  }

  private static _extractExports(content: string): string[] {
    const exports: string[] = [];
    let match;

    // Named exports: export const/function/class/interface/type/enum X
    const namedExportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|class|interface|type|enum|abstract\s+class)\s+([\w$]+)/gm;
    while ((match = namedExportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Default function export: export default function X
    const defaultFnRegex = /^export\s+default\s+(?:async\s+)?function\s+([\w$]+)/gm;
    while ((match = defaultFnRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Default class export: export default class X
    const defaultClassRegex = /^export\s+default\s+class\s+([\w$]+)/gm;
    while ((match = defaultClassRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Named export list: export { X, Y, Z }
    const exportListRegex = /^export\s+\{([^}]+)\}/gm;
    while ((match = exportListRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim());
      exports.push(...names.filter(n => /^[\w$]+$/.test(n)));
    }

    // module.exports
    const moduleExportsRegex = /module\.exports\s*=\s*\{([^}]{0,500})\}/;
    const moduleMatch = moduleExportsRegex.exec(content);
    if (moduleMatch) {
      const names = moduleMatch[1].match(/[\w$]+\s*:/g) || [];
      exports.push(...names.map(n => n.replace(':', '').trim()));
    }

    return [...new Set(exports)];
  }

  private static _extractFunctions(content: string): string[] {
    const functions: string[] = [];
    let match;

    // Function declarations: function myFunc(
    const funcDeclRegex = /^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/gm;
    while ((match = funcDeclRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Arrow function assignments: const myFunc = (...) => or const myFunc = async (...) =>
    const arrowRegex = /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?\(/gm;
    while ((match = arrowRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Class methods (2 space or 4 space indent, or tab)
    const methodRegex = /^[ \t]+(?:(?:public|private|protected|static|async|override)\s+)*(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{/gm;
    while ((match = methodRegex.exec(content)) !== null) {
      const name = match[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'else', 'constructor'].includes(name)) {
        functions.push(name);
      }
    }

    return [...new Set(functions)];
  }

  private static _extractClasses(content: string): string[] {
    const classes: string[] = [];
    let match;

    const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/gm;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }

    // Interfaces and types (TypeScript specific)
    const interfaceRegex = /^(?:export\s+)?interface\s+([\w$]+)/gm;
    while ((match = interfaceRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }

    return [...new Set(classes)];
  }
}

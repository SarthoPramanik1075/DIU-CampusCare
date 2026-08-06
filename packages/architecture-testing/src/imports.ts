import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';

export interface ImportSpecifier {
  /** The raw module text as written, e.g. `'../../modules/foo/domain/x.js'` or `'fastify'`. */
  readonly specifier: string;
  /** `true` for `import type` / `export type` — a type-only import cannot, by construction, introduce a runtime dependency. */
  readonly isTypeOnly: boolean;
}

/**
 * Every static `import`/`export … from` specifier and dynamic `import(…)`
 * call in a `.ts` file, extracted via the TypeScript compiler API rather
 * than a regular expression.
 *
 * A regex over import syntax is the kind of check that is *usually* right —
 * until a multi-line import, a specifier containing an escaped quote, or a
 * comment that happens to contain the word "import" produces a false
 * positive or a false negative in a rule that is supposed to fail a build.
 * The compiler API sees exactly what the compiler sees, because it is the
 * compiler; `typescript` is already a dependency of every package in this
 * workspace for typechecking, so this adds no new dependency surface.
 */
export function extractImports(filePath: string): readonly ImportSpecifier[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  const found: ImportSpecifier[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, isTypeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArg] = node.arguments;
      if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
        found.push({ specifier: firstArg.text, isTypeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Resolves a relative import specifier (`./x.js`, `../../y.js`) against the
 * importing file's directory into a normalised absolute path, with the
 * trailing `.js` stripped — this codebase's ESM imports always carry the
 * compiled `.js` extension even though the source is `.ts` (see
 * `eslint.config.js`'s `import-x/extensions` rule), so stripping it is what
 * lets a resolved import path be compared against a `.ts` source path.
 *
 * Returns `null` for a bare package specifier (`'fastify'`,
 * `'@campuscare/shared-types'`) — those have no filesystem path to resolve
 * within this repository and are checked by the specifier string itself.
 */
export function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const resolved = resolve(dirname(fromFile), specifier);
  return resolved.endsWith('.js') ? resolved.slice(0, -3) : resolved;
}

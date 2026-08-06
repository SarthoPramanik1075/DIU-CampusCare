import { readFileSync } from 'node:fs';

import ts from 'typescript';

export interface MutationCall {
  readonly file: string;
  readonly method: 'updateTable' | 'deleteFrom';
  readonly table: string;
  readonly line: number;
}

/**
 * Finds every `.updateTable('schema.table')` or `.deleteFrom('schema.table')`
 * call in a file, for whichever table names are being protected.
 *
 * Backs the immutability rule (FR-PAY-10, FR-MED-21, FR-AUD-02, BR-51/61):
 * several tables in this schema may only ever be inserted into, never
 * updated or deleted, and the guarantee is enforced twice — by the database
 * (a `REVOKE` and a trigger, DATABASE §9/§11) and by this check, so that a
 * violation is caught at build time rather than discovered as a runtime
 * `restrict_violation` in production.
 */
export function findMutationCalls(filePath: string, protectedTables: readonly string[]): MutationCall[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const found: MutationCall[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'updateTable' || node.expression.name.text === 'deleteFrom')
    ) {
      const [firstArg] = node.arguments;
      const method = node.expression.name.text;
      if (firstArg !== undefined && ts.isStringLiteral(firstArg) && protectedTables.includes(firstArg.text)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        found.push({ file: filePath, method, table: firstArg.text, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

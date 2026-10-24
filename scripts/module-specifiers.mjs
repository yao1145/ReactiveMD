import { parseAst } from 'rolldown/parseAst';

/** Read real module syntax, ignoring prose in comments and diagnostic strings. */
export function moduleSpecifiers(source, filename = 'module.js') {
  const file = parseAst(source, { lang: filename.endsWith('.d.ts') ? 'dts' : filename.endsWith('.ts') ? 'ts' : 'js' }, filename);
  const specifiers = new Set();
  const add = node => { if (node && typeof node.value === 'string') specifiers.add(node.value); };
  const visit = node => {
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type)) add(node.source);
    else if (node.type === 'TSImportType') add(node.source);
    else if (node.type === 'TSExternalModuleReference') add(node.expression);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => { if (child && typeof child.type === 'string') visit(child); });
      else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(file);
  return [...specifiers];
}

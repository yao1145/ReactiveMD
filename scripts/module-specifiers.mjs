import { parseAst } from 'rolldown/parseAst';

function langOf(filename) {
  if (filename.endsWith('.d.ts')) return 'dts';
  if (filename.endsWith('.ts')) return 'ts';
  if (filename.endsWith('.tsx')) return 'tsx';
  if (filename.endsWith('.jsx')) return 'jsx';
  return 'js';
}

/**
 * Read real module syntax, ignoring prose in comments and diagnostic strings.
 * Returns unique dependency records; a specifier that is both imported for
 * types and for runtime resolves to the runtime record.
 */
export function moduleDependencies(source, filename = 'module.js') {
  const file = parseAst(source, { lang: langOf(filename) }, filename);
  const dependencies = new Map();
  const add = (node, typeOnly) => {
    if (!node || typeof node.value !== 'string') return;
    const existing = dependencies.get(node.value);
    if (existing === undefined || (existing.typeOnly && !typeOnly)) {
      dependencies.set(node.value, { specifier: node.value, typeOnly });
    }
  };
  const visit = node => {
    if (node.type === 'ImportDeclaration') {
      const specifiers = node.specifiers ?? [];
      const typeOnly = node.importKind === 'type'
        || (specifiers.length > 0 && specifiers.every(specifier => specifier.importKind === 'type'));
      add(node.source, typeOnly);
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      add(node.source, node.exportKind === 'type');
    } else if (node.type === 'ImportExpression') {
      add(node.source, false);
    } else if (node.type === 'TSImportType') {
      add(node.source, true);
    } else if (node.type === 'TSExternalModuleReference') {
      add(node.expression, false);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => { if (child && typeof child.type === 'string') visit(child); });
      else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(file);
  return [...dependencies.values()];
}

/** Unique module specifier strings, in first-seen order. */
export function moduleSpecifiers(source, filename = 'module.js') {
  return moduleDependencies(source, filename).map(({ specifier }) => specifier);
}

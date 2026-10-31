import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { EXIT, fsFailure, usageError } from './errors.mjs';
import { initHelp } from './help.mjs';

const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMPONENT_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const MAX_NAME_LENGTH = 128;
const MAX_ID_LENGTH = 160;
const MAX_PROPS = 64;
const MAX_ENUM_VALUES = 64;
const MAX_PATTERN_LENGTH = 512;
const FORMS = ['leaf', 'inline', 'container'];
const CAPABILITY_ORDER = ['interactive', 'static', 'ssr', 'offline'];
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROP_KINDS = new Set(['string', 'number', 'boolean', 'enum']);
const PROP_KEYS = new Set([
  'kind', 'required', 'static', 'dynamic', 'default', 'nullable', 'enum', 'values',
  'pattern', 'min', 'max', 'integer', 'positive', 'color', 'coerce', 'description',
]);
const PROP_FLAGS = ['required', 'static', 'dynamic', 'nullable', 'integer', 'positive', 'color'];

const INIT_SPEC = new Map([
  ['--name', { key: 'name' }],
  ['--id', { key: 'id' }],
  ['--form', { key: 'form' }],
  ['--props', { key: 'props' }],
  ['--capabilities', { key: 'capabilities' }],
  ['-y', { key: 'yes', boolean: true }],
  ['--yes', { key: 'yes', boolean: true }],
  ['-h', { key: 'help', boolean: true }],
  ['--help', { key: 'help', boolean: true }],
]);

/**
 * Parse init arguments. The option reader mirrors the build command: values may
 * be separate tokens or `--option=value`, and `--` makes the rest literal.
 *
 * @param {string[]} argv
 */
function parseInitOptions(argv) {
  const positionals = [];
  const options = {};
  let literal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (literal) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (token === '-' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    let name = token;
    let inlineValue;
    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      if (equals > 2) {
        name = token.slice(0, equals);
        inlineValue = token.slice(equals + 1);
      }
    }
    const entry = INIT_SPEC.get(name);
    if (!entry) {
      throw usageError(`Unknown option "${name}". Run "reactive-md init --help" for usage.`);
    }
    if (entry.boolean) {
      if (inlineValue !== undefined) throw usageError(`Option "${name}" does not take a value.`);
      options[entry.key] = true;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      if (index + 1 >= argv.length) throw usageError(`Option "${name}" requires a value.`);
      value = argv[index + 1];
      index += 1;
    }
    options[entry.key] = value;
  }

  return { positionals, options };
}

/** @param {unknown} value @param {string} option */
function requireText(value, option) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw usageError(`Option "${option}" requires a non-empty value.`);
  }
  return value;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The SDK accepts only linear-time-safe patterns. Keep the scaffold to the same
 * subset so a generated manifest cannot fail when it is imported.
 *
 * @param {string} source
 */
function patternQuantifier(source, index) {
  const char = source[index];
  if (char === '*' || char === '+' || char === '?') {
    return { length: source[index + 1] === '?' ? 2 : 1 };
  }
  if (char !== '{') return null;
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
  if (!match) return null;
  return { length: match[0].length + (source[index + match[0].length] === '?' ? 1 : 0) };
}

/**
 * @param {string} source
 */
function isSafePattern(source) {
  const groups = [];
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      const next = source[index + 1];
      if (next !== undefined && next >= '1' && next <= '9') return false;
      if (next === 'k' && source[index + 2] === '<') return false;
      escaped = true;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === '(') {
      if (source[index + 1] === '?') {
        if (source[index + 2] !== ':') return false;
        groups.push({ quantified: false, alternation: false });
        index += 2;
        continue;
      }
      groups.push({ quantified: false, alternation: false });
      continue;
    }
    if (char === '|') {
      const group = groups[groups.length - 1];
      if (group) group.alternation = true;
      continue;
    }
    if (char === ')') {
      const group = groups.pop();
      if (!group) return false;
      const quantifier = patternQuantifier(source, index + 1);
      if (quantifier && (group.quantified || group.alternation)) return false;
      const parent = groups[groups.length - 1];
      if (parent) {
        parent.quantified = parent.quantified || group.quantified || quantifier !== null;
        parent.alternation = parent.alternation || group.alternation;
      }
      if (quantifier) index += quantifier.length;
      continue;
    }
    const quantifier = patternQuantifier(source, index);
    if (quantifier) {
      const group = groups[groups.length - 1];
      if (group) group.quantified = true;
      index += quantifier.length - 1;
    }
  }
  return groups.length === 0 && !escaped && !inClass;
}

/**
 * Turn a directory name into a valid component tag. Returns null when the name
 * contains no letters or digits at all.
 *
 * @param {string} base
 */
function deriveComponentName(base) {
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized === '') return null;
  const candidate = /^[a-z]/.test(normalized) ? normalized : `c-${normalized}`;
  return COMPONENT_NAME.test(candidate) ? candidate : null;
}

/** @param {string} name */
function pascalCase(name) {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/** @param {string} value */
function validateName(value) {
  if (value.length > MAX_NAME_LENGTH || !COMPONENT_NAME.test(value)) {
    throw usageError(`Invalid component name "${value}". Use lowercase kebab-case, for example "my-widget".`);
  }
  return value;
}

/** @param {string} value */
function validateId(value) {
  if (value.length > MAX_ID_LENGTH || !COMPONENT_ID.test(value)) {
    throw usageError(`Invalid component id "${value}". Use a lowercase namespaced id such as "example/my-widget".`);
  }
  return value;
}

/** @param {unknown} value */
function validateForm(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!FORMS.includes(normalized)) {
    throw usageError(`Invalid value for "--form": "${value}". Expected leaf, inline or container.`);
  }
  return normalized;
}

/**
 * Validate a props declaration before any file is written so the generated
 * manifest is accepted by defineLocalComponent.
 *
 * @param {string} propName
 * @param {unknown} value
 */
function validatePropDeclaration(propName, value) {
  const label = `props.${propName}`;
  if (!isPlainObject(value)) {
    throw usageError(`Invalid ${label}: must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!PROP_KEYS.has(key)) {
      throw usageError(`Invalid ${label}: unknown field "${key}".`);
    }
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !PROP_KINDS.has(kind)) {
    throw usageError(`Invalid ${label}.kind: expected "string", "number", "boolean" or "enum".`);
  }
  for (const flag of PROP_FLAGS) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') {
      throw usageError(`Invalid ${label}.${flag}: expected a boolean.`);
    }
  }
  if (value.static === true && value.dynamic === true) {
    throw usageError(`Invalid ${label}: it cannot be both static and dynamic.`);
  }
  if (value.coerce !== undefined) {
    if (value.coerce !== 'text') throw usageError(`Invalid ${label}.coerce: expected "text".`);
    if (kind !== 'string') throw usageError(`Invalid ${label}.coerce: only string props accept coerce.`);
  }

  const enumValues = value.enum !== undefined ? value.enum : value.values;
  if (value.enum !== undefined && value.values !== undefined) {
    throw usageError(`Invalid ${label}: use "enum" or "values", not both.`);
  }
  if (kind === 'enum') {
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      throw usageError(`Invalid ${label}.enum: expected a non-empty string array.`);
    }
    if (enumValues.length > MAX_ENUM_VALUES) {
      throw usageError(`Invalid ${label}.enum: accepts at most ${MAX_ENUM_VALUES} values.`);
    }
    const seen = new Set();
    for (const item of enumValues) {
      if (typeof item !== 'string' || item.length === 0 || item.length > MAX_NAME_LENGTH) {
        throw usageError(`Invalid ${label}.enum: values must be non-empty strings.`);
      }
      if (seen.has(item)) throw usageError(`Invalid ${label}.enum: "${item}" is repeated.`);
      seen.add(item);
    }
  } else if (enumValues !== undefined) {
    throw usageError(`Invalid ${label}.enum: only enum props declare allowed values.`);
  }

  if (value.pattern !== undefined) {
    if (kind !== 'string' || typeof value.pattern !== 'string') {
      throw usageError(`Invalid ${label}.pattern: only string props accept a pattern.`);
    }
    if (value.pattern.length > MAX_PATTERN_LENGTH) {
      throw usageError(`Invalid ${label}.pattern: exceeds the ${MAX_PATTERN_LENGTH}-character limit.`);
    }
    try {
      new RegExp(value.pattern);
    } catch {
      throw usageError(`Invalid ${label}.pattern: not a valid regular expression.`);
    }
    if (!isSafePattern(value.pattern)) {
      throw usageError(`Invalid ${label}.pattern: nested quantifiers, quantified alternation, backreferences and lookarounds are rejected.`);
    }
  }

  const hasBounds = value.min !== undefined || value.max !== undefined;
  if (hasBounds) {
    if (kind !== 'number') throw usageError(`Invalid ${label}: min and max apply to number props.`);
    for (const key of ['min', 'max']) {
      if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
        throw usageError(`Invalid ${label}.${key}: expected a finite number.`);
      }
    }
    if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
      throw usageError(`Invalid ${label}: min cannot exceed max.`);
    }
  }
  if (kind !== 'number' && (value.integer === true || value.positive === true)) {
    throw usageError(`Invalid ${label}: integer and positive apply to number props.`);
  }
  if (kind !== 'string' && value.color === true) {
    throw usageError(`Invalid ${label}.color: only string props accept a color flag.`);
  }
  if (value.description !== undefined) {
    if (!isPlainObject(value.description)
      || Object.values(value.description).some((entry) => typeof entry !== 'string' || entry.length > 256)
      || Object.keys(value.description).some((key) => DANGEROUS_KEYS.has(key)
        || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(key))) {
      throw usageError(`Invalid ${label}.description: expected locale-keyed strings such as {"en": "..."}.`);
    }
  }

  if (value.default !== undefined) {
    const fallback = value.default;
    if (fallback === null) {
      if (value.nullable !== true) throw usageError(`Invalid ${label}.default: null requires nullable.`);
    } else if (kind === 'string') {
      if (typeof fallback !== 'string') throw usageError(`Invalid ${label}.default: expected a string.`);
    } else if (kind === 'number') {
      if (typeof fallback !== 'number' || !Number.isFinite(fallback)) {
        throw usageError(`Invalid ${label}.default: expected a finite number.`);
      }
      if (value.integer === true && !Number.isInteger(fallback)) {
        throw usageError(`Invalid ${label}.default: expected an integer.`);
      }
      if (value.positive === true && fallback <= 0) {
        throw usageError(`Invalid ${label}.default: expected a number greater than zero.`);
      }
      if (value.min !== undefined && fallback < value.min) {
        throw usageError(`Invalid ${label}.default: below the declared minimum.`);
      }
      if (value.max !== undefined && fallback > value.max) {
        throw usageError(`Invalid ${label}.default: above the declared maximum.`);
      }
    } else if (kind === 'boolean') {
      if (typeof fallback !== 'boolean') throw usageError(`Invalid ${label}.default: expected a boolean.`);
    } else if (!Array.isArray(enumValues) || !enumValues.includes(fallback)) {
      throw usageError(`Invalid ${label}.default: must be one of the enum values.`);
    }
    if (typeof fallback === 'string' && typeof value.pattern === 'string'
      && !new RegExp(value.pattern).test(fallback)) {
      throw usageError(`Invalid ${label}.default: does not match the declared pattern.`);
    }
  }
}

/** @param {unknown} value */
function parseProps(value) {
  const text = requireText(value, '--props');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw usageError(`Option "--props" is not valid JSON: ${detail}.`);
  }
  if (!isPlainObject(parsed)) {
    throw usageError('Option "--props" must be a JSON object mapping prop names to declarations.');
  }
  const names = Object.keys(parsed);
  if (names.length > MAX_PROPS) {
    throw usageError(`Option "--props" declares more than ${MAX_PROPS} properties.`);
  }
  for (const name of names) {
    if (DANGEROUS_KEYS.has(name)) throw usageError(`Invalid prop name "${name}".`);
    if (name.length > MAX_NAME_LENGTH || !COMPONENT_NAME.test(name)) {
      throw usageError(`Invalid prop name "${name}". Use lowercase kebab-case.`);
    }
    validatePropDeclaration(name, parsed[name]);
  }
  return parsed;
}

/** @param {unknown} value */
function parseCapabilities(value) {
  const text = requireText(value, '--capabilities');
  const tokens = text.split(',').map((token) => token.trim());
  if (tokens.some((token) => token === '')) {
    throw usageError('Option "--capabilities" must not contain empty entries.');
  }
  const selected = new Set();
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (!CAPABILITY_ORDER.includes(normalized)) {
      throw usageError(`Invalid capability "${token}". Expected a comma-separated subset of interactive, static, ssr, offline.`);
    }
    if (selected.has(normalized)) {
      throw usageError(`Capability "${normalized}" is listed more than once.`);
    }
    selected.add(normalized);
  }
  if (!selected.has('interactive') && !selected.has('static')) {
    throw usageError('At least one of "interactive" or "static" is required for the preview.');
  }
  return CAPABILITY_ORDER.filter((capability) => selected.has(capability));
}

/** @param {unknown} context */
function canPrompt(context) {
  const input = context.stdin ?? process.stdin;
  return Boolean(input && input.isTTY && context.stdout && context.stdout.isTTY);
}

/** @param {string} value */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** @param {{kind?: string, pattern?: string, color?: boolean}} prop */
function sampleString(prop) {
  const fallback = prop.color === true ? '#000000' : 'example';
  const candidates = prop.color === true
    ? ['#000000', 'black', 'red', 'example']
    : ['example', 'Example', 'x', 'sample', 'value', 'abc', 'a1', 'test'];
  if (typeof prop.pattern !== 'string') return fallback;
  let expression;
  try {
    expression = new RegExp(prop.pattern);
  } catch {
    return fallback;
  }
  return candidates.find((candidate) => expression.test(candidate)) ?? fallback;
}

/** @param {Record<string, any>} prop */
function sampleNumber(prop) {
  let value = 1;
  if (typeof prop.min === 'number') value = Math.ceil(prop.min);
  if (prop.positive === true && value <= 0) value = 1;
  if (typeof prop.max === 'number' && value > prop.max) value = prop.max;
  if (prop.integer === true) value = Math.trunc(value);
  return value;
}

/** @param {Record<string, any>} prop */
function sampleValue(prop) {
  if (prop.kind === 'number') return String(sampleNumber(prop));
  if (prop.kind === 'boolean') return 'true';
  if (prop.kind === 'enum') {
    const values = prop.enum ?? prop.values ?? [];
    return values[0] ?? '';
  }
  return sampleString(prop);
}

/**
 * Author attributes only for required props without a default. Optional props
 * use their defaults in the preview document.
 *
 * @param {Record<string, any>} props
 */
function sampleAttributes(props) {
  const attributes = [];
  for (const [name, prop] of Object.entries(props)) {
    if (prop.required !== true || prop.default !== undefined) continue;
    attributes.push(`${name}="${escapeAttribute(sampleValue(prop))}"`);
  }
  return attributes;
}

/**
 * @param {{name: string, form: string, props: Record<string, any>}} plan
 */
function sampleTag(plan) {
  const attributes = sampleAttributes(plan.props);
  const suffix = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
  if (plan.form === 'leaf') return `<${plan.name}${suffix}>`;
  if (plan.form === 'inline') return `<${plan.name}${suffix}>inline content</${plan.name}>`;
  return `<${plan.name}${suffix}>\n\n**Markdown** children render here.\n\n</${plan.name}>`;
}

/** @param {{name: string, form: string, props: Record<string, any>}} plan */
function previewSource(plan) {
  const tag = sampleTag(plan);
  if (plan.form === 'inline') return `Preview text before ${tag} and after.`;
  return tag;
}

/** @param {string} value @param {number} indent */
function jsonBlock(value, indent) {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${' '.repeat(indent)}`);
}

/** @param {{name: string, id: string, form: string, props: Record<string, any>, capabilities: string[]}} plan */
function manifestSource(plan) {
  const structure = plan.form === 'leaf'
    ? ''
    : plan.form === 'inline'
      ? "  structure: { rule: 'inline' },\n"
      : "  structure: { rule: 'any', label: 'optional' },\n";
  const capabilities = CAPABILITY_ORDER
    .map((capability) => `${capability}: ${plan.capabilities.includes(capability)}`)
    .join(', ');
  const tag = sampleTag(plan);
  return `import { defineLocalComponent } from 'reactive-md/sdk';

/**
 * Pure-data manifest. It has no React or CSS imports, so Node consumers can
 * read the definition without a bundler.
 */
const id = ${JSON.stringify(plan.id)};
export const manifest = defineLocalComponent({
  id,
  name: ${JSON.stringify(plan.name)},
  version: '0.1.0',
  protocol: 'reactive-md-component/v1',
  form: ${JSON.stringify(plan.form)},
  props: ${jsonBlock(plan.props, 2)},
  styles: [id + '.css'],
${structure}  capabilities: { ${capabilities} },
  authoring: {
    title: { en: ${JSON.stringify(pascalCase(plan.name))} },
    description: { en: ${JSON.stringify(`A <${plan.name}> component.`)} },
    insertText: ${JSON.stringify(tag)},
  },
});

export default manifest;
`;
}

/** @param {{name: string, form: string}} plan */
function componentSource(plan) {
  const componentName = `${pascalCase(plan.name)}View`;
  const element = plan.form === 'inline' ? 'span' : 'div';
  const titleElement = plan.form === 'inline' ? 'span' : 'strong';
  const bodyElement = plan.form === 'inline' ? 'span' : 'p';
  const childClass = `<${element} className="${plan.name}-children">{ctx.children.render()}</${element}>`;
  const children = plan.form === 'leaf'
    ? ''
    : `      {ctx.content.form !== 'leaf' ? ${childClass} : null}\n`;
  return `import {
  defineReactComponentPackage,
  type LocalComponentContext,
  type LocalComponentValue,
} from 'reactive-md/react';
import { manifest } from './manifest.js';
import css from './${plan.name}.css?inline';

function text(value: LocalComponentValue | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

export function ${componentName}(ctx: LocalComponentContext) {
  return (
    <${element} className="${plan.name}" data-${plan.name} role="group">
      <${titleElement} className="${plan.name}-title">{text(ctx.props.label) || ${JSON.stringify(pascalCase(plan.name))}}</${titleElement}>
      <${bodyElement} className="${plan.name}-body">
        Edit <code>src/${plan.name}.tsx</code> and <code>src/${plan.name}.css</code> to build this component.
      </${bodyElement}>
${children}    </${element}>
  );
}

export const componentPackage = defineReactComponentPackage({
  ...manifest,
  css,
  render: ${componentName},
});

export const { definition, components, resources } = componentPackage;

export default componentPackage;
`;
}

/** @param {{name: string}} plan */
function cssSource(plan) {
  return `.local-document .${plan.name} {
  display: grid;
  gap: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-card, 8px);
}

.local-document .${plan.name}-title {
  font-size: 1rem;
}

.local-document .${plan.name}-body {
  margin: 0;
  color: var(--ink-muted, inherit);
}

.local-document .${plan.name}-children {
  display: grid;
  gap: var(--space-2, 8px);
}
`;
}

function envSource() {
  return `/// <reference types="vite/client" />
/// <reference types="reactive-md/vite/client" />
`;
}

/** @param {{name: string}} plan */
function extensionsSource(plan) {
  return `import { createReactHost } from 'reactive-md/react';
import { componentPackage } from './src/${plan.name}.js';

export const host = createReactHost({ packages: [componentPackage] });

export default host;
`;
}

/** @param {{name: string, id: string, capabilities: string[]}} plan */
function packageJsonSource(plan) {
  return `${JSON.stringify({
    name: `reactive-md-${plan.name}-component`,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `A <${plan.name}> component package for Reactive MD.`,
    license: 'MIT',
    files: ['dist', `src/${plan.name}.css`, 'README.md'],
    exports: {
      '.': {
        types: './dist/types/src/manifest.d.ts',
        import: './dist/node/manifest.js',
      },
      './react': {
        types: `./dist/types/src/${plan.name}.d.ts`,
        import: './dist/node/react.js',
      },
      './host': {
        types: './dist/types/extensions.d.ts',
        import: './dist/node/host.js',
      },
      './styles.css': `./src/${plan.name}.css`,
    },
    scripts: {
      dev: 'vite',
      build: 'node scripts/build.mjs',
      'build:preview': 'vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
      test: 'node scripts/build.mjs && node scripts/verify.mjs',
    },
    peerDependencies: {
      'reactive-md': '0.6.1',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      typescript: '^7.0.0',
      vite: '^8.0.0',
    },
  }, null, 2)}\n`;
}

function tsconfigSource() {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ['vite/client', 'node'],
    },
    include: ['src', 'main', 'extensions.ts', 'vite.config.ts'],
  }, null, 2)}\n`;
}

function tsconfigBuildSource() {
  return `${JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      outDir: 'dist/types',
      rootDir: '.',
    },
    include: ['src', 'extensions.ts'],
  }, null, 2)}\n`;
}

function viteConfigSource() {
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { reactiveMd } from 'reactive-md/vite';

const root = fileURLToPath(new URL('./main', import.meta.url));
const extensions = fileURLToPath(new URL('./extensions.ts', import.meta.url));

export default defineConfig({
  root,
  plugins: [reactiveMd({ extensions })],
});
`;
}

/** @param {{name: string, capabilities: string[]}} plan */
function htmlSource(plan) {
  const title = `${pascalCase(plan.name)} preview`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <main id="reactive-md-document"></main>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`;
}

/** @param {{name: string, capabilities: string[]}} plan */
function previewMainSource(plan) {
  const mode = plan.capabilities.includes('interactive') ? 'interactive' : 'static';
  return `import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { host } from 'virtual:reactive-md/host';
import sample from './sample.reactive.md?raw';

const target = document.getElementById('reactive-md-document');
if (!target) throw new Error('Missing #reactive-md-document.');

const mode: 'interactive' | 'static' = '${mode}';

createRoot(target).render(
  <LocalReactiveDocument source={sample} reactConfig={host.reactConfig} mode={mode} />,
);
`;
}

/** @param {{name: string, form: string, props: Record<string, any>}} plan */
function sampleDocumentSource(plan) {
  return `# ${pascalCase(plan.name)} preview

This preview serves ${'`'}main/sample.reactive.md${'`'} through the Vite plugin.
The component below is registered by ${'`'}extensions.ts${'`'}.

${previewSource(plan)}
`;
}

/** @param {{name: string}} plan */
function buildScriptSource(plan) {
  return `import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const external = [/^reactive-md(?:\\/|$)/, /^react(?:\\/|$)/, /^react-dom(?:\\/|$)/];

if (!path.isAbsolute(dist) || path.relative(root, dist) !== 'dist') throw new Error('Invalid build output directory.');
await rm(dist, { recursive: true, force: true });
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  oxc: { jsx: { development: false } },
  build: {
    outDir: path.join(dist, 'node'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: {
        manifest: path.join(root, 'src', 'manifest.ts'),
        react: path.join(root, 'src', '${plan.name}.tsx'),
        host: path.join(root, 'extensions.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => \`\${entryName}.js\`,
    },
    rollupOptions: { external },
  },
});

const typescriptUrl = import.meta.resolve('typescript/package.json');
const typescript = JSON.parse(await readFile(fileURLToPath(typescriptUrl), 'utf8'));
const tsc = spawnSync(process.execPath, [
  fileURLToPath(new URL(typescript.bin.tsc, typescriptUrl)),
  '--project',
  path.join(root, 'tsconfig.build.json'),
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (tsc.status !== 0) {
  throw new Error('TypeScript declaration generation failed.');
}
console.log('Built dist/node and dist/types.');
`;
}

/** @param {{name: string, form: string, props: Record<string, any>, capabilities: string[]}} plan */
function verifyScriptSource(plan) {
  return `import { createLocalComplianceReport, runLocalManifestCompliance } from 'reactive-md/testing';
import { runLocalReactCompliance } from 'reactive-md/testing/react';
import { manifest } from '../dist/node/manifest.js';
import { host } from '../dist/node/host.js';

const component = ${JSON.stringify(plan.name)};
const source = ${JSON.stringify(previewSource(plan))};

const manifestSuite = runLocalManifestCompliance(manifest);
const reactSuite = runLocalReactCompliance({
  config: host.config,
  reactConfig: host.reactConfig,
  resources: host.resources,
  component,
  spec: {
    protocol: 'reactive-md-react-spec/v1',
    source,
    staticMarkupIncludes: [${JSON.stringify(`data-${plan.name}`)}],
    ssrMarkupIncludes: [${JSON.stringify(`data-${plan.name}`)}],
  },
});

const declared = host.config.components[0]?.capabilities ?? {};
const nodeCapabilities = ['static', 'ssr'].filter((name) => declared[name] === true);
const report = createLocalComplianceReport({
  config: host.config,
  component,
  suites: [manifestSuite, reactSuite],
  capabilities: nodeCapabilities,
});

console.log(\`\${component}: passed=\${report.summary.passed} failed=\${report.summary.failed} skipped=\${report.summary.skipped} unsupported=\${report.summary.unsupported}\`);
for (const diagnostic of report.diagnostics) {
  console.error(\`[\${diagnostic.code}] \${diagnostic.message}\`);
}
if (!report.ok) process.exit(1);
if (nodeCapabilities.length === 0) {
  console.log('No static or SSR capability is declared. Interactive and offline evidence needs a browser run.');
} else {
  console.log(\`Node and SSR compliance passed for: \${nodeCapabilities.join(', ')}.\`);
}
`;
}

/** @param {{name: string, form: string, props: Record<string, any>, capabilities: string[], id: string}} plan */
function readmeSource(plan) {
  const tag = sampleTag(plan);
  return `# ${pascalCase(plan.name)} Reactive MD component

A minimal component package scaffolded by \`reactive-md init component\`.

## Edit these files

- \`src/manifest.ts\` - pure data: id, tag name, form, props and capabilities.
- \`src/${plan.name}.tsx\` - the React view passed to \`defineReactComponentPackage\`.
- \`src/${plan.name}.css\` - component styles, scoped under \`.local-document\`.

The remaining files are build plumbing: \`extensions.ts\`, \`vite.config.ts\`,
\`main/\`, \`scripts/\`, \`tsconfig.json\` and \`package.json\`. Change them when the
package layout or preview entry needs to move.

## Install

Reactive MD 0.6.1 is a source preview. Install the current SDK tarball together
with the React peers, then install the remaining development dependencies:

\`\`\`sh
npm install ../reactive-md-0.6.1.tgz react@^19 react-dom@^19
npm install
\`\`\`

## Develop

\`\`\`sh
npm run dev       # preview served from main/index.html
npm test          # build, then run manifest and React/SSR compliance
npm run build     # dist/node entries and dist/types declarations
npm run typecheck
\`\`\`

The preview imports \`host\` from \`virtual:reactive-md/host\` and passes
\`host.reactConfig\` to \`LocalReactiveDocument\`. The Vite plugin bundles the
component, its CSS and its dependencies.

## Use in a document

\`\`\`md
${tag}
\`\`\`

## Package exports

- \`.\` - the pure-data manifest.
- \`./react\` - the \`defineReactComponentPackage\` result with \`definition\`,
  \`components\` and \`resources\`.
- \`./host\` - the \`createReactHost\` result.
- \`./styles.css\` - the source stylesheet.

Declared capabilities: ${plan.capabilities.join(', ')}.

\`npm test\` proves static and SSR rendering in Node. Interactive and offline
evidence needs a browser run; connect \`reactive-md/testing/browser\` in CI for
that.
`;
}

/**
 * @param {{
 *   directory: string, name: string, id: string, form: string,
 *   props: Record<string, any>, capabilities: string[]
 * }} plan
 */
function renderFiles(plan) {
  const componentFile = `src/${plan.name}.tsx`;
  return [
    ['.gitignore', 'node_modules/\ndist/\n.reactive-md/\n*.tgz\n'],
    ['package.json', packageJsonSource(plan)],
    ['README.md', readmeSource(plan)],
    ['tsconfig.json', tsconfigSource()],
    ['tsconfig.build.json', tsconfigBuildSource()],
    ['vite.config.ts', viteConfigSource()],
    ['extensions.ts', extensionsSource(plan)],
    ['main/index.html', htmlSource(plan)],
    ['main/main.tsx', previewMainSource(plan)],
    ['main/sample.reactive.md', sampleDocumentSource(plan)],
    ['src/manifest.ts', manifestSource(plan)],
    [componentFile, componentSource(plan)],
    [`src/${plan.name}.css`, cssSource(plan)],
    ['src/env.d.ts', envSource()],
    ['scripts/build.mjs', buildScriptSource(plan)],
    ['scripts/verify.mjs', verifyScriptSource(plan)],
  ];
}

/**
 * Reject an existing target path before prompting or writing.
 *
 * @param {string} targetPath
 */
async function assertTargetAvailable(targetPath) {
  try {
    await stat(targetPath);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'ENOENT') return;
    throw fsFailure('Cannot inspect target path', targetPath, error, EXIT.IO);
  }
  throw usageError(`Refusing to overwrite existing path: "${targetPath}".`);
}

/**
 * @param {string[]} argv
 * @param {{packageRoot?: string, stdin?: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runInit(argv, context) {
  const { positionals, options } = parseInitOptions(argv);
  if (options.help) {
    context.stdout.write(initHelp());
    return EXIT.OK;
  }

  if (positionals.length === 0) {
    throw usageError('Missing init target. Usage: reactive-md init component <directory>.');
  }
  const [target, ...directories] = positionals;
  if (target !== 'component') {
    throw usageError(`Unknown init target "${target}". Usage: reactive-md init component <directory>.`);
  }
  if (directories.length === 0) {
    throw usageError('Missing component directory. Usage: reactive-md init component <directory>.');
  }
  if (directories.length > 1) {
    throw usageError(`Expected one component directory, received ${directories.length}.`);
  }

  const directory = requireText(directories[0], 'directory');
  const targetPath = path.resolve(directory);
  await assertTargetAvailable(targetPath);

  const interactive = options.yes !== true && canPrompt(context);
  let reader;
  const ask = async (label, fallback) => {
    if (!reader) return fallback;
    const hint = fallback === undefined || fallback === '' ? '' : ` [${fallback}]`;
    const answer = (await reader.question(`${label}${hint}: `)).trim();
    return answer === '' ? fallback : answer;
  };

  let name;
  let id;
  let form;
  let propsInput = options.props;
  let capabilitiesInput = options.capabilities;
  try {
    if (interactive) {
      reader = createInterface({ input: context.stdin ?? process.stdin, output: context.stdout });
    }

    if (options.name !== undefined) {
      name = requireText(options.name, '--name').trim();
    } else if (interactive) {
      name = await ask('Component tag name', deriveComponentName(path.basename(targetPath)) ?? '');
    } else {
      name = deriveComponentName(path.basename(targetPath));
    }
    if (name === undefined || name === null || name === '') {
      throw usageError('Cannot derive a component name from the directory. Pass "--name <tag>".');
    }
    validateName(name);

    if (options.id !== undefined) {
      id = requireText(options.id, '--id').trim();
    } else if (interactive) {
      id = await ask('Component id', `local/${name}`);
    } else {
      id = `local/${name}`;
    }
    validateId(id);

    if (options.form !== undefined) {
      form = validateForm(options.form);
    } else if (interactive) {
      form = validateForm(await ask('Component form (leaf, inline, container)', 'leaf'));
    } else {
      form = 'leaf';
    }
    if (interactive && propsInput === undefined) propsInput = await ask('Props JSON', '{}');
    if (interactive && capabilitiesInput === undefined) capabilitiesInput = await ask('Capabilities (comma separated)', CAPABILITY_ORDER.join(','));
  } finally {
    reader?.close();
  }

  const props = parseProps(propsInput !== undefined ? propsInput : '{}');
  const capabilities = parseCapabilities(
    capabilitiesInput !== undefined ? capabilitiesInput : CAPABILITY_ORDER.join(','),
  );

  const plan = { directory: targetPath, name, id, form, props, capabilities };
  // Reuse the owning SDK contract, including built-in/HTML name collisions,
  // before creating any directory. The generated project must be registrable.
  const { defineLocalComponent, createLocalConfig } = await import(new URL('../dist-library/reactive-md-sdk.js', import.meta.url).href);
  try {
    const definition = defineLocalComponent({ id, name, version: '0.1.0', protocol: 'reactive-md-component/v1',
      form, props, capabilities: Object.fromEntries(CAPABILITY_ORDER.map(key => [key, capabilities.includes(key)])) });
    createLocalConfig({ components: [definition] });
  } catch (error) { throw usageError(`Invalid component: ${error instanceof Error ? error.message : String(error)}`); }
  const files = renderFiles(plan);
  files.push(['LICENSE', await readFile(path.join(context.packageRoot, 'LICENSE'), 'utf8')]);

  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await mkdir(targetPath);
  } catch (error) {
    throw fsFailure('Cannot create scaffold directory', targetPath, error, EXIT.IO);
  }

  for (const [relative, content] of files) {
    const file = path.join(targetPath, ...relative.split('/'));
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      throw fsFailure('Cannot write scaffold file', file, error, EXIT.IO);
    }
  }

  context.stdout.write(`Created component scaffold "${name}" in "${targetPath}".\n`);
  context.stdout.write('Next: install the Reactive MD tarball, then run "npm run dev".\n');
  return EXIT.OK;
}

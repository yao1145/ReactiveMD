import type { CompileState } from './compiler-services';
import type { LocalNode } from '../types';
import type { AttrMap, AttrState, Entry } from './compiler-structure';
import { MAX_LOCAL_DIAGNOSTICS, MAX_LOCAL_STRING_LENGTH } from '../../contracts/limits';
import { closestName } from '../../contracts/schema-core';
import { cloneValue, fullInterpolation, MAX_LOCAL_NAME_LENGTH, scanInterpolations, singleFullInterpolation } from './compiler-values';
import { isLocalColor } from '../../contracts/color-values';
import {
  kernelAttributeIssues,
  kernelSlotBindings,
  kernelStructure,
  kernelValueBinding,
  type KernelPropSchema,
} from '../../contracts/component-kernel';
import { parseNumberText } from './compiler-values';

/** Slice only the opening tag so attribute lookup never rescans component content. */
export function openingTag(source: string, start: number, end: number): string {
  let quote = '';
  let index = start;
  for (; index < end; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      index += 1;
      break;
    }
  }
  return source.slice(start, index);
}

function attributeOffset(state: CompileState, node: LocalNode, name: string): number {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return node.range.start;
  const text = openingTag(state.source, node.range.start, node.range.end);
  const pattern = new RegExp(`(?:^|[\\s"'/])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|=|/|>)`);
  const match = pattern.exec(text);
  return match ? node.range.start + match.index + (match[0].length - name.length) : node.range.start;
}

export function validateAttributes(entry: Entry, state: CompileState): AttrMap {
  if(!state.semantic)return validateAttributesUncached(entry,state);
  const key=entry.name+'\0'+openingTag(state.source,entry.node.range.start,entry.node.range.end);
  const cached=state.semantic.attributes<AttrMap>(key);
  const clone=(attrs:AttrMap,delta:number):AttrMap=>Object.fromEntries(Object.entries(attrs).map(([name,info])=>[name,{...info,offset:info.offset+delta,...(info.expressionOffset===undefined?{}:{expressionOffset:info.expressionOffset+delta}),...(Array.isArray(info.value)?{value:cloneValue(info.value)}:{})}]));
  if(cached)return clone(cached.value,entry.node.range.start-cached.origin);
  const count=state.diagnostics.length,value=validateAttributesUncached(entry,state);
  if(count<MAX_LOCAL_DIAGNOSTICS && state.diagnostics.length===count)state.semantic.rememberAttributes(key,entry.node.range.start,clone(value,0));
  return value;
}

function validateAttributesUncached(entry: Entry, state: CompileState): AttrMap {
  const attrs: AttrMap = {};
  const rawAttrs = entry.node.attrs ?? {};
  const props = entry.kernel.props;
  const legacy = entry.legacy;
  const bindingAttributes = legacy ? legacyBindingAttributes(entry) : undefined;
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const offset = attributeOffset(state, entry.node, name);
    if (legacy && raw.length > MAX_LOCAL_STRING_LENGTH) {
      state.report('local.budget.attribute', { key: 'local.budget.attribute', params: { name, component: entry.name, limit: MAX_LOCAL_STRING_LENGTH } }, offset, offset + name.length);
      continue;
    }
    if (bindingAttributes?.bind.has(name) || bindingAttributes?.initial.has(name)) {
      // The binding resolver owns these attributes and reports their rules.
      attrs[name] = bindingAttributeInfo(entry, name, raw, offset);
      continue;
    }
    const prop = props[name];
    if (!prop) {
      const suggestion = closestName(name, Object.keys(props));
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.host.attribute.unknown', params: { component: entry.name, name } }, offset, offset + name.length);
      } else {
        state.report('local.attribute.unknown', {
            key: suggestion ? 'local.attribute.unknown.suggestion' : 'local.attribute.unknown',
            params: suggestion ? { component: entry.name, name, suggestion } : { component: entry.name, name },
          }, offset, offset + name.length);
      }
      continue;
    }
    const info: AttrState = { raw, offset, dynamic: false };
    if (prop.kind === 'string' && raw.length > MAX_LOCAL_STRING_LENGTH) {
      state.report('local.budget.attribute', { key: 'local.budget.attribute', params: { name, component: entry.name, limit: MAX_LOCAL_STRING_LENGTH } }, offset, offset + name.length);
      info.raw = raw.slice(0, MAX_LOCAL_STRING_LENGTH);
    }
    if (entry.node.literalAttributes && prop.kind === 'string' && raw.includes('{{')) info.value = info.raw;
    else validatePropValue(name, prop, info, state, legacy);
    if (prop.color) {
      const scanned = scanInterpolations(info.raw);
      if (!scanned.segments.length && !scanned.unterminated.length && !isLocalColor(info.raw)) {
        state.report('local.attribute.color', { key: 'local.attribute.color', params: { name, component: entry.name, value: info.raw } }, offset, offset + name.length);
      }
    }
    attrs[name] = info;
  }
  for (const [name, prop] of Object.entries(props)) {
    if (bindingAttributes?.bind.has(name) || bindingAttributes?.initial.has(name)) continue;
    if (prop.required && prop.default === undefined && !Object.hasOwn(attrs, name)) {
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.host.attribute.required', params: { component: entry.name, name } }, entry.node.range.start, entry.node.range.end);
      } else {
        state.report('local.attribute.required', { key: 'local.attribute.required', params: { component: entry.name, name } }, entry.node.range.start, entry.node.range.end);
      }
    }
  }
  if (kernelStructure(entry.kernel).label === 'required') {
    if (!Object.hasOwn(attrs, 'label')) {
      state.report('local.label.required', { key: 'local.label.required.missing', params: { name: entry.name } }, entry.node.range.start, entry.node.range.end);
    } else if (!String(attrs.label.raw).trim()) {
      state.report('local.label.required', { key: 'local.label.required.empty', params: { name: entry.name } }, attrs.label.offset, undefined);
    }
  }
  return attrs;
}

/** Attributes the declared bindings own; the binding resolver validates them. */
function legacyBindingAttributes(entry: Entry): { bind: Set<string>; initial: Set<string> } | undefined {
  const bind = new Set<string>();
  const initial = new Set<string>();
  const scalar = kernelValueBinding(entry.kernel);
  if (scalar) {
    bind.add(scalar.bind);
    initial.add(scalar.initial);
  }
  for (const slot of kernelSlotBindings(entry.kernel)) {
    bind.add(slot.bind);
    initial.add(slot.initial);
  }
  return bind.size || initial.size ? { bind, initial } : undefined;
}

/** Decode one implicitly bound attribute for the binding resolver. */
function bindingAttributeInfo(entry: Entry, name: string, raw: string, offset: number): AttrState {
  const scalar = kernelValueBinding(entry.kernel);
  const binding = scalar && scalar.bind === name
    ? scalar
    : kernelSlotBindings(entry.kernel).find((slot) => slot.bind === name || slot.initial === name)
      ?? (scalar && scalar.initial === name ? scalar : undefined);
  const info: AttrState = { raw, offset, dynamic: false };
  if (!binding || binding.bind === name) {
    info.value = raw;
    return info;
  }
  if (binding.kind === 'number') {
    const value = parseNumberText(raw);
    if (value !== null) info.value = value;
  } else if (binding.kind === 'boolean') {
    if (raw === 'true' || raw === 'false') info.value = raw === 'true';
  } else {
    info.value = raw;
  }
  return info;
}

function kernelPropValues(prop: KernelPropSchema): readonly string[] {
  return prop.values ?? prop.enum ?? [];
}

function validatePropValue(
  name: string,
  prop: KernelPropSchema,
  info: AttrState,
  state: CompileState,
  legacy: boolean,
): void {
  const staticKey = legacy ? 'local.host.attribute.static' : 'local.attribute.static';
  const staticCode = legacy ? 'local.host.attribute' : 'local.attribute.static';
  if (prop.kind === 'string') {
    // A dynamic string attribute (for example `date.min`) accepts one complete
    // interpolation that must evaluate to a string, or a literal fallback.
    if (prop.dynamic) {
      const full = fullInterpolation(info.raw);
      if (full) {
        info.dynamic = true;
        info.expression = full.expression;
        info.expressionOffset = info.offset + full.start;
        if (!full.expression) {
          state.report('local.expression.empty', { key: 'local.expression.empty.attribute', params: { name } }, info.expressionOffset, undefined);
        }
        return;
      }
    }
    if (prop.static) {
      const scanned = scanInterpolations(info.raw);
      if (scanned.segments.length || scanned.unterminated.length) {
        state.report(
          staticCode,
          `Attribute ${name} is static and cannot contain interpolations.`,
          info.offset,
          info.offset + info.raw.length,
          { key: staticKey, params: { name } },
        );
      }
      info.value = info.raw;
      return;
    }
    if (prop.dynamic === false) {
      const scanned = scanInterpolations(info.raw);
      if (scanned.segments.length || scanned.unterminated.length) {
        state.report(
          legacy ? 'local.host.attribute' : 'local.attribute.interpolation',
          `Attribute ${name} does not accept interpolations.`,
          info.offset,
          info.offset + info.raw.length,
          { key: 'local.attribute.interpolation.dynamic', params: { name } },
        );
        return;
      }
    }
    if (prop.pattern !== undefined) {
      const scanned = scanInterpolations(info.raw);
      const interpolated = scanned.segments.length > 0 || scanned.unterminated.length > 0;
      if (interpolated) {
        // A pattern constrains literal shape, so only one full interpolation may
        // replace the literal. Mixed text and unterminated braces are rejected.
        if (!singleFullInterpolation(info.raw)) {
          state.report(
            legacy ? 'local.host.attribute' : 'local.attribute.interpolation',
            `Attribute ${name} must be a literal matching ${prop.pattern} or one full interpolation.`,
            info.offset,
            info.offset + info.raw.length,
            {
              key: legacy ? 'local.host.attribute.interpolation' : 'local.attribute.interpolation.pattern',
              params: { name, pattern: prop.pattern },
            },
          );
        }
        info.value = info.raw;
        return;
      }
      let accepted = true;
      try {
        accepted = new RegExp(prop.pattern).test(info.raw);
      } catch {
        // Options validation rejects invalid patterns; do not crash if a
        // schema bypassed it.
      }
      if (!accepted) {
        if (legacy) {
          state.report('local.host.attribute', { key: 'local.host.attribute.pattern', params: { name, pattern: prop.pattern } }, info.offset, info.offset + info.raw.length);
        } else {
          state.report('local.attribute.type', { key: 'local.attribute.type.pattern', params: { name, pattern: prop.pattern } }, info.offset, info.offset + info.raw.length);
        }
      }
      info.value = info.raw;
      return;
    }
    info.value = info.raw;
    return;
  }

  const dynamicAllowed = prop.static !== true && prop.dynamic !== false
    && (prop.dynamic === true || legacy);
  if (prop.kind === 'number') {
    const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
    if (full) {
      info.dynamic = true;
      info.expression = full.expression;
      info.expressionOffset = info.offset + full.start;
      if (!full.expression) {
        state.report('local.expression.empty', { key: 'local.expression.empty.attribute', params: { name } }, info.expressionOffset, undefined);
      }
      return;
    }
    const value = parseNumberText(info.raw);
    if (value === null) {
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.host.attribute.type', params: { name, value: info.raw, kind: 'number' } }, info.offset, info.offset + info.raw.length);
      } else {
        state.report('local.attribute.type', { key: prop.dynamic ? 'local.attribute.type.number-interpolation' : 'local.attribute.type.number', params: { name, value: info.raw } }, info.offset, info.offset + info.raw.length);
      }
      return;
    }
    if (prop.integer && !Number.isInteger(value)) {
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.attribute.type.integer', params: { name } }, info.offset, info.offset + info.raw.length);
      } else {
        state.report('local.attribute.type', { key: 'local.attribute.type.integer', params: { name } }, info.offset, undefined);
      }
    }
    if (prop.positive && !(value > 0)) {
      state.report('local.attribute.type', { key: 'local.attribute.type.positive', params: { name } }, info.offset, undefined);
    }
    if (prop.min !== undefined && value < prop.min) {
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.attribute.range.min', params: { name, min: prop.min } }, info.offset, info.offset + info.raw.length);
      } else {
        state.report('local.attribute.range', { key: 'local.attribute.range.min', params: { name, min: prop.min } }, info.offset, undefined);
      }
    }
    if (prop.max !== undefined && value > prop.max) {
      if (legacy) {
        state.report('local.host.attribute', { key: 'local.attribute.range.max', params: { name, max: prop.max } }, info.offset, info.offset + info.raw.length);
      } else {
        state.report('local.attribute.range', { key: 'local.attribute.range.max', params: { name, max: prop.max } }, info.offset, undefined);
      }
    }
    info.value = value;
    return;
  }

  if (prop.kind === 'boolean') {
    const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
    if (full) {
      info.dynamic = true;
      info.expression = full.expression;
      info.expressionOffset = info.offset + full.start;
      if (!full.expression) {
        state.report('local.expression.empty', { key: 'local.expression.empty.attribute', params: { name } }, info.expressionOffset, undefined);
      }
      return;
    }
    if (info.raw === 'true' || info.raw === 'false') {
      info.value = info.raw === 'true';
      return;
    }
    if (legacy) {
      state.report('local.host.attribute', { key: 'local.host.attribute.type', params: { name, value: info.raw, kind: 'boolean' } }, info.offset, info.offset + info.raw.length);
    } else {
      state.report('local.attribute.type', { key: prop.dynamic ? 'local.attribute.type.boolean-interpolation' : 'local.attribute.type.boolean', params: { name } }, info.offset, info.offset + info.raw.length);
    }
    return;
  }

  // enum
  const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
  if (full) {
    info.dynamic = true;
    info.expression = full.expression;
    info.expressionOffset = info.offset + full.start;
    if (!full.expression) {
      state.report('local.expression.empty', { key: 'local.expression.empty.attribute', params: { name } }, info.expressionOffset, undefined);
    }
    return;
  }
  const values = kernelPropValues(prop);
  if (!values.includes(info.raw)) {
    if (legacy) {
      state.report('local.host.attribute', { key: 'local.host.attribute.enum', params: { name, values: values.join(' / '), value: info.raw } }, info.offset, info.offset + info.raw.length);
    } else {
      state.report('local.attribute.type', { key: 'local.attribute.type.enum', params: { name, values: values.join(' / '), value: info.raw } }, info.offset, info.offset + info.raw.length);
    }
    return;
  }
  info.value = info.raw;
}

/** A binding step referenced by a prop must be static and positive. */
export function validateBindingConstraintAttributes(entry: Entry, state: CompileState): void {
  // Kernel manifests validate step props through their declared prop schema;
  // only phase-one host adapters keep this extra adapter check.
  if (!entry.legacy) return;
  const binding = kernelValueBinding(entry.kernel);
  const step = binding?.kind === 'number' ? binding.constraints?.step : undefined;
  if (!step || !('prop' in step)) return;
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const propName = step.prop;
  const prop = entry.kernel.props[propName];
  const info = attrs[propName];
  const offset = info?.offset ?? attributeOffset(state, entry.node, propName);
  if (!info) {
    const fallback = prop?.default;
    if (typeof fallback !== 'number') {
      state.report('local.host.attribute', { key: 'local.host.attribute.type', params: { name: propName, value: 'missing', kind: 'number' } }, entry.node.range.start, entry.node.range.end);
    } else if (!(fallback > 0)) {
      state.report('local.host.attribute', { key: 'local.attribute.type.positive', params: { name: propName } }, entry.node.range.start, entry.node.range.end);
    }
    return;
  }
  if (info.dynamic) {
    state.report('local.host.attribute', { key: 'local.host.attribute.static', params: { name: propName } }, offset, offset + info.raw.length);
  } else if (typeof info.value === 'number' && !(info.value > 0)) {
    state.report('local.host.attribute', { key: 'local.attribute.type.positive', params: { name: propName } }, offset, offset + info.raw.length);
  }
}

export function validateAttributeRelations(entry: Entry, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  for (const issue of kernelAttributeIssues(entry.kernel, attrs, entry.node.range)) {
    state.report(
      issue.code,
      issue.message,
      issue.start,
      issue.end,
      { key: issue.key, ...(issue.params ? { params: issue.params } : {}) },
    );
  }
}

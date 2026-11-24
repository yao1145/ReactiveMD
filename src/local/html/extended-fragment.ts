import { MAX_LOCAL_DIAGNOSTICS } from '../../contracts/limits';
import type { Diagnostic, LocalHtmlPolicy } from '../types';
import {
  localHtmlContentSecurityPolicy,
  localHtmlSandbox,
  sanitizeLocalHtmlFragment,
  type LocalHtmlFragmentResult,
} from './html';

/**
 * Extended HTML fragments reuse the whole-document sanitizer rather than a
 * second policy: same element allow-list, attribute rules, URL schemes, script
 * and style gates, and node budget. The differences are structural — a
 * fragment is parsed in body context, keeps no document shell, and a remote
 * `iframe` is only honored for an exact HTTPS origin granted by the host.
 */

/** Result of sanitizing one fragment; `markup` is absent when nothing is renderable. */
export type ExtendedFragmentResult = LocalHtmlFragmentResult;

/**
 * Sanitize one extended HTML fragment for isolated rendering.
 *
 * `policy` is the effective mount policy (compile ceiling intersected with the
 * caller's grants). The host grant list is the permission table for remote
 * frames and defaults to empty: without an explicit origin, no remote frame is
 * kept (and `frame-src` admits only `about:`). Diagnostics keep fragment
 * offsets so the editor can navigate to the offending attribute or element.
 */
export function sanitizeExtendedFragment(
  source: string,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
  allowedFrameOrigins?: readonly string[],
): ExtendedFragmentResult {
  if (typeof source !== 'string') return { diagnostics: [] };
  if (!Number.isFinite(maxSyntaxNodes) || maxSyntaxNodes < 0) {
    return {
      diagnostics: [{
        code: 'local.budget',
        message: 'The HTML fragment node budget must be a non-negative number.',
        severity: 'error',
        range: { start: 0, end: 0 },
        line: 1,
        column: 1,
        messageKey: 'local.budget.nodes',
        params: { limit: 0 },
      }],
    };
  }
  const result = sanitizeLocalHtmlFragment(source, policy, maxSyntaxNodes, allowedFrameOrigins ?? []);
  const diagnostics = result.diagnostics.length <= MAX_LOCAL_DIAGNOSTICS
    ? result.diagnostics
    : result.diagnostics.slice(0, MAX_LOCAL_DIAGNOSTICS);
  // Nothing renderable (empty source, or every element was rejected) means the
  // caller should show the inert source instead of an empty sandbox frame.
  if (result.markup === undefined || result.markup.trim() === '') return { diagnostics };
  return { markup: result.markup, inlineSafe: result.inlineSafe, diagnostics };
}

/**
 * Complete sandbox `srcdoc` for one fragment: trusted head plus sanitized body.
 * A fragment may hold active markup, so it never reaches the host document
 * directly; the renderer assigns this string to an iframe whose sandbox tokens
 * come from `extendedFragmentSandbox`.
 */
export function extendedFragmentDocument(
  markup: string,
  policy: LocalHtmlPolicy,
  allowedFrameOrigins?: readonly string[],
): string {
  const csp = localHtmlContentSecurityPolicy(policy, allowedFrameOrigins ?? [], true);
  const attribute = csp
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attribute}"></head><body>${markup}</body></html>`;
}

/** Sandbox tokens for the fragment container; never same-origin or top-level navigation. */
export function extendedFragmentSandbox(policy: LocalHtmlPolicy): string {
  return localHtmlSandbox(policy);
}

/**
 * Compiler-service adapter matching `LocalHtmlDocumentSanitizer`.
 *
 * The compiler decides whether a fragment is admissible and records its
 * structural diagnostics. Remote frame origins are a mount policy, so they are
 * not evaluated here: the mount-time sanitizer applies the host grant list.
 */
export function sanitizeExtendedHtmlFragmentService(
  source: string,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
): { markup: string; diagnostics: Diagnostic[] } {
  const result = sanitizeLocalHtmlFragment(source, policy, maxSyntaxNodes);
  return { markup: result.markup ?? '', diagnostics: result.diagnostics };
}

import type { LocalHtmlOptions, LocalHtmlPolicy } from '../types';

export const DEFAULT_CAPABILITY_POLICY: LocalHtmlPolicy = Object.freeze({
  enableCss: true,
  enableJavaScript: false,
  enableExtendedHtml: false,
});

export function intersectCapabilityPolicy(
  compiled: LocalHtmlPolicy | undefined,
  grants: LocalHtmlOptions | undefined,
): LocalHtmlPolicy {
  return {
    enableCss: compiled?.enableCss === true && (grants?.enableCss ?? DEFAULT_CAPABILITY_POLICY.enableCss) === true,
    enableJavaScript: compiled?.enableJavaScript === true && grants?.enableJavaScript === true,
    enableExtendedHtml: compiled?.enableExtendedHtml === true && grants?.enableExtendedHtml === true,
  };
}

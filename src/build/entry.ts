export const VIRTUAL_HOST_ENTRY = 'virtual:reactive-md-host-entry';
export const VIRTUAL_HOST_MODULE = 'virtual:reactive-md-host-module';

const CONFIG_KEY = /^rmd-[0-9a-f]{16}$/;

/**
 * Generate the Vite entry. It imports the host module for the prepared React
 * implementations and uses only the public standalone mount API. The config key
 * baked into the bundle is checked again at runtime so a host cannot mount the
 * bundle after changing its extension configuration.
 */
export function createLocalStandaloneEntrySource(configKey: string): string {
  if (!CONFIG_KEY.test(configKey)) {
    throw new TypeError('A standalone build entry requires a valid LocalConfig key.');
  }
  return `import { mountAll } from "reactive-md/standalone";
import {
  config as __reactiveMDConfig,
  reactConfig as __reactiveMDReactConfig,
} from "${VIRTUAL_HOST_MODULE}";

const __reactiveMDExpectedConfigKey = ${JSON.stringify(configKey)};
const __reactiveMDHandles = new Set();

function __reactiveMDInstalledConfig() {
  const reactConfig = __reactiveMDReactConfig;
  const installed = reactConfig && reactConfig.config;
  const declared = __reactiveMDConfig;
  if (!installed || installed.key !== __reactiveMDExpectedConfigKey
    || !declared || declared.key !== __reactiveMDExpectedConfigKey) {
    throw new Error("Reactive MD standalone bundle configuration does not match its build.");
  }
  return reactConfig;
}

export function mountReactiveMD(target) {
  const reactConfig = __reactiveMDInstalledConfig();
  const handles = mountAll(target === undefined ? document : target, { reactConfig });
  for (const handle of handles) __reactiveMDHandles.add(handle);
  return handles;
}

export function unmountReactiveMD() {
  for (const handle of __reactiveMDHandles) handle.unmount();
  __reactiveMDHandles.clear();
}

function __reactiveMDRun() {
  try {
    mountReactiveMD(document);
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("Reactive MD: the standalone extension bundle could not start.", error);
    }
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", __reactiveMDRun, { once: true });
  } else if (typeof queueMicrotask === "function") {
    queueMicrotask(__reactiveMDRun);
  } else {
    Promise.resolve().then(__reactiveMDRun);
  }
}
`;
}

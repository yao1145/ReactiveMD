import { mount } from 'reactive-md/standalone';
import 'reactive-md/styles.css';
import { componentCss, config, reactConfig, themeCss } from './components';
import { source } from './sample';

/**
 * Browser test harness.
 *
 * The build script injects the same static markup that SSR produces, so
 * `mount(..., { hydrate: true })` exercises the real hydration path. The
 * returned handle exposes a deterministic unmount hook for the browser
 * compliance driver.
 */
const styles = document.createElement('style');
styles.textContent = `${componentCss}\n${themeCss}`;
document.head.appendChild(styles);

const target = document.getElementById('reactive-md-document');
if (!target) {
  throw new Error('The harness page is missing #reactive-md-document.');
}

const handle = mount(target, {
  source,
  reactConfig,
  compileOptions: { config },
  hydrate: true,
  locale: 'en',
});

(globalThis as unknown as { __reactiveMdTestUnmount?: () => boolean }).__reactiveMdTestUnmount = () => {
  handle.unmount();
  return true;
};

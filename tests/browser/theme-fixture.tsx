import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LOCAL_THEME_PROTOCOL, type Diagnostic, type LocalColorScheme, type LocalThemeDefinition } from '../../src/index';
import { LocalReactiveDocument } from '../../src/react/index';
import '../../src/styles.css';
import './theme-fixture.css';

// Deliberately small test overrides, not distributable theme designs.
const testTheme: LocalThemeDefinition = { name: 'test-a', protocol: LOCAL_THEME_PROTOCOL, colorSchemes: ['light', 'dark'] };
const otherTheme: LocalThemeDefinition = { ...testTheme, name: 'test-b' };
const source = `<theme name="test-a">
# Theme acceptance

<panel title="Controls">
<counter bind="count" label="Count" initial="2">
<slider label="Accent" initial="2" min="1" max="10">
<slider label="Explicit color" color="red" initial="2" min="1" max="10">
<toggle label="Toggle">
<input label="Text">
</panel>

Count value: {{ count }}

<chart title="Series">
| Category | Value |
| --- | ---: |
| A | 2 |
| B | 4 |
</chart>

<card title="Card">
Body text
</card>

<alert tone="warning">
Warning text
</alert>

<diagram label="Diagram">
<node id="a" label="Start">
Start description
</node>
<node id="b" label="End">
End description
</node>
<edge from="a" to="b">
</diagram>`;

interface Harness {
  scheme(mode: LocalColorScheme): void;
  registered(enabled: boolean): void;
  mounted(enabled: boolean): void;
  diagnostics: Diagnostic[];
  cleanDiagnosticCalls: number;
}
declare global { interface Window { themeHarness: Harness } }
window.themeHarness = { scheme() {}, registered() {}, mounted() {}, diagnostics: [], cleanDiagnosticCalls: 0 };

function Fixture() {
  const [scheme, setScheme] = useState<LocalColorScheme>('auto');
  const [registered, setRegistered] = useState(true);
  const [mounted, setMounted] = useState(true);
  window.themeHarness.scheme = setScheme;
  window.themeHarness.registered = setRegistered;
  window.themeHarness.mounted = setMounted;
  return <>
    <section id="dark-host" data-theme="dark">
      <div id="primary">{mounted && <LocalReactiveDocument source={source} themes={registered ? [testTheme] : []} colorScheme={scheme} onDiagnostics={items => { window.themeHarness.diagnostics = items; }} />}</div>
      <div id="forced-light"><LocalReactiveDocument source={'# Forced light\n\n<counter label="Other">'} colorScheme="light" /></div>
    </section>
    <section id="system"><LocalReactiveDocument source={'# System preference\n\n<counter label="System">'} onDiagnostics={() => { window.themeHarness.cleanDiagnosticCalls += 1; }} /></section>
    <section id="other"><LocalReactiveDocument source={'<theme name="test-b">\n\n# Other theme\n\n<counter label="Independent">'} themes={[otherTheme]} colorScheme="light" /></section>
    <section id="warnings"><LocalReactiveDocument source={'<theme name="missing">\n\n<unknown>Inert</unknown>\n\n<counter label="Warning survivor">'} onDiagnostics={items => { (window as unknown as { warningDiagnostics: Diagnostic[] }).warningDiagnostics = items; }} /></section>
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);

import {useMemo} from 'react';
import {compileLocal, type LocalCompileOptions} from 'reactive-md';
import {LocalReactiveDocument, type LocalHostRenderer} from 'reactive-md/react';
import type {Language} from './i18n';

export const GUIDE_COMPILE_OPTIONS: LocalCompileOptions = {
  hostComponents: [{
    name: 'guide-example',
    form: 'leaf',
    props: {
      kind: {kind: 'string', required: true, static: true},
      ref: {kind: 'string', required: true, static: true},
    },
  }],
};

/** Keep the guide intact while inserting independent documents after its code blocks. */
export function buildGuideExamples(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error('The user guide must compile before adding live examples.');
  const examples: Record<string, string> = {};
  let cursor = 0;
  let enriched = '';
  for (const node of result.document.nodes) {
    if (node.type !== 'code') continue;
    const ref = String(Object.keys(examples).length + 1);
    examples[`guide:${ref}`] = node.value ?? '';
    enriched += source.slice(cursor, node.range.end)
      + `\n\n<guide-example kind="guide" ref="${ref}" />\n\n`;
    cursor = node.range.end;
  }
  return {source: enriched + source.slice(cursor), examples};
}

export function GuideDocument({source, language}: {source: string; language: Language}) {
  const guide = useMemo(() => buildGuideExamples(source), [source]);
  const renderExample: LocalHostRenderer = (node, data) => {
    if (node.name !== 'guide-example' || typeof data !== 'string') return null;
    const title = language === 'zh' ? '实际效果' : 'Live example';
    return (
      <section className="guide-example" aria-label={`${title} ${node.attrs?.ref}`}>
        <div className="guide-example-label">{title}</div>
        <LocalReactiveDocument key={`${language}:${node.attrs?.ref}`} source={data} locale={language} />
      </section>
    );
  };
  return <LocalReactiveDocument key={language} source={guide.source} locale={language}
    compileOptions={GUIDE_COMPILE_OPTIONS} hostData={guide.examples} hostRenderer={renderExample} />;
}

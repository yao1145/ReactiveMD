import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import {
  COPY,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LanguageProvider,
  type Language,
} from './i18n';
import 'reactive-md/styles.css';
import './styles.css';
import './author.css';

const EMBED_SOURCES: Record<Language, string> = {
  en: [
    '# Independent in-memory instances',
    '',
    '[Jump to local parameters](#local-parameters)',
    '',
    '## Local parameters',
    '',
    '<panel title="Local parameters">',
    '<input bind="name" label="Name" initial="Reader">',
    '<slider bind="count" label="Count" initial="2" min="1" max="10">',
    '</panel>',
    '',
    'Hello, **{{ name }}**. The current count is **{{ count }}**.',
  ].join('\n'),
  zh: [
    '# 独立的内存实例',
    '',
    '[跳到本地参数](#本地参数)',
    '',
    '## 本地参数',
    '',
    '<panel title="本地参数">',
    '<input bind="name" label="称呼" initial="读者">',
    '<slider bind="count" label="数量" initial="2" min="1" max="10">',
    '</panel>',
    '',
    '你好，**{{ name }}**。当前数量 **{{ count }}**。',
  ].join('\n'),
};

function savedLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'zh' ? 'zh' : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function EmbeddedInstance({ title, language }: { title: string; language: Language }) {
  return <section aria-label={title} className="md-card">
    <h2>{title}</h2>
    <LocalReactiveDocument source={EMBED_SOURCES[language]} locale={language} />
  </section>;
}

function EmbeddedDemo() {
  const [language] = useState<Language>(savedLanguage);
  const [key, setKey] = useState(0);
  const copy = COPY[language];

  useEffect(() => {
    document.documentElement.lang = copy.htmlLang;
    document.title = copy.embed.documentTitle;
  }, [copy]);

  return <LanguageProvider language={language}>
    <main className="app-shell">
      <h1>{copy.embed.heading}</h1>
      <p>{copy.embed.intro}</p>
      <div className="advanced-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 24 }} key={key}>
        <EmbeddedInstance title={copy.embed.instanceA} language={language} />
        <EmbeddedInstance title={copy.embed.instanceB} language={language} />
      </div>
      <p>
        <button className="button button-secondary" onClick={() => setKey(value => value + 1)}>
          {copy.embed.remount}
        </button>{' '}
        <a href="/">{copy.embed.back}</a>
      </p>
    </main>
  </LanguageProvider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><EmbeddedDemo /></StrictMode>);

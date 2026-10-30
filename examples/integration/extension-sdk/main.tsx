import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import { collectLocalThemeCss } from 'reactive-md/sdk';
import { reactConfig, paper, source, componentResources } from './extensions';
import 'reactive-md/styles.css';

const style = document.createElement('style');
style.textContent = componentResources.map(resource => resource.css).join('\n') + '\n' + collectLocalThemeCss(paper);
document.head.append(style);
createRoot(document.getElementById('root')!).render(<LocalReactiveDocument source={source} reactConfig={reactConfig} locale="zh" />);

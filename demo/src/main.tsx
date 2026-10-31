import { createRoot } from 'react-dom/client';
import App from './App';
import 'reactive-md/styles.css';
import 'reactive-md/editor/styles.css';
import './styles.css';
import './author.css';
import './guide-code.css';
import { css as extensionCss } from '#demo-extensions';

const extensionStyle = document.createElement('style');
extensionStyle.dataset.demoExtensions = '';
extensionStyle.textContent = extensionCss;
document.head.append(extensionStyle);

createRoot(document.getElementById('root')!).render(<App />);

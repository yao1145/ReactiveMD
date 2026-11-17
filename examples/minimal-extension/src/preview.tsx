import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { reactConfig } from './extension';
import { source } from './source';

const host = document.getElementById('app');
if (!host) throw new Error('The preview page is missing #app.');

createRoot(host).render(
  <LocalReactiveDocument source={source} reactConfig={reactConfig} locale="en" />,
);

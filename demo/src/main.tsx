import { createRoot } from 'react-dom/client';
import App from './App';
import 'reactive-md/styles.css';
import 'reactive-md/editor/styles.css';
import './styles.css';
import './author.css';
import './guide-code.css';

createRoot(document.getElementById('root')!).render(<App />);

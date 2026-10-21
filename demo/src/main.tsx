import { createRoot } from 'react-dom/client';
import App from './App';
import 'reactive-md/styles.css';
import './styles.css';
import './author.css';

createRoot(document.getElementById('root')!).render(<App />);

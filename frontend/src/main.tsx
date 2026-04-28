import { createRoot } from 'react-dom/client';

import { App } from './components/App';
import './global.css';

createRoot(document.getElementById('root')!).render(<App />);

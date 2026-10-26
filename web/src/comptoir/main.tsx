import { createRoot } from 'react-dom/client';
import '../ui/base.css';
import '../ui/components.css';
import './shell.css';
import { Root } from './App';

try {
  const t = localStorage.getItem('lx-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  if (localStorage.getItem('lx-private') === '1') document.documentElement.dataset.private = '1';
} catch { /* storage off */ }

createRoot(document.getElementById('root')!).render(<Root />);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if (import.meta.env.DEV) {
  void import('./lib/commands').then((m) => { (window as unknown as Record<string, unknown>).__bbRun = m.runCommand; });
}

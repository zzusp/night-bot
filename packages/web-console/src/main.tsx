import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/boardui.css';
import './styles/app.css';

try { document.documentElement.dataset.theme = localStorage.getItem('night-theme') || 'light'; } catch { /* 系统禁止持久化时沿用浅色。 */ }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

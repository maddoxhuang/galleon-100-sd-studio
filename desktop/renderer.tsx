import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../src/components/Studio';
import './studio.css';

const container = document.getElementById('root');
if (!container) throw new Error('SD100 Studio: #root element is missing.');
createRoot(container).render(<StrictMode><Studio /></StrictMode>);

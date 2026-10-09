import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { THEME } from './config/flags';
import { startMarketData } from './market/marketStore';
import { startTrading } from './store/tradingStore';
import './styles/global.css';

document.documentElement.dataset.theme = THEME;
startMarketData();
startTrading();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

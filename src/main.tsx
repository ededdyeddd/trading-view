import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SANDBOX, THEME } from './config/flags';
import { PanelSandbox, Sandbox } from './order-panel/new/Sandbox';
import { startMarketData } from './market/marketStore';
import { startTrading } from './store/tradingStore';
import './styles/global.css';

document.documentElement.dataset.theme = THEME;
startMarketData();
startTrading();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{SANDBOX === 'atoms' ? <Sandbox /> : SANDBOX === 'panel' ? <PanelSandbox /> : <App />}</StrictMode>,
);

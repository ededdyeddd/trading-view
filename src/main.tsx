import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EXPIRE_FAST, SANDBOX, STUDY, THEME } from './config/flags';
import { StudyDone, StudySetup } from './study/StudyScreens';
import { expiryOverride } from './engine/paperEngine';
import { PanelSandbox, Sandbox } from './order-panel/new/Sandbox';
import { startMarketData } from './market/marketStore';
import { startTrading } from './store/tradingStore';
import './styles/global.css';

document.documentElement.dataset.theme = THEME;
if (EXPIRE_FAST) expiryOverride.ms = { day: 60_000, week: 180_000, month: 600_000 };
startMarketData();
startTrading();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {STUDY === 'setup' ? (
      <StudySetup />
    ) : STUDY === 'done' ? (
      <StudyDone />
    ) : SANDBOX === 'atoms' ? (
      <Sandbox />
    ) : SANDBOX === 'panel' ? (
      <PanelSandbox />
    ) : (
      <App />
    )}
  </StrictMode>,
);

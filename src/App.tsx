import { useEffect, useRef } from 'react';
import { STUDY } from './config/flags';
import { StudyBar } from './study/StudyScreens';
import { BottomPanel } from './layout/bottom/BottomPanel';
import { ChartPane } from './layout/chart/ChartPane';
import { DebugMenu } from './layout/DebugMenu';
import { LeftToolbar } from './layout/LeftToolbar';
import { Toasts } from './layout/Toasts';
import { TopToolbar } from './layout/TopToolbar';
import { Widgetbar } from './layout/widgetbar/Widgetbar';
import { OrderPanelHost } from './order-panel';
import { useUiStore } from './store/uiStore';
import { ResizeHandle } from './ui/ResizeHandle';
import styles from './App.module.css';

export function App() {
  const ticketOpen = useUiStore((s) => s.ticketOpen);
  const ticketWidth = useUiStore((s) => s.ticketWidth);
  const bottomCollapsed = useUiStore((s) => s.bottomCollapsed);
  const bottomHeight = useUiStore((s) => s.bottomHeight);
  const widgetbarWidth = useUiStore((s) => s.widgetbarWidth);
  const dragStart = useRef(0);

  useHotkeys();

  return (
    <div className={styles.app}>
      {STUDY === 'run' && <StudyBar />}
      <TopToolbar />
      <div className={styles.body}>
        <LeftToolbar />
        <div className={styles.main}>
          <div className={styles.centerCol}>
            <div className={`${styles.chart} ${ticketOpen ? styles.chartWithTicket : ''}`}>
              <ChartPane />
            </div>
            <div className={styles.bottom} style={{ height: bottomCollapsed ? 38 : bottomHeight }}>
              {!bottomCollapsed && (
                <ResizeHandle
                  direction="vertical"
                  className={styles.bottomHandle}
                  onStart={() => (dragStart.current = useUiStore.getState().bottomHeight)}
                  onDrag={(d) => useUiStore.getState().setBottomHeight(dragStart.current - d)}
                />
              )}
              <BottomPanel />
            </div>
          </div>
          {ticketOpen && (
            <div className={styles.ticket} style={{ width: ticketWidth + 1 }}>
              <ResizeHandle
                direction="horizontal"
                className={styles.ticketHandle}
                onStart={() => (dragStart.current = useUiStore.getState().ticketWidth)}
                onDrag={(d) => useUiStore.getState().setTicketWidth(dragStart.current - d)}
              />
              <OrderPanelHost />
            </div>
          )}
        </div>
        <div className={styles.widgetbar} style={{ width: widgetbarWidth + 45 + 1 }}>
          <ResizeHandle
            direction="horizontal"
            className={styles.widgetbarHandle}
            onStart={() => (dragStart.current = useUiStore.getState().widgetbarWidth)}
            onDrag={(d) => useUiStore.getState().setWidgetbarWidth(dragStart.current - d)}
          />
          <Widgetbar />
        </div>
      </div>
      <Toasts />
      <DebugMenu />
    </div>
  );
}

/** Shift+T toggles the order ticket (outside of text inputs). */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === 'KeyT') {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.ticketOpen) ui.closeTicket();
        else ui.openTicket('hotkey');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

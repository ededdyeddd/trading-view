import { create } from 'zustand';
import { DEFAULT_SYMBOL } from '../config/symbols';
import type { Timeframe } from '../market/types';
import type { Side } from '../lib/orderMath';

export type ChartType = 'candles' | 'bars' | 'line';
export type BottomTab = 'positions' | 'orders' | 'history' | 'summary' | 'log';
export type TicketSource = 'chart-buy' | 'chart-sell' | 'hotkey' | 'header' | 'bottom-panel' | 'position' | 'startup';

type UiState = {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  ticketOpen: boolean;
  ticketWidth: number;
  bottomCollapsed: boolean;
  bottomHeight: number;
  bottomTab: BottomTab;
  widgetbarWidth: number;

  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setChartType: (t: ChartType) => void;
  openTicket: (source: TicketSource, side?: Side) => void;
  closeTicket: () => void;
  setTicketWidth: (w: number) => void;
  setBottomCollapsed: (v: boolean) => void;
  setBottomHeight: (h: number) => void;
  setBottomTab: (t: BottomTab) => void;
  setWidgetbarWidth: (w: number) => void;
};

/** Hooks other modules can attach to UI transitions (ticket opening is logged by the order-ticket module). */
export const uiEvents = {
  onTicketOpen: new Set<(source: TicketSource, side?: Side) => void>(),
  onTicketClose: new Set<() => void>(),
};

export const useUiStore = create<UiState>((set, get) => ({
  symbol: DEFAULT_SYMBOL,
  timeframe: '1m',
  chartType: 'candles',
  ticketOpen: false,
  ticketWidth: 320,
  bottomCollapsed: false,
  bottomHeight: 300,
  bottomTab: 'positions',
  widgetbarWidth: 281,

  setSymbol: (symbol) => set({ symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setChartType: (chartType) => set({ chartType }),
  openTicket: (source, side) => {
    set({ ticketOpen: true });
    uiEvents.onTicketOpen.forEach((l) => l(source, side));
  },
  closeTicket: () => {
    if (!get().ticketOpen) return;
    set({ ticketOpen: false });
    uiEvents.onTicketClose.forEach((l) => l());
  },
  setTicketWidth: (w) => set({ ticketWidth: Math.round(Math.min(480, Math.max(300, w))) }),
  setBottomCollapsed: (bottomCollapsed) => set({ bottomCollapsed }),
  setBottomHeight: (h) => set({ bottomHeight: Math.round(Math.min(640, Math.max(160, h))) }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomCollapsed: false }),
  setWidgetbarWidth: (w) => set({ widgetbarWidth: Math.round(Math.min(420, Math.max(220, w))) }),
}));

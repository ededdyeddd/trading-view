import { create } from 'zustand';
import { PANEL_FROM_URL, PANEL_VARIANT, type PanelVariant } from '../config/flags';

const KEY = 'panel-variant';

/** `?panel=` wins; otherwise the last choice made with the floating switch; otherwise the default. */
function initialVariant(): PanelVariant {
  if (PANEL_FROM_URL) return PANEL_VARIANT;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'current' || saved === 'new') return saved;
  } catch {
    /* storage unavailable */
  }
  return PANEL_VARIANT;
}

type VariantState = { variant: PanelVariant; setVariant: (v: PanelVariant) => void };

/** Which order panel is shown: the production copy (`current`) or the redesign (`new`). Switchable at runtime. */
export const useVariantStore = create<VariantState>((set, get) => ({
  variant: initialVariant(),
  setVariant: (variant) => {
    if (variant === get().variant) return;
    try {
      localStorage.setItem(KEY, variant);
    } catch {
      /* storage unavailable */
    }
    set({ variant });
  },
}));

export function getVariant(): PanelVariant {
  return useVariantStore.getState().variant;
}

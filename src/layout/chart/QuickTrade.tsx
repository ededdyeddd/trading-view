import { getSpec, pricePrecision } from '../../config/symbols';
import { fmtNumber, fmtPrice } from '../../lib/format';
import { useQuote } from '../../market/marketStore';
import { useUiStore } from '../../store/uiStore';
import styles from './ChartPane.module.css';

/** Sell Bid / spread / Buy Ask buttons in the chart's top-left corner. Clicking opens the ticket on that side. */
export function QuickTrade({ symbol }: { symbol: string }) {
  const spec = getSpec(symbol);
  const quote = useQuote(symbol);
  const openTicket = useUiStore((s) => s.openTicket);
  const spread = quote ? quote.ask - quote.bid : null;
  return (
    <div className={styles.quickTrade}>
      <button type="button" className={`${styles.qtBtn} ${styles.qtSell}`} onClick={() => openTicket('chart-sell', 'sell')} data-testid="quick-sell">
        <span className="tabular">{quote ? fmtPrice(quote.bid, spec) : '—'}</span>
        <span className={styles.qtLabel}>SELL</span>
      </button>
      <span className={`${styles.qtSpread} tabular`}>{spread !== null ? fmtNumber(spread, pricePrecision(spec), { grouping: false }) : ''}</span>
      <button type="button" className={`${styles.qtBtn} ${styles.qtBuy}`} onClick={() => openTicket('chart-buy', 'buy')} data-testid="quick-buy">
        <span className="tabular">{quote ? fmtPrice(quote.ask, spec) : '—'}</span>
        <span className={styles.qtLabel}>BUY</span>
      </button>
    </div>
  );
}

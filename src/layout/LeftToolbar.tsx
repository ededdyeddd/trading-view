import { Crosshair, Eye, Lock, Magnet, PencilLine, Ruler, Slash, Smile, Spline, Trash2, Type, Waves, Rows3, GitFork, ZoomIn } from 'lucide-react';
import { useState } from 'react';
import styles from './LeftToolbar.module.css';

const GROUPS = [
  [
    { id: 'cross', label: 'Cross', icon: Crosshair },
    { id: 'trend', label: 'Trend line', icon: Slash },
    { id: 'fib', label: 'Fib retracement', icon: Rows3 },
    { id: 'pattern', label: 'Patterns', icon: GitFork },
    { id: 'forecast', label: 'Forecasting', icon: Waves },
    { id: 'brush', label: 'Brush', icon: Spline },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'icon', label: 'Icons', icon: Smile },
  ],
  [
    { id: 'measure', label: 'Measure', icon: Ruler },
    { id: 'zoom', label: 'Zoom in', icon: ZoomIn },
  ],
  [
    { id: 'magnet', label: 'Magnet', icon: Magnet },
    { id: 'stay', label: 'Stay in drawing mode', icon: PencilLine },
    { id: 'lock', label: 'Lock all drawings', icon: Lock },
    { id: 'hide', label: 'Hide all drawings', icon: Eye },
  ],
  [{ id: 'remove', label: 'Remove drawings', icon: Trash2 }],
];

/** Drawing tools — placeholders only (selection state, no drawing). */
export function LeftToolbar() {
  const [active, setActive] = useState('cross');
  return (
    <nav className={styles.toolbar} aria-label="Drawing tools">
      {GROUPS.map((group, i) => (
        <div key={i} className={styles.group}>
          {group.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              className={`${styles.btn} ${active === t.id ? styles.active : ''}`}
              onClick={() => setActive(t.id)}
            >
              <t.icon size={22} strokeWidth={1.3} />
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

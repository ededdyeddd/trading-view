import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import styles from './Popover.module.css';

type Props = {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  /** Match anchor width. */
  matchWidth?: boolean;
  offset?: number;
};

/** Anchored floating layer rendered into body; closes on outside click and Escape. */
export function Popover({ anchor, open, onClose, children, align = 'start', matchWidth, offset = 4 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    let left = align === 'end' ? r.right - (matchWidth ? r.width : w) : r.left;
    left = Math.max(4, Math.min(left, window.innerWidth - (matchWidth ? r.width : w) - 4));
    let top = r.bottom + offset;
    if (top + h > window.innerHeight - 4) top = Math.max(4, r.top - offset - h);
    setPos({ top, left, width: matchWidth ? r.width : undefined });
  }, [open, anchor, align, matchWidth, offset]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  children,
  active,
  disabled,
  onSelect,
  end,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  end?: ReactNode;
}) {
  return (
    <button type="button" className={`${styles.item} ${active ? styles.active : ''}`} disabled={disabled} onClick={onSelect} role="menuitem">
      <span className={styles.itemLabel}>{children}</span>
      {end !== undefined && <span className={styles.itemEnd}>{end}</span>}
    </button>
  );
}

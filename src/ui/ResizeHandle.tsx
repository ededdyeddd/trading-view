import { useRef } from 'react';
import styles from './ResizeHandle.module.css';

type Props = {
  direction: 'horizontal' | 'vertical';
  /** Called with the pointer delta since drag start (px). */
  onDrag: (delta: number) => void;
  onStart?: () => void;
  className?: string;
};

/** Invisible drag strip; `horizontal` resizes width (drag along X), `vertical` resizes height (drag along Y). */
export function ResizeHandle({ direction, onDrag, onStart, className }: Props) {
  const start = useRef(0);
  return (
    <div
      className={`${styles.handle} ${direction === 'horizontal' ? styles.h : styles.v} ${className ?? ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = direction === 'horizontal' ? e.clientX : e.clientY;
        onStart?.();
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        onDrag((direction === 'horizontal' ? e.clientX : e.clientY) - start.current);
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.style.cursor = '';
      }}
    />
  );
}

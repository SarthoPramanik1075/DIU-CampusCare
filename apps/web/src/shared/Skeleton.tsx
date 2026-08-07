import type { CSSProperties, JSX } from 'react';

import './Skeleton.css';

export function Skeleton({ width, height }: { readonly width: string; readonly height?: string }): JSX.Element {
  const style: CSSProperties = { width, ...(height !== undefined ? { height } : {}) };
  return <div className="cc-skeleton" style={style} />;
}

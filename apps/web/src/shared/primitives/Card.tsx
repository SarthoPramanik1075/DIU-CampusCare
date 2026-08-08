import type { JSX, ReactNode } from 'react';

import './Card.css';

export interface CardProps {
  readonly title?: string;
  readonly children: ReactNode;
}

/** FRONTEND Part 8 — the bordered surface every dashboard tile and detail panel is built from. */
export function Card({ title, children }: CardProps): JSX.Element {
  return (
    <section className="cc-card">
      {title !== undefined && <h2 className="cc-card__title">{title}</h2>}
      {children}
    </section>
  );
}

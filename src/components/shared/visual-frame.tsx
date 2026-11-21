import { useId, type CSSProperties, type ReactNode } from 'react';

export function VisualFrame({
  className,
  label,
  children,
  component,
  authorRoot,
}: {
  className: string;
  label: ReactNode;
  children: ReactNode;
  /** Stable component hook consumed by theme CSS; omitted for plain frames. */
  component?: string;
  authorRoot?: { style?: CSSProperties; ref?: (element: HTMLElement | null) => void };
}) {
  const titleId = useId();
  return (
    <figure
      {...authorRoot}
      className={`local-visual ${className}`}
      aria-labelledby={titleId}
      data-rmd-component={component}
    >
      <figcaption id={titleId} className="local-visual-title" data-rmd-part="title">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

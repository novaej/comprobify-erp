import type { SVGProps } from 'react';

const stackedColors = {
  dark: {
    arc: '#D5DBE3',
    bolt: '#62B8AC',
    boltStroke: '#1A212C',
    wordPrimary: '#D5DBE3',
    wordAccent: '#62B8AC',
  },
  light: {
    arc: '#232B36',
    bolt: '#0F766E',
    boltStroke: '#F3F1EC',
    wordPrimary: '#232B36',
    wordAccent: '#0F766E',
  },
};

/** Square icon mark — adapts to light/dark mode via CSS tokens */
export function Logomark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      role="img"
      aria-label="Comprobify"
      className={className}
      {...props}
    >
      <title>Comprobify</title>
      <path
        d="M 88 30 A 32 32 0 1 0 88 90"
        className="stroke-foreground"
        strokeWidth="16"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 104 28 L 58 58 L 74 58 L 52 100 L 78 64 L 62 64 Z"
        className="fill-primary stroke-background"
        strokeWidth="6"
        strokeLinejoin="round"
        style={{ paintOrder: 'stroke fill' }}
      />
    </svg>
  );
}

/** Stacked lockup — icon above wordmark, for auth pages */
export function LogoLockupStacked({
  variant = 'light',
  className,
  ...props
}: SVGProps<SVGSVGElement> & { variant?: 'dark' | 'light' }) {
  const c = stackedColors[variant];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 480 280"
      role="img"
      aria-label="Comprobify"
      className={className}
      {...props}
    >
      <title>Comprobify</title>
      <g transform="translate(180, 0)">
        <path
          d="M 88 30 A 32 32 0 1 0 88 90"
          stroke={c.arc}
          strokeWidth="16"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 104 28 L 58 58 L 74 58 L 52 100 L 78 64 L 62 64 Z"
          fill={c.bolt}
          stroke={c.boltStroke}
          strokeWidth="6"
          strokeLinejoin="round"
          style={{ paintOrder: 'stroke fill' }}
        />
      </g>
      <text
        x="240"
        y="240"
        textAnchor="middle"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="64"
        letterSpacing="-1.6"
      >
        <tspan fill={c.wordPrimary}>Compro</tspan>
        <tspan fill={c.wordAccent}>bify</tspan>
      </text>
    </svg>
  );
}

/** Horizontal lockup — always on dark sidebar background, uses sidebar CSS tokens */
export function LogoLockup({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 660 120"
      role="img"
      aria-label="Comprobify"
      className={className}
      {...props}
    >
      <title>Comprobify</title>
      <g>
        <path
          d="M 88 30 A 32 32 0 1 0 88 90"
          className="stroke-sidebar-foreground"
          strokeWidth="16"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 104 28 L 58 58 L 74 58 L 52 100 L 78 64 L 62 64 Z"
          className="fill-sidebar-primary stroke-sidebar"
          strokeWidth="6"
          strokeLinejoin="round"
          style={{ paintOrder: 'stroke fill' }}
        />
      </g>
      <text
        x="140"
        y="86"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="72"
        letterSpacing="-2"
      >
        <tspan className="fill-sidebar-foreground">Compro</tspan>
        <tspan className="fill-sidebar-primary">bify</tspan>
      </text>
    </svg>
  );
}

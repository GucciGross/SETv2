/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        set: {
          // Palette lives in CSS variables (src/index.css) so light mode is a
          // variable swap; triplets keep Tailwind's /opacity modifiers working.
          bg: 'rgb(var(--set-bg) / <alpha-value>)',
          panel: 'rgb(var(--set-panel) / <alpha-value>)',
          panel2: 'rgb(var(--set-panel2) / <alpha-value>)',
          border: 'rgb(var(--set-border) / <alpha-value>)',
          text: 'rgb(var(--set-text) / <alpha-value>)',
          dim: 'rgb(var(--set-dim) / <alpha-value>)',
          accent: 'rgb(var(--set-accent) / <alpha-value>)',
          accent2: 'rgb(var(--set-accent2) / <alpha-value>)',
          ok: 'rgb(var(--set-ok) / <alpha-value>)',
          warn: 'rgb(var(--set-warn) / <alpha-value>)',
          err: 'rgb(var(--set-err) / <alpha-value>)',
          live: 'rgb(var(--set-live) / <alpha-value>)',
        },
      },
      boxShadow: {
        // Card: ink drop + a 1px top light catch so edges read machined.
        card: 'inset 0 1px 0 0 rgb(255 255 255 / 0.03), 0 10px 28px -14px rgb(0 0 0 / 0.55)',
        pop: '0 18px 50px -16px rgb(0 0 0 / 0.7), inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
        'glow-accent': '0 0 0 1px rgb(108 140 255 / 0.35), 0 0 28px -8px rgb(108 140 255 / 0.5)',
      },
      maxWidth: {
        shell: '72rem',
      },
    },
  },
  plugins: [],
};

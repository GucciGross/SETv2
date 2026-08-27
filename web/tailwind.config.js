/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        set: {
          // Surfaces — cool graphite, steps tuned so panels separate from the
          // canvas without halos. Borders read as hairlines, not cages.
          bg: '#0a0c11',
          panel: '#0f1219',
          panel2: '#151a26',
          border: '#242c3e',
          text: '#dee4f0',
          dim: '#8b93a6',
          // Brand pair — blue is the voice, violet the AI/agent register.
          accent: '#6c8cff',
          accent2: '#8b5cf6',
          // Status register used by shells/indicators (matches the dither-kit
          // seed hues so charts and chips stay in one family).
          ok: '#34d399',
          warn: '#fbbf24',
          err: '#f87171',
          live: '#22d3ee',
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

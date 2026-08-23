/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        set: {
          bg: '#0c0e13',
          panel: '#12151d',
          panel2: '#181c26',
          border: '#242a38',
          text: '#d7dce6',
          dim: '#8b93a5',
          accent: '#6c8cff',
          accent2: '#8b5cf6',
        },
      },
    },
  },
  plugins: [],
};

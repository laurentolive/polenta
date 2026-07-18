/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{tsx,ts,html}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        hover: 'var(--surface-hover)',
        'folder-row': 'var(--folder-row)',
        'row-hover': 'var(--row-hover)',
        edge: 'var(--edge)',
        'edge-subtle': 'var(--edge-subtle)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        prim: {
          DEFAULT: 'var(--prim)',
          fg: 'var(--prim-fg)',
        },
      },
    },
  },
  plugins: [],
}

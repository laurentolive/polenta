import { themeColors } from './tailwind.theme.generated.js'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{tsx,ts,html}'],
  theme: {
    extend: {
      colors: themeColors,
    },
  },
  plugins: [],
}

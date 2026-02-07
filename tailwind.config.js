/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        lily: {
          bg: 'var(--lily-bg)',
          card: 'var(--lily-card)',
          accent: 'var(--lily-accent)',
          hover: 'var(--lily-accent-hover)',
          text: 'var(--lily-text)',
          muted: 'var(--lily-muted)',
          border: 'var(--lily-border)',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Fira Code', 'monospace']
      },
      backdropBlur: {
        'glass': '16px',
        'glass-heavy': '24px',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-in',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
      },
      transitionTimingFunction: {
        'lily': 'cubic-bezier(0.4, 0, 0.2, 1)',
      }
    }
  },
  plugins: []
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        lily: {
          bg: '#0f0f1a',
          card: '#16213e',
          accent: '#e94560',
          hover: '#ff6b6b',
          text: '#e0e0e0',
          muted: '#8892b0',
          border: '#2a2a4a',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Fira Code', 'monospace']
      },
      backdropBlur: {
        'glass': '13px',
        'glass-heavy': '20px',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-in',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' }
        }
      }
    }
  },
  plugins: []
}

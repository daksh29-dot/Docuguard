/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        monster: {
          green: '#00FF41',
          lime: '#39FF14',
          dark: '#0a0a0a',
          card: '#111111',
          border: '#1a1a1a',
          accent: '#00CC33',
          muted: '#1e1e1e',
          text: '#cccccc',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Rajdhani', 'Impact', 'sans-serif'],
      },
      boxShadow: {
        'neon': '0 0 10px #00FF41, 0 0 20px #00FF4133',
        'neon-sm': '0 0 6px #00FF4199',
        'neon-red': '0 0 10px #FF003399, 0 0 20px #FF003333',
      },
      animation: {
        'pulse-green': 'pulse-green 2s ease-in-out infinite',
        'scanline': 'scanline 3s linear infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        'pulse-green': {
          '0%, 100%': { boxShadow: '0 0 6px #00FF41, 0 0 12px #00FF4166' },
          '50%': { boxShadow: '0 0 14px #00FF41, 0 0 30px #00FF4199' },
        },
        'scanline': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
    },
  },
  plugins: [],
}

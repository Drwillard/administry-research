import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          raised: '#f4f5f9',
          border: '#e2e5ed',
          hover: '#eef0f6',
        },
      },
      backgroundImage: {
        'glow-violet': 'radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.07) 0%, transparent 70%)',
        'glow-cyan':   'radial-gradient(ellipse at 50% 100%, rgba(6,182,212,0.05) 0%, transparent 70%)',
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease-in-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}

export default config

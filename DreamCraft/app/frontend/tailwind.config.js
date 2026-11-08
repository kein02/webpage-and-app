/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 深空底（3D 沉浸式规范）
        space: {
          950: '#0B0B10',
          900: '#0F0F16',
          800: '#15151E',
          700: '#1C1C28',
          600: '#252536',
        },
        // 强调色：橙（用于 CTA / hover / 进度）
        brand: {
          DEFAULT: '#FF6B2C',
          50: '#2A1608',
          100: '#3A1E0B',
          200: '#5C3011',
          300: '#8A4818',
          400: '#C25A1F',
          500: '#FF6B2C',
          600: '#FF8547',
          700: '#FFA06E',
        },
        // 文字
        ink: {
          DEFAULT: '#F2F3F5',
          dim: '#A8ADB8',
          faint: '#6B7280',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"MiSans"', 'Sora', 'system-ui', 'sans-serif'],
        sans: ['"Space Grotesk"', '"MiSans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 32px rgba(255,107,44,0.28)',
        'glow-sm': '0 0 16px rgba(255,107,44,0.2)',
        panel: '0 24px 64px rgba(0,0,0,0.55)',
      },
      backdropBlur: { xs: '2px' },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        float: 'float 6s ease-in-out infinite',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) both',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

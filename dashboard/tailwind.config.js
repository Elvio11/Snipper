/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0c',
        card: '#121217',
        neon: '#00f2ff',
        accent: '#0066ff',
        success: '#00ff88',
        danger: '#ff0055',
        warning: '#ffaa00',
      },
      backgroundImage: {
        'glass': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01))',
      },
      boxShadow: {
        'neon': '0 0 10px rgba(0, 242, 255, 0.3)',
        'neon-strong': '0 0 20px rgba(0, 242, 255, 0.5)',
      }
    },
  },
  plugins: [],
}

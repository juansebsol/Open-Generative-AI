/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./packages/studio/src/**/*.{js,jsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#22d3ee',
                    hover: '#06b6d4',
                },
                'app-bg': '#09090b',
                'panel-bg': '#0c0c0f',
                'card-bg': '#111114',
                secondary: '#a1a1aa',
                muted: '#52525b',
            },
            fontFamily: {
                sans: ['var(--font-geist)', 'Geist', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['var(--font-geist-mono)', 'Geist Mono', 'ui-monospace', 'Menlo', 'monospace'],
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
                '3xl': '2rem',
            },
            boxShadow: {
                'glow': '0 0 20px rgba(34, 211, 238, 0.4)',
                'glow-accent': '0 0 20px rgba(168, 85, 247, 0.4)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            }
        },
    },
    plugins: [],
}

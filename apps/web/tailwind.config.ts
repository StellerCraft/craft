import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary - Deep authoritative blues
        primary: '#000519',
        'primary-container': '#001b4f',
        'primary-fixed': '#dae2ff',
        'primary-fixed-dim': '#b2c5ff',
        'on-primary': '#ffffff',
        'on-primary-container': '#4b80fb',
        'on-primary-fixed': '#001848',
        'on-primary-fixed-variant': '#0040a2',
        
        // Secondary
        secondary: '#545f73',
        'secondary-container': '#d5e0f8',
        'secondary-fixed': '#d8e3fb',
        'secondary-fixed-dim': '#bcc7de',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#586377',
        'on-secondary-fixed': '#111c2d',
        'on-secondary-fixed-variant': '#3c475a',
        
        // Tertiary - High-energy cyan accents
        tertiary: '#00070a',
        'tertiary-container': '#002328',
        'tertiary-fixed': '#9cf0ff',
        'tertiary-fixed-dim': '#00daf3',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#0094a6',
        'on-tertiary-fixed': '#001f24',
        'on-tertiary-fixed-variant': '#004f58',
        
        // Surface hierarchy
        background: '#f7f9fb',
        surface: '#f7f9fb',
        'surface-dim': '#d8dadc',
        'surface-bright': '#f7f9fb',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f2f4f6',
        'surface-container': '#eceef0',
        'surface-container-high': '#e6e8ea',
        'surface-container-highest': '#e0e3e5',
        'surface-variant': '#e0e3e5',
        'surface-tint': '#0c56d0',
        'on-surface': '#191c1e',
        'on-surface-variant': '#43474e',
        'on-background': '#191c1e',
        
        // Inverse
        'inverse-surface': '#2d3133',
        'inverse-on-surface': '#eff1f3',
        'inverse-primary': '#b2c5ff',
        
        // Outline
        outline: '#74777f',
        'outline-variant': '#c4c6cf',
        
        // Error
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        display: ['Manrope', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      spacing: {
        '12': '3rem',
        '24': '6rem',
      },
      borderRadius: {
        'DEFAULT': '0.125rem',
        'sm': '0.25rem',
        'md': '0.375rem',
        'lg': '0.25rem',
        'xl': '0.5rem',
        'full': '0.75rem',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #000519 0%, #001b4f 100%)',
      },
      backdropBlur: {
        'glass': '20px',
      },
    },
  },
  plugins: [],
};

export default config;

'use client';

import React, { useState } from 'react';

interface NavLink {
  label: string;
  href: string;
}

interface NavbarProps {
  links?: NavLink[];
  onLoginClick?: () => void;
  onCtaClick?: () => void;
}

export function Navbar({ 
  links = [
    { label: 'Products', href: '#products' },
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
  ],
  onLoginClick,
  onCtaClick,
}: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 bg-slate-50/70 backdrop-blur-xl border-b border-slate-200/20 shadow-sm">
      <div className="flex justify-between items-center max-w-7xl mx-auto px-6 h-16">
        <div className="flex items-center gap-8">
          <a 
            href="/" 
            className="text-xl font-bold tracking-tighter text-blue-900 font-headline"
          >
            CRAFT
          </a>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            {links.map((link, index) => (
              <a
                key={index}
                href={link.href}
                className={`${
                  index === 0 
                    ? 'text-blue-600 font-semibold' 
                    : 'text-slate-600 hover:text-blue-900'
                } transition-colors font-headline text-sm tracking-tight`}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Desktop Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={onLoginClick}
            className="hidden md:block px-4 py-2 text-slate-600 hover:text-blue-900 font-headline text-sm font-medium transition-all active:scale-95"
          >
            Log In
          </button>
          <button 
            onClick={onCtaClick}
            className="primary-gradient text-white px-5 py-2.5 rounded-lg font-headline text-sm font-bold tracking-tight shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            Start Building
          </button>
          
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-slate-600 hover:text-blue-900 p-2 transition-colors"
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6 transition-transform duration-300 ease-in-out"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {mobileMenuOpen ? (
                <path 
                  className="animate-in fade-in duration-200"
                  d="M6 18L18 6M6 6l12 12" 
                />
              ) : (
                <path 
                  className="animate-in fade-in duration-200"
                  d="M4 6h16M4 12h16M4 18h16" 
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <div 
        className={`md:hidden border-t border-slate-200/20 bg-slate-50/95 backdrop-blur-xl overflow-hidden transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className={`px-6 py-4 space-y-3 transition-all duration-300 ${
          mobileMenuOpen ? 'translate-y-0' : '-translate-y-4'
        }`}>
          {links.map((link, index) => (
            <a
              key={index}
              href={link.href}
              className={`block text-slate-600 hover:text-blue-900 transition-all text-sm font-headline py-2 ${
                mobileMenuOpen 
                  ? 'opacity-100 translate-x-0' 
                  : 'opacity-0 -translate-x-4'
              }`}
              style={{
                transitionDelay: mobileMenuOpen ? `${index * 50}ms` : '0ms',
                transitionDuration: '300ms'
              }}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className={`pt-4 space-y-3 border-t border-slate-200/20 transition-all duration-300 ${
            mobileMenuOpen 
              ? 'opacity-100 translate-x-0' 
              : 'opacity-0 -translate-x-4'
          }`}
          style={{
            transitionDelay: mobileMenuOpen ? `${links.length * 50}ms` : '0ms'
          }}>
            <button
              onClick={() => {
                onLoginClick?.();
                setMobileMenuOpen(false);
              }}
              className="block w-full text-left text-slate-600 hover:text-blue-900 transition-colors text-sm font-headline py-2"
            >
              Log In
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

import React from 'react';

interface FooterLink {
  label: string;
  href: string;
}

interface FooterSection {
  title: string;
  links: FooterLink[];
}

interface FooterProps {
  sections: FooterSection[];
  copyright?: string;
}

export function Footer({ sections, copyright }: FooterProps) {
  return (
    <footer className="w-full py-12 px-6 border-t border-slate-200 bg-slate-100">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 max-w-7xl mx-auto">
        <div className="col-span-2">
          <span className="font-headline font-bold text-lg text-blue-900 block mb-4">
            CRAFT
          </span>
          <p className="text-slate-500 text-sm max-w-xs mb-6">
            Empowering developers to build secure, scalable DeFi on the Stellar network.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-surface-container-high border border-outline-variant/10">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" />
            </svg>
            <span className="text-[10px] font-bold tracking-widest text-on-secondary-container uppercase">
              Built on Stellar
            </span>
          </div>
        </div>
        
        {sections.map((section, index) => (
          <div key={index}>
            <h5 className="text-blue-900 font-bold text-sm mb-4">{section.title}</h5>
            <ul className="space-y-2 text-slate-500 text-sm">
              {section.links.map((link, linkIndex) => (
                <li key={linkIndex}>
                  <a 
                    href={link.href}
                    className="hover:underline hover:text-blue-900 transition-all"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      
      <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-slate-200/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-slate-500 text-xs font-body">
          {copyright || '© 2026 CRAFT Framework. Built on Stellar.'}
        </p>
        <div className="flex gap-6">
          <span className="text-[10px] text-slate-400 font-bold tracking-widest">
            SYSTEM STATUS: ALL OPERATIONAL
          </span>
        </div>
      </div>
    </footer>
  );
}

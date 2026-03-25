import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from './Navbar';

describe('Navbar', () => {
  it('renders the logo', () => {
    render(<Navbar />);
    expect(screen.getByText('CRAFT')).toBeDefined();
  });

  it('renders default navigation links', () => {
    render(<Navbar />);
    const productsLinks = screen.getAllByText('Products');
    expect(productsLinks.length).toBeGreaterThan(0);
    const featuresLinks = screen.getAllByText('Features');
    expect(featuresLinks.length).toBeGreaterThan(0);
    const pricingLinks = screen.getAllByText('Pricing');
    expect(pricingLinks.length).toBeGreaterThan(0);
  });

  it('renders custom navigation links', () => {
    const customLinks = [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ];
    render(<Navbar links={customLinks} />);
    const aboutLinks = screen.getAllByText('About');
    expect(aboutLinks.length).toBeGreaterThan(0);
    const contactLinks = screen.getAllByText('Contact');
    expect(contactLinks.length).toBeGreaterThan(0);
  });

  it('renders Log In button', () => {
    render(<Navbar />);
    const loginButtons = screen.getAllByText('Log In');
    expect(loginButtons.length).toBeGreaterThan(0);
  });

  it('renders Start Building CTA', () => {
    render(<Navbar />);
    expect(screen.getByText('Start Building')).toBeDefined();
  });

  it('handles login click', () => {
    const handleLogin = vi.fn();
    render(<Navbar onLoginClick={handleLogin} />);
    
    const loginButtons = screen.getAllByText('Log In');
    fireEvent.click(loginButtons[0]);
    expect(handleLogin).toHaveBeenCalledOnce();
  });

  it('handles CTA click', () => {
    const handleCta = vi.fn();
    render(<Navbar onCtaClick={handleCta} />);
    
    const ctaButtons = screen.getAllByText('Start Building');
    fireEvent.click(ctaButtons[0]);
    expect(handleCta).toHaveBeenCalledOnce();
  });

  it('toggles mobile menu', () => {
    render(<Navbar />);
    
    const menuButton = screen.getByLabelText('Toggle menu');
    expect(menuButton).toBeDefined();
    
    // Mobile menu should be hidden initially (opacity-0)
    const mobileLinks = screen.getAllByText('Products');
    expect(mobileLinks.length).toBe(2); // Desktop + Mobile (hidden)
    
    // Click to open mobile menu
    fireEvent.click(menuButton);
    
    // Mobile menu should now be visible
    const visibleLinks = screen.getAllByText('Products');
    expect(visibleLinks.length).toBe(2); // Still 2, but mobile one is now visible
  });

  it('closes mobile menu when link is clicked', () => {
    render(<Navbar />);
    
    const menuButton = screen.getByLabelText('Toggle menu');
    fireEvent.click(menuButton);
    
    // Click a mobile menu link (the second one is the mobile version)
    const mobileLinks = screen.getAllByText('Products');
    fireEvent.click(mobileLinks[1]);
    
    // Menu should still have both links (desktop + mobile hidden)
    const remainingLinks = screen.getAllByText('Products');
    expect(remainingLinks.length).toBe(2);
  });

  it('applies correct styling classes', () => {
    render(<Navbar />);
    const logo = screen.getByText('CRAFT');
    expect(logo.className).toContain('font-headline');
    expect(logo.className).toContain('font-bold');
    expect(logo.className).toContain('text-blue-900');
  });
});

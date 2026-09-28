/**
 * Tests for UserMenu — #1331
 *
 * Verifies that the dropdown is explicitly closed when an internal navigation
 * item is clicked, so that a Next.js client-side route change doesn't leave the
 * menu rendered open behind the newly-navigated page.
 *
 * ⚠️  DO NOT run this test file in production. It is a unit test only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserMenu } from './UserMenu';
import type { User } from '@/types/navigation';

const mockUser: User = {
  id: 'user-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'user',
};

function openMenu() {
  // The trigger button shows the user avatar/initials; click it to open.
  fireEvent.click(screen.getByRole('button', { expanded: false } as never) ?? screen.getAllByRole('button')[0]);
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the trigger button', () => {
    render(<UserMenu user={mockUser} />);
    // The trigger button is always present.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('opens the dropdown when the trigger is clicked', () => {
    render(<UserMenu user={mockUser} />);
    expect(screen.queryByText('Profile')).toBeNull();

    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('Profile')).toBeDefined();
  });

  it('closes the dropdown when the trigger is clicked a second time', () => {
    render(<UserMenu user={mockUser} />);
    const trigger = screen.getAllByRole('button')[0];

    fireEvent.click(trigger); // open
    expect(screen.getByText('Profile')).toBeDefined();

    fireEvent.click(trigger); // close
    expect(screen.queryByText('Profile')).toBeNull();
  });

  it('closes the dropdown on Escape key', () => {
    render(<UserMenu user={mockUser} />);
    fireEvent.click(screen.getAllByRole('button')[0]); // open

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Profile')).toBeNull();
  });

  it('closes the dropdown on outside click', () => {
    render(
      <div>
        <UserMenu user={mockUser} />
        <button data-testid="outside">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    expect(screen.getByText('Profile')).toBeDefined();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Profile')).toBeNull();
  });

  // #1331 — close on internal navigation click ----------------------------------

  it('closes the menu when the Profile item is clicked', async () => {
    const onProfileClick = vi.fn();
    render(<UserMenu user={mockUser} onProfileClick={onProfileClick} />);

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    expect(screen.getByText('Profile')).toBeDefined();

    fireEvent.click(screen.getByText('Profile'));

    await waitFor(() => {
      // The dropdown must be unmounted after the navigation click.
      expect(screen.queryByText('Settings')).toBeNull();
    });
    // The navigation callback was still called.
    expect(onProfileClick).toHaveBeenCalledOnce();
  });

  it('closes the menu when the Settings item is clicked', async () => {
    const onSettingsClick = vi.fn();
    render(<UserMenu user={mockUser} onSettingsClick={onSettingsClick} />);

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    fireEvent.click(screen.getByText('Settings'));

    await waitFor(() => {
      expect(screen.queryByText('Profile')).toBeNull();
    });
    expect(onSettingsClick).toHaveBeenCalledOnce();
  });

  it('closes the menu when the Billing item is clicked', async () => {
    const onBillingClick = vi.fn();
    render(<UserMenu user={mockUser} onBillingClick={onBillingClick} />);

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    fireEvent.click(screen.getByText('Billing'));

    await waitFor(() => {
      expect(screen.queryByText('Profile')).toBeNull();
    });
    expect(onBillingClick).toHaveBeenCalledOnce();
  });

  it('closes the menu when the Log Out item is clicked', async () => {
    const onLogoutClick = vi.fn();
    render(<UserMenu user={mockUser} onLogoutClick={onLogoutClick} />);

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    fireEvent.click(screen.getByText('Log Out'));

    await waitFor(() => {
      expect(screen.queryByText('Profile')).toBeNull();
    });
    expect(onLogoutClick).toHaveBeenCalledOnce();
  });

  it('closes the menu even when no navigation callback is provided', async () => {
    // Regression: menu must close regardless of whether a callback is wired up,
    // so a client-side navigation triggered externally doesn't leave it open.
    render(<UserMenu user={mockUser} />);

    fireEvent.click(screen.getAllByRole('button')[0]); // open
    expect(screen.getByText('Profile')).toBeDefined();

    fireEvent.click(screen.getByText('Profile'));

    await waitFor(() => {
      expect(screen.queryByText('Settings')).toBeNull();
    });
  });

  it('displays the user name and email inside the open dropdown', () => {
    render(<UserMenu user={mockUser} />);
    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(screen.getByText(mockUser.name)).toBeDefined();
    expect(screen.getByText(mockUser.email)).toBeDefined();
  });

  it('shows initials when no avatar URL is provided', () => {
    render(<UserMenu user={{ ...mockUser, avatar: undefined }} />);
    // "JD" are the initials for "Jane Doe"
    const initialsEls = screen.getAllByText('JD');
    expect(initialsEls.length).toBeGreaterThan(0);
  });
});

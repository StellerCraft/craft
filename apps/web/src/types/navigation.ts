export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'user' | 'admin';
}

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
  disabled?: boolean;
}

export interface Breadcrumb {
  label: string;
  path?: string;
}

export type StatusType = 'operational' | 'degraded' | 'outage' | 'maintenance';

export interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  onClick?: () => void;
}

import React from 'react';
import {
  CheckCircle2,
  Clock,
  PhoneCall,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Sparkles
} from 'lucide-react?deps=react';

export function Badge({ children, variant = 'default', size = 'md', icon: CustomIcon, className = '' }) {
  const variantStyles = {
    default: 'bg-slate-100 text-slate-700 border-slate-200/80',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200/80',
    primary: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    queued: 'bg-blue-50 text-blue-700 border-blue-200',
    calling: 'bg-purple-50 text-purple-700 border-purple-200 animate-pulse',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    riskLow: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    riskMedium: 'bg-amber-50 text-amber-700 border-amber-200',
    riskHigh: 'bg-rose-50 text-rose-700 border-rose-200 font-semibold'
  };

  const defaultIcons = {
    confirmed: CheckCircle2,
    success: CheckCircle2,
    pending: Clock,
    queued: Clock,
    calling: PhoneCall,
    cancelled: XCircle,
    failed: XCircle,
    danger: AlertTriangle,
    warning: AlertTriangle,
    riskLow: ShieldCheck,
    riskHigh: ShieldAlert
  };

  const IconComponent = CustomIcon || defaultIcons[variant];
  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2'
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border transition-colors ${variantStyles[variant] || variantStyles.default} ${sizeStyles[size] || sizeStyles.md} ${className}`}
    >
      {IconComponent && <IconComponent className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
      <span>{children}</span>
    </span>
  );
}

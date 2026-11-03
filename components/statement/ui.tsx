'use client';

import { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/* Shared building blocks for the statement tool: neutral surfaces, hairline borders, colour only as accents. */

export const Panel = ({ className, ...props }: React.ComponentProps<'div'>) =>
  <div {...props} className={cn('rounded-xl border border-zinc-200 bg-white', className)} />;

export const Logo = ({ className }: { className?: string }) => (
  <div className={cn('flex size-7 items-center justify-center rounded-lg bg-zinc-900 text-white', className)}><FileText className="size-4" /></div>
);

export function Field({ icon: Icon, className, ...props }: React.ComponentProps<'input'> & { icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="relative flex-1">
      {Icon && <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />}
      <input {...props} className={cn('h-10 w-full rounded-lg border border-zinc-200 bg-white text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100',
        Icon ? 'pr-3 pl-9' : 'px-3', className)} />
    </div>
  );
}

/* One panel split into cells, like a KPI row. */
export const Strip = ({ cols = 4, children }: { cols?: 3 | 4; children: React.ReactNode }) => (
  <div className={cn('grid divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white sm:divide-x sm:divide-y-0',
    cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>{children}</div>
);
export function Cell({ label, value, sub, big, mono, action }:
  { label: string; value: React.ReactNode; sub?: string; big?: boolean; mono?: boolean; action?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2"><p className="text-[13px] text-zinc-500">{label}</p>{action}</div>
      <div className={cn('mt-1.5 truncate tabular-nums tracking-tight', big ? 'text-2xl font-semibold' : 'text-[15px] font-medium',
        mono && 'font-mono text-[13px] font-normal tracking-normal')}>{value}</div>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

export function Avatar({ name, size = 'lg' }: { name: string; size?: 'lg' | 'sm' }) {
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <div className={cn('flex shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 font-medium text-zinc-700',
    size === 'lg' ? 'size-11 text-sm' : 'size-8 text-xs')}>{initials}</div>;
}

export const Tag = ({ children }: { children: React.ReactNode }) =>
  <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700">{children}</span>;

function useCopied() {
  const [copied, setCopied] = useState(false);
  return { copied, copy: (text: string) => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } };
}
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopied();
  return (
    <button type="button" title={label} aria-label={label} onClick={() => copy(text)}
      className="-m-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
export function RefChip({ value }: { value: string }) {
  const { copied, copy } = useCopied();
  return (
    <button type="button" title="Copy reference" onClick={() => copy(value)}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600 hover:bg-zinc-100">
      <span className="text-zinc-400">Ref</span><span className="font-mono">{value.slice(0, 8)}</span>
      {copied ? <Check className="size-3.5 text-zinc-400" /> : <Copy className="size-3.5 text-zinc-400" />}
    </button>
  );
}

/* Neutral notice: icon tile, title, one line, next action. Colour is only an accent on the tile. */
const TONES = { neutral: 'border-zinc-200 bg-zinc-50 text-zinc-600', danger: 'border-red-100 bg-red-50 text-red-600', warning: 'border-amber-100 bg-amber-50 text-amber-600' };
export function Notice({ tone = 'neutral', icon: Icon, title, children, actions }:
  { tone?: keyof typeof TONES; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div role={tone === 'neutral' ? 'status' : 'alert'} className="rise flex gap-3.5 rounded-xl border border-zinc-200 bg-white p-4">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', TONES[tone])}><Icon className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <div className="mt-0.5 text-sm text-zinc-500">{children}</div>
        {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full bg-zinc-100" />
        <div className="flex-1"><Skeleton className="h-4 w-40 bg-zinc-100" /><Skeleton className="mt-2 h-3.5 w-56 bg-zinc-100" /></div>
        <Skeleton className="h-6 w-24 bg-zinc-100" />
      </div>
      <Strip>{[0, 1, 2, 3].map(i => <div key={i} className="px-4 py-3.5"><Skeleton className="h-3.5 w-20 bg-zinc-100" /><Skeleton className="mt-2.5 h-6 w-24 bg-zinc-100" /></div>)}</Strip>
    </div>
  );
}
export function DocumentSkeleton() {
  return (
    <div className="h-[75vh] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-300 p-4 sm:p-6">
      <div className="mx-auto max-w-[794px] bg-white p-8 shadow-md">
        <Skeleton className="h-6 w-64 bg-zinc-100" /><Skeleton className="mt-2 h-4 w-80 bg-zinc-100" />
        <Skeleton className="mt-6 h-8 w-full bg-zinc-100" />
        <div className="mt-3 grid gap-3">
          {Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-4 bg-zinc-100" style={{ width: `${92 - (i % 3) * 7}%` }} />)}
        </div>
      </div>
    </div>
  );
}

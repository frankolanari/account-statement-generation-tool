'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FlaskConical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { flagEmoji } from '@/lib/statement-ui';

/* Demo accounts for anyone the link is shared with: a mix of emails and user IDs, all in the demo database. */
const TEST_ACCOUNTS = [
  { search: 'barrie.morris@example.com', country: 'GB', currency: 'GBP', transactions: 68 },
  { search: 'mark.lenhard@example.com', country: 'US', currency: 'USD', transactions: 40 },
  { search: '1719680000000000003', country: 'IE', currency: 'EUR', transactions: 61 },
  { search: 'akshay.navle@example.com', country: 'CA', currency: 'CAD', transactions: 44 },
  { search: '1719680000000000005', country: 'DE', currency: 'EUR', transactions: 49 },
];

// Floating "Test accounts" button. "Try" fills the search box and runs the search.
export function TestAccounts({ onTry }: { onTry: (identifier: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape' || (e.type === 'mousedown' && !box.current?.contains(e.target as Node))) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const copy = (value: string) => { void navigator.clipboard?.writeText(value); setCopied(value); setTimeout(() => setCopied(null), 1200); };

  return (
    <div ref={box} className="fixed right-5 bottom-5 z-30 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="Test accounts" className="rise w-[min(380px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Test accounts</p>
              <p className="mt-0.5 text-xs text-zinc-500">Demo data, safe to explore. Pick one to try.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="size-4" /></button>
          </div>
          <ul className="divide-y divide-zinc-100">
            {TEST_ACCOUNTS.map((a, i) => {
              const isEmail = a.search.includes('@');
              return (
                <li key={a.search} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 font-mono text-[11px] text-zinc-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', isEmail ? 'font-medium' : 'font-mono text-[13px]')}>{a.search}</p>
                    <p className="text-[11px] text-zinc-400">{isEmail ? 'Email' : 'User ID'} · {flagEmoji(a.country)} {a.currency} · {a.transactions} txns</p>
                  </div>
                  <button type="button" onClick={() => copy(a.search)} title="Copy" aria-label={`Copy ${a.search}`}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
                    {copied === a.search ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                  <Button variant="tactileLight" className="h-7 px-2.5 text-xs" onClick={() => { setOpen(false); onTry(a.search); }}>Try</Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-b from-zinc-700 to-zinc-900 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/.18),0_0_0_1px_rgb(9_9_11),0_6px_16px_-4px_rgb(0_0_0/.35)] transition hover:from-zinc-600 hover:to-zinc-800 active:translate-y-px">
        {open ? <X className="size-4" /> : <FlaskConical className="size-4" />}Test accounts
      </button>
    </div>
  );
}

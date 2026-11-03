'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, CalendarRange, ChevronRight, CircleAlert, CircleCheck, Dot, Download, FilePlus2, FileSpreadsheet, FileText,
  ListEnd, LogOut, RotateCcw, RotateCw, Search, ServerCrash, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import LoadingState from '@/components/primitives/LoadingState';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/statement/date-picker';
import { PdfPreview } from '@/components/statement/preview';
import { TestAccounts } from '@/components/statement/test-accounts';
import {
  AccountSkeleton, Avatar, Cell, CopyButton, DocumentSkeleton, Field, Logo, Notice, Panel, RefChip, Strip, Tag,
} from '@/components/statement/ui';
import { cn } from '@/lib/utils';
import {
  type ApiProblem, type DateRange, buildPresets, dayAfter, daysBetween, flagEmoji, parseApiError, pickerMin, showDate, todayIso,
} from '@/lib/statement-ui';

type Account = {
  user_id: string; full_name: string; email: string; country: string; base_currency: string;
  transaction_count: number; first_transaction_date: string; last_transaction_date: string | null;
};
// The preview is the generated PDF itself; the same file is what "Download PDF" saves.
type Preview = {
  pdf: Blob; fileName: string;
  meta: { input_txn_count: number; output_txn_count: number; is_truncated: boolean; effective_period: DateRange };
};
type Busy = { kind: 'lookup' | 'preview' | 'pdf' | 'csv'; label: string } | null;
type Problem = ApiProblem & { kind: NonNullable<Busy>['kind']; retry: () => void };

class ApiError extends Error {
  constructor(public problem: ApiProblem) { super(problem.message); }
}
async function call(action: string, body: unknown) {
  const res = await fetch(`/api/tool/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401) { window.location.href = '/login'; throw new ApiError({ code: 'UNAUTHORIZED', message: 'Your session has ended.' }); }
  if (!res.ok) throw new ApiError(parseApiError(res.status, await res.json().catch(() => null)));
  return res;
}
function fileNameFrom(disposition: string | null, fallback: string) {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

const STEPS = ['Find account', 'Confirm', 'Choose period', 'Preview & download'];
function Stepper({ current }: { current: number }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-200 bg-white sm:grid-cols-4">
      {STEPS.map((label, i) => {
        const done = i < current, active = i === current;
        return (
          <div key={label} className={cn('relative px-4 py-3', i > 0 && 'border-l border-zinc-200', i === 2 && 'max-sm:border-t max-sm:border-l-0', i === 3 && 'max-sm:border-t')}>
            <span className={cn('absolute inset-x-0 top-0 h-0.5 transition-colors duration-300', active ? 'bg-zinc-900' : done ? 'bg-emerald-500' : 'bg-transparent')} />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-zinc-400">STEP {String(i + 1).padStart(2, '0')}</span>
              {done && <CircleCheck className="size-4 text-emerald-600" />}
            </div>
            <p className={cn('mt-1 text-sm font-medium', active ? 'text-zinc-900' : done ? 'text-zinc-700' : 'text-zinc-400')}>{label}</p>
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, icon: Icon, done, summary, onChange, aside, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; done?: boolean; summary?: string;
  onChange?: () => void; aside?: React.ReactNode; children?: React.ReactNode;
}) {
  if (done) return (
    <Panel className="rise flex items-center gap-3 px-4 py-3">
      <CircleCheck className="size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1 truncate text-sm"><span className="text-zinc-500">{title}</span><span className="mx-2 text-zinc-300">/</span><span className="font-medium">{summary}</span></div>
      {onChange && <Button variant="ghost" size="sm" className="h-8 px-3 text-sm text-zinc-600" onClick={onChange}>Change</Button>}
    </Panel>
  );
  return (
    <Panel className="rise">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-zinc-800"><Icon className="size-4 text-zinc-500" />{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </Panel>
  );
}

function ProblemNotice({ problem, searched, onSearchAgain }: { problem: Problem; searched?: string; onSearchAgain?: () => void }) {
  if (problem.code === 'USER_NOT_FOUND' || problem.code === 'INVALID_IDENTIFIER') return (
    <Notice icon={UserX} title="No account found"
      actions={<Button variant="tactileLight" className="h-8 px-3" onClick={onSearchAgain}><Search className="size-3.5" />Search again</Button>}>
      Nothing matches <span className="font-medium text-zinc-900">“{searched}”</span>.
      <ul className="mt-2 grid gap-1">
        <li className="flex items-center gap-2"><Dot className="size-4 text-zinc-400" />Check the spelling of the email address</li>
        <li className="flex items-center gap-2"><Dot className="size-4 text-zinc-400" />Or search by user ID (19–26 letters and numbers)</li>
      </ul>
    </Notice>
  );
  if (problem.code === 'SERVER') return (
    <Notice tone="danger" icon={ServerCrash} title="Something went wrong"
      actions={<><Button variant="tactile" className="h-8 px-3" onClick={problem.retry}><RotateCw className="size-3.5" />Try again</Button>{problem.ref && <RefChip value={problem.ref} />}</>}>
      The request didn’t complete. Try again, and if it keeps failing, share the reference with the team.
    </Notice>
  );
  return <Notice tone="warning" icon={CircleAlert} title="Couldn’t continue">{problem.message}</Notice>;
}

function AccountCard({ account, confirmed, onConfirm, onSearchAgain }:
  { account: Account; confirmed: boolean; onConfirm: () => void; onSearchAgain: () => void }) {
  return (
    <div className="rise grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={account.full_name} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">{account.full_name}</p>
          <p className="truncate text-sm text-zinc-500">{account.email}</p>
        </div>
        <div className="flex gap-1.5"><Tag>{flagEmoji(account.country)} {account.country}</Tag><Tag>{account.base_currency}</Tag></div>
      </div>
      <Strip>
        <Cell label="Transactions" value={account.transaction_count.toLocaleString()} big />
        <Cell label="First transaction" value={showDate(account.first_transaction_date)} />
        <Cell label="Last transaction" value={showDate(account.last_transaction_date)} />
        <Cell label="User ID" value={account.user_id} mono action={<CopyButton text={account.user_id} label="Copy user ID" />} />
      </Strip>
      {!confirmed && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button className="h-9 px-3.5" onClick={onConfirm}>Confirm account<ArrowRight /></Button>
          <Button variant="ghost" className="h-9 px-3.5 text-zinc-600" onClick={onSearchAgain}>Search again</Button>
        </div>
      )}
    </div>
  );
}

export function StatementTool() {
  const [identifier, setIdentifier] = useState('');
  const [searched, setSearched] = useState('');
  const [candidates, setCandidates] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [range, setRange] = useState<DateRange | null>(null);
  const [rangeLabel, setRangeLabel] = useState('Full history');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const today = todayIso();
  const step = !account || !confirmed ? (account ? 1 : 0) : preview || busy?.kind === 'preview' ? 3 : 2;
  useEffect(() => { if (step > 1) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [step, preview]);

  async function run(kind: NonNullable<Busy>['kind'], label: string, work: () => Promise<void>) {
    setBusy({ kind, label }); setProblem(null);
    try { await work(); } catch (e) {
      const p = e instanceof ApiError ? e.problem : { code: 'SERVER', message: 'Could not reach the server.' };
      setProblem({ ...p, kind, retry: () => void run(kind, label, work) });
    } finally { setBusy(null); }
  }
  function reset() { setCandidates([]); setAccount(null); setConfirmed(false); setRange(null); setPreview(null); setProblem(null); }
  function choose(next: Account) {
    setAccount(next); setCandidates([]);
    setRange({ from: next.first_transaction_date.slice(0, 10), to: today }); setRangeLabel('Full history');
  }
  function searchAgain() { setProblem(null); const el = document.getElementById('identifier') as HTMLInputElement | null; el?.focus(); el?.select(); }

  // value: set when a test account's "Try" starts the search instead of the form.
  const find = (event: React.FormEvent | null, value?: string) => {
    event?.preventDefault();
    const query = (value ?? identifier).trim();
    if (value !== undefined) setIdentifier(value);
    reset(); setSearched(query);
    void run('lookup', 'Finding account', async () => {
      const data = await (await call('lookup', { identifier: query })).json() as { status: string; account?: Account; accounts?: Account[] };
      if (data.status === 'ACCOUNT_SELECTION_REQUIRED' && data.accounts) setCandidates(data.accounts);
      else if (data.account) choose(data.account);
    });
  };
  const build = (r: DateRange = range!) => run('preview', 'Fetching transactions', async () => {
    // One request does all three; the label shows the user the work is moving along.
    const stages = [setTimeout(() => setBusy(b => b && { ...b, label: 'Building statement' }), 1000),
      setTimeout(() => setBusy(b => b && { ...b, label: 'Rendering PDF' }), 2500)];
    try {
      const res = await call('pdf', { userId: account!.user_id, ...r });
      const summary = JSON.parse(decodeURIComponent(res.headers.get('x-statement-meta') ?? '')) as { meta: Preview['meta'] };
      setPreview({ pdf: await res.blob(), fileName: fileNameFrom(res.headers.get('content-disposition'), 'statement.pdf'), meta: summary.meta });
    } finally { stages.forEach(clearTimeout); }
  });
  // After a shortened statement, the next one starts the day after it ended.
  const continueAfter = (endedOn: string) => {
    const next = { from: dayAfter(endedOn), to: range!.to };
    setRange(next); setRangeLabel('Custom'); setPreview(null); void build(next);
  };
  function save(file: Blob, name: string) {
    const url = URL.createObjectURL(file);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // The PDF was already generated for the preview, so saving it is instant; only the CSV is fetched.
  const downloadPdf = () => { if (preview) { save(preview.pdf, preview.fileName); toast.success('PDF downloaded'); } };
  const downloadCsv = () => run('csv', 'Preparing CSV', async () => {
    const res = await call('csv', { userId: account!.user_id, ...range });
    save(await res.blob(), fileNameFrom(res.headers.get('content-disposition'), 'statement.csv'));
    toast.success('CSV downloaded');
  });
  async function signOut() { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; }

  const setPeriod = (next: DateRange, label: string) => { setRange(next); setRangeLabel(label); setPreview(null); };
  const presets = account ? buildPresets(account.first_transaction_date, today) : [];
  const downloading = busy?.kind === 'pdf' || busy?.kind === 'csv';

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Logo /><span className="font-semibold tracking-tight">Statements</span>
            <span className="text-zinc-300">/</span>
            <span className="flex items-center gap-1.5 text-zinc-600"><FilePlus2 className="size-4" />New statement</span>
          </div>
          <div className="flex items-center gap-2">
            {[{ icon: RotateCcw, label: 'Start over', onClick: () => { reset(); setIdentifier(''); } }, { icon: LogOut, label: 'Sign out', onClick: signOut }].map(({ icon: Icon, label, onClick }) => (
              <button key={label} type="button" title={label} aria-label={label} onClick={onClick}
                className="flex size-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"><Icon className="size-4" /></button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-3 px-4 pt-6 pb-24">
        <Stepper current={step} />

        <Section title="Find the account" icon={Search} done={confirmed} summary={account ? `${account.full_name} · ${account.email}` : ''} onChange={reset}>
          <form onSubmit={find} className="flex gap-2">
            <Field icon={Search} id="identifier" aria-label="Email address or user ID" placeholder="Email address or user ID"
              value={identifier} onChange={e => setIdentifier(e.target.value)} autoFocus />
            <Button type="submit" className="h-10 px-4" disabled={!identifier.trim() || !!busy}>Find</Button>
          </form>
          <div className="mt-4 grid gap-3 empty:mt-0">
            {busy?.kind === 'lookup' && <><LoadingState label={busy.label} variant="Dots" /><AccountSkeleton /></>}
            {problem?.kind === 'lookup' && !busy && <ProblemNotice problem={problem} searched={searched} onSearchAgain={searchAgain} />}
            {candidates.length > 0 && (
              <div className="rise grid gap-2">
                <p className="text-sm text-zinc-500">{candidates.length} accounts match. Choose one:</p>
                <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200">
                  {candidates.map(c => (
                    <button key={c.user_id} type="button" onClick={() => choose(c)} className="group flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50">
                      <Avatar name={c.full_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{c.full_name} <span className="ml-1 font-normal text-zinc-500">{flagEmoji(c.country)} {c.country} · {c.base_currency}</span></p>
                        <p className="truncate font-mono text-xs text-zinc-500">{c.user_id}</p>
                      </div>
                      <span className="text-sm text-zinc-600 tabular-nums">{c.transaction_count.toLocaleString()} <span className="text-zinc-400">txns</span></span>
                      <ChevronRight className="size-4 text-zinc-300 group-hover:text-zinc-600" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {account && <AccountCard account={account} confirmed={confirmed} onConfirm={() => setConfirmed(true)} onSearchAgain={() => { reset(); searchAgain(); }} />}
          </div>
        </Section>

        {confirmed && account && range && (
          <Section title="Choose the period" icon={CalendarRange} done={step === 3} onChange={() => setPreview(null)}
            summary={`${showDate(range.from)} – ${showDate(range.to)} · ${rangeLabel}`}>
            <div className="grid gap-4">
              <div className="inline-flex w-fit flex-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                {presets.map(p => (
                  <button key={p.label} type="button" onClick={() => setPeriod(p.range, p.label)}
                    className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      rangeLabel === p.label ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200' : 'text-zinc-500 hover:text-zinc-900')}>{p.label}</button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DatePicker label="From" value={range.from} min={pickerMin(account.first_transaction_date, range.from)} max={range.to} onChange={from => setPeriod({ ...range, from }, 'Custom')} />
                <DatePicker label="To" value={range.to} min={range.from} max={today} onChange={to => setPeriod({ ...range, to }, 'Custom')} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4">
                <p className="text-sm text-zinc-500"><span className="font-medium text-zinc-900 tabular-nums">{daysBetween(range.from, range.to).toLocaleString()}</span> days selected</p>
                <Button className="h-10 px-4" onClick={() => void build()} disabled={!!busy}>Preview statement<ArrowRight /></Button>
              </div>
              {problem?.kind === 'preview' && !busy && <ProblemNotice problem={problem} />}
            </div>
          </Section>
        )}

        {step === 3 && account && range && (
          <Section title="Preview and download" icon={FileText}
            aside={preview && (
              <div className="flex items-center gap-2">
                {downloading && <LoadingState label={busy!.label} variant="Dots" />}
                <Button variant="tactileLight" className="h-9 min-w-[112px] px-3.5" onClick={() => void downloadCsv()} disabled={!!busy}><FileSpreadsheet />CSV</Button>
                <Button variant="tactile" className="h-9 min-w-[112px] px-3.5" onClick={downloadPdf} disabled={!!busy}><Download />PDF</Button>
              </div>
            )}>
            {busy?.kind === 'preview' && <div className="grid gap-4"><LoadingState label={busy.label} variant="Dots" /><DocumentSkeleton /></div>}
            {preview && (
              <div className="rise grid gap-4">
                <Strip cols={3}>
                  <Cell label="Period" value={`${showDate(preview.meta.effective_period.from)} – ${showDate(preview.meta.effective_period.to)}`} sub={rangeLabel} />
                  <Cell label="Transactions" value={preview.meta.output_txn_count.toLocaleString()} big
                    sub={preview.meta.is_truncated ? `of ${preview.meta.input_txn_count.toLocaleString()} in range` : 'All in range'} />
                  <Cell label="Coverage" sub={preview.meta.is_truncated ? 'Record limit reached' : 'Every transaction included'}
                    value={<span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', preview.meta.is_truncated ? 'bg-amber-500' : 'bg-emerald-500')} />{preview.meta.is_truncated ? 'Partial' : 'Complete'}</span>} />
                </Strip>
                {preview.meta.is_truncated && (
                  <Notice tone="warning" icon={ListEnd} title="Statement shortened"
                    actions={<Button variant="tactileLight" className="h-8 px-3" onClick={() => continueAfter(preview.meta.effective_period.to)}>
                      Continue from {showDate(dayAfter(preview.meta.effective_period.to))}<ArrowRight className="size-3.5" /></Button>}>
                    <span className="font-medium text-zinc-900 tabular-nums">{preview.meta.output_txn_count.toLocaleString()}</span> of {preview.meta.input_txn_count.toLocaleString()} transactions fit in one statement, so it ends on {showDate(preview.meta.effective_period.to)}. The next statement picks up from there.
                  </Notice>
                )}
                {(problem?.kind === 'pdf' || problem?.kind === 'csv') && !busy && <ProblemNotice problem={problem} />}
                <PdfPreview pdf={preview.pdf} />
              </div>
            )}
          </Section>
        )}
        <div ref={bottom} />
        <TestAccounts onTry={value => { window.scrollTo({ top: 0, behavior: 'smooth' }); find(null, value); }} />
      </main>
    </div>
  );
}

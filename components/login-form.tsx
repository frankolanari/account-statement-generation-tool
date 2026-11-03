'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, CircleAlert, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Logo, Panel } from '@/components/statement/ui';

/* "Built by" card: edit these three values. The photo lives in public/. */
const BUILT_BY = { name: 'Azi', photo: '/azi.png', linkedin: 'https://www.linkedin.com/in/azifrank' };

export function LoginForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode }) });
      if (res.ok) { router.replace('/'); router.refresh(); return; }
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Sign-in failed.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="rise w-full max-w-sm">
      <div className="mb-6 flex items-center gap-2.5"><Logo className="size-8" /><span className="font-semibold tracking-tight">Statements</span></div>
      <Panel className="p-6">
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">Enter the passcode you were given.</p>
        <form onSubmit={submit} className="mt-5 grid gap-3">
          <Field icon={LockKeyhole} id="passcode" type="password" autoComplete="current-password" autoFocus required aria-label="Passcode"
            placeholder="Passcode" value={passcode} onChange={e => setPasscode(e.target.value)} aria-invalid={!!error} />
          {error && <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600"><CircleAlert className="size-3.5" />{error}</p>}
          <Button type="submit" className="h-10 px-4" disabled={busy || !passcode}>{busy ? 'Checking…' : 'Continue'}</Button>
        </form>
      </Panel>
      <BuiltBy />
    </div>
  );
}

/* LinkedIn's "in" mark, in its brand blue */
const LinkedInLogo = () => (
  <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
    <rect width="24" height="24" rx="4" fill="#0A66C2" />
    <path fill="#fff" d="M7.12 9.48H4.56V19.5h2.56V9.48zM5.84 4.5a1.48 1.48 0 1 0 0 2.96 1.48 1.48 0 0 0 0-2.96zM19.5 13.6c0-2.7-.58-4.32-3.73-4.32-1.52 0-2.53.83-2.95 1.62h-.04V9.48h-2.45V19.5h2.55v-4.96c0-1.31.25-2.57 1.87-2.57 1.6 0 1.62 1.49 1.62 2.65v4.88h2.56l.02-5.9z" />
  </svg>
);

function BuiltBy() {
  const [photoOk, setPhotoOk] = useState(true);
  return (
    <a href={BUILT_BY.linkedin} target="_blank" rel="noopener noreferrer"
      className="group mt-8 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50">
      {photoOk
        // eslint-disable-next-line @next/next/no-img-element -- tiny static avatar; next/image adds nothing here
        ? <img src={BUILT_BY.photo} alt={BUILT_BY.name} onError={() => setPhotoOk(false)} className="size-10 rounded-full border border-zinc-200 object-cover" />
        : <div className="flex size-10 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-sm font-medium text-zinc-700">{BUILT_BY.name.slice(0, 2).toUpperCase()}</div>}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Built by</p>
        <p className="mt-0.5 font-medium">{BUILT_BY.name}</p>
      </div>
      <span className="flex items-center gap-1.5 text-sm text-zinc-600 group-hover:text-zinc-900">
        <LinkedInLogo />LinkedIn<ArrowUpRight className="size-3.5 text-zinc-400 group-hover:text-zinc-700" />
      </span>
    </a>
  );
}

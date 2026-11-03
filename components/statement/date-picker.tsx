'use client';

import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showDate, toDate, toIso } from '@/lib/statement-ui';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// react-day-picker is the engine behind shadcn's Calendar; these class names give it the tool's neutral look.
const navButton = 'absolute top-0 z-10 inline-flex size-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40';
const CALENDAR = {
  root: 'relative', months: 'flex flex-col gap-6 sm:flex-row', month: 'flex flex-col gap-3',
  nav: '', button_previous: cn(navButton, 'left-0'), button_next: cn(navButton, 'right-0'), chevron: 'size-4 fill-current',
  month_caption: 'flex h-8 items-center justify-center', dropdowns: 'flex items-center gap-1.5',
  dropdown_root: 'relative inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium hover:bg-zinc-50',
  dropdown: 'absolute inset-0 cursor-pointer opacity-0', caption_label: 'flex items-center gap-1 text-sm font-medium [&>svg]:size-3.5 [&>svg]:fill-zinc-500',
  month_grid: 'border-collapse', weekdays: 'flex', weekday: 'w-9 text-center text-xs font-normal text-zinc-400', week: 'mt-1 flex',
  day: 'relative size-9 p-0 text-center text-sm',
  day_button: 'size-9 rounded-md transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
  selected: '[&>button]:bg-zinc-900 [&>button]:text-white [&>button]:hover:bg-zinc-800',
  today: '[&>button]:font-semibold [&>button]:text-zinc-900 [&>button]:underline [&>button]:underline-offset-4',
  outside: 'text-zinc-300', disabled: 'text-zinc-300 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent', hidden: 'invisible',
};

// One date, one popover. Picking a day applies it and closes.
export function DatePicker({ label, value, min, max, onChange }:
  { label: string; value: string; min: string; max: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] text-zinc-500">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${label}: ${showDate(value)}`}
            className={cn('flex h-10 w-full items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm transition hover:bg-zinc-50',
              open ? 'border-zinc-400 ring-4 ring-zinc-100' : 'border-zinc-200')}>
            <CalendarIcon className="size-4 text-zinc-500" />
            <span className="flex-1 font-medium">{showDate(value)}</span>
            <ChevronDown className={cn('size-4 text-zinc-400 transition-transform', open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-auto rounded-xl border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-900/10">
          <DayPicker mode="single" required captionLayout="dropdown" classNames={CALENDAR}
            selected={toDate(value)} defaultMonth={toDate(value)} startMonth={toDate(min)} endMonth={toDate(max)}
            disabled={[{ before: toDate(min) }, { after: toDate(max) }]}
            onSelect={day => { if (day) { onChange(toIso(day)); setOpen(false); } }} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

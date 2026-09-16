/**
 * Spotlight tour: dims the page, cuts a hole around the current step's target
 * and shows a card next to it. Keyboard: → / Enter next, ← back, Esc close.
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../lib/focus-trap';
import type { TourStep } from '../lib/tour';
import { Button } from './ui';

const PAD = 6;
const CARD_W = 320;
const GAP = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** First visible element among the step's targets, or null for a centered step. */
function findTarget(step: TourStep): HTMLElement | null {
  for (const key of step.target ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) {
      if (el.getClientRects().length && el.offsetParent !== null) return el;
    }
  }
  return null;
}

export function Tour({
  steps,
  onClose,
  labels,
}: {
  steps: TourStep[];
  onClose: () => void;
  labels: TourLabels;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useFocusTrap(card);
  const step = steps[index] ?? steps[0] ?? { title: '', body: '' };
  const last = index === steps.length - 1;

  const measure = useCallback(() => {
    const el = findTarget(step);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
  }, [step]);

  useLayoutEffect(() => {
    findTarget(step)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    // re-measure once layout settles (fonts, transitions) and on viewport changes
    const t = setTimeout(measure, 150);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, step]);

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, onClose]);

  // Card placement: below the target, else above, else beside it, else inside it
  // (tall targets such as a whole column); always clamped to the viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 24);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const centeredLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);
    const below = rect.top + rect.height + GAP;
    const right = rect.left + rect.width + GAP;
    if (vh - below > 220) cardStyle = { top: below, left: centeredLeft, width: cardW };
    else if (rect.top > 220) cardStyle = { bottom: vh - rect.top + GAP, left: centeredLeft, width: cardW };
    else if (vw - right > cardW + 12)
      cardStyle = { top: Math.max(12, rect.top + 12), left: right, width: cardW };
    else if (rect.left > cardW + 24)
      cardStyle = { top: Math.max(12, rect.top + 12), left: rect.left - GAP - cardW, width: cardW };
    else cardStyle = { top: rect.top + 48, left: centeredLeft, width: cardW };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: cardW };
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* dim everything; the spotlight's huge box-shadow paints the darkness so the hole stays clear */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-accent-400 transition-all duration-200"
          style={{ ...rect, boxShadow: '0 0 0 200vmax rgba(24,24,27,.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-900/55" />
      )}
      <div
        ref={card}
        className="absolute rounded-xl border border-zinc-200 bg-white p-4 text-zinc-800 shadow-2xl dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        style={cardStyle}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="font-semibold text-sm">{step.title}</h3>
          <button
            type="button"
            aria-label={labels.close}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[11px] text-zinc-400">
            {index + 1} / {steps.length}
          </span>
          {index > 0 ? (
            <Button size="xs" variant="ghost" icon={<ChevronLeft size={12} />} onClick={back}>
              {labels.back}
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={onClose}>
              {labels.skip}
            </Button>
          )}
          <Button size="xs" variant="primary" onClick={next}>
            {last ? labels.done : labels.next}
            {last ? null : <ChevronRight size={12} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface TourLabels {
  next: string;
  back: string;
  skip: string;
  done: string;
  close: string;
}

export const TOUR_LABELS: Record<'en' | 'vi', TourLabels> = {
  en: { next: 'Next', back: 'Back', skip: 'Skip', done: 'Done', close: 'Close the tour' },
  vi: { next: 'Tiếp', back: 'Lùi', skip: 'Bỏ qua', done: 'Xong', close: 'Đóng hướng dẫn' },
};

const SPEAKER_COLORS = [
  'bg-[hsl(var(--chart-1))]',
  'bg-[hsl(var(--chart-2))]',
  'bg-[hsl(var(--chart-3))]',
  'bg-[hsl(var(--chart-4))]',
  'bg-[hsl(var(--chart-5))]',
];

export function SpeakerIdentity({ id }: { id: string }) {
  const match = /^speaker_(\d+)$/.exec(id);
  const color = match ? SPEAKER_COLORS[Number(match[1]) % SPEAKER_COLORS.length] : null;
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${color
    ?? 'border border-dashed border-muted-foreground bg-transparent'}`} />;
}

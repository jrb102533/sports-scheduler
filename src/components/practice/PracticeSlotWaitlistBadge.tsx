interface Props {
  position: number;
}

export function PracticeSlotWaitlistBadge({ position }: Props) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      Waitlist #{position}
    </span>
  );
}

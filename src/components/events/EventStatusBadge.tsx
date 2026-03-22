import { Badge } from '@/components/ui/Badge';
import { EVENT_STATUS_COLORS, EVENT_STATUS_LABELS } from '@/constants';
import type { EventStatus } from '@/types';

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge className={EVENT_STATUS_COLORS[status]}>
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  );
}

import { useState, useRef, useCallback } from 'react';
import ExcelJS from 'exceljs';
import { parseISO, format, parse, isValid } from 'date-fns';
import { Upload, Download, CheckCircle, XCircle, FileSpreadsheet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { todayISO } from '@/lib/dateUtils';
import type { ScheduledEvent, EventType } from '@/types';

interface ImportEventsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedRow {
  valid: boolean;
  title: string;
  type: EventType;
  date: string;
  startTime: string;
  endTime?: string;
  location?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  notes?: string;
  _rawDate: string;
  _rawTitle: string;
}

const VALID_EVENT_TYPES: EventType[] = ['game', 'match', 'practice', 'tournament', 'other'];

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, ' ');
}

function mapColumnKey(header: string): string | null {
  const h = normalizeHeader(header);
  if (['title', 'event', 'name', 'event name'].includes(h)) return 'title';
  if (h === 'type') return 'type';
  if (h === 'date') return 'date';
  if (['start time', 'starttime', 'time'].includes(h)) return 'startTime';
  if (['end time', 'endtime'].includes(h)) return 'endTime';
  if (['location', 'venue', 'field'].includes(h)) return 'location';
  if (['home team', 'hometeam'].includes(h)) return 'homeTeam';
  if (['away team', 'awayteam'].includes(h)) return 'awayTeam';
  if (['notes', 'note', 'description'].includes(h)) return 'notes';
  return null;
}

function parseDate(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try ISO format first
  try {
    const d = parseISO(trimmed);
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  } catch { /* continue */ }

  // Try common formats
  const formats = ['MM/dd/yyyy', 'M/d/yyyy', 'MM-dd-yyyy', 'M-d-yyyy', 'yyyy-MM-dd', 'MM/dd/yy', 'M/d/yy'];
  for (const fmt of formats) {
    try {
      const d = parse(trimmed, fmt, new Date());
      if (isValid(d)) return format(d, 'yyyy-MM-dd');
    } catch { /* continue */ }
  }

  return null;
}

function parseTime(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try HH:mm or H:mm (24-hour)
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1]);
    const m = parseInt(match24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // Try h:mm a or h:mma (12-hour)
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = parseInt(match12[2]);
    const period = match12[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Try h:mma without space
  const match12b = trimmed.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (match12b) {
    let h = parseInt(match12b[1]);
    const m = parseInt(match12b[2]);
    const period = match12b[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

function parseEventType(raw: string): EventType {
  const lower = (raw ?? '').toLowerCase().trim();
  if ((VALID_EVENT_TYPES as string[]).includes(lower)) return lower as EventType;
  return 'game';
}

async function parseFile(file: File): Promise<Record<string, string>[]> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

  const workbook = new ExcelJS.Workbook();
  // exceljs declares `interface Buffer extends ArrayBuffer` — cast through unknown
  // to satisfy the parameter type without requiring @types/node in the browser build.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];

  const rows: Record<string, string>[] = [];
  const headers: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      // Collect header names from the first row (1-based values array)
      (row.values as ExcelJS.CellValue[]).forEach((cell, idx) => {
        if (idx === 0) return; // exceljs row.values[0] is always undefined
        headers[idx] = cell != null ? String(cell) : '';
      });
      return;
    }

    const mapped: Record<string, string> = {};
    (row.values as ExcelJS.CellValue[]).forEach((cell, idx) => {
      if (idx === 0) return;
      const header = headers[idx];
      if (!header) return;
      mapped[header] = cell != null ? String(cell) : '';
    });
    rows.push(mapped);
  });

  return rows;
}

const TEMPLATE_HEADERS = ['Title', 'Type', 'Date', 'Start Time', 'End Time', 'Location', 'Home Team', 'Away Team', 'Notes'];
const TEMPLATE_EXAMPLE = ['Championship Game', 'game', '06/15/2026', '10:00 AM', '12:00 PM', 'City Park Field 1', 'Red Hawks', 'Blue Jays', 'Playoff game'];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE];
  const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  const uri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  const link = document.createElement('a');
  link.href = uri;
  link.download = 'events-template.csv';
  link.click();
}

export function ImportEventsModal({ open, onClose }: ImportEventsModalProps) {
  const { bulkAddEvents } = useEventStore();
  const teams = useTeamStore(s => s.teams);

  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function processRows(rawRows: Record<string, string>[]) {
    if (rawRows.length === 0) {
      setParseError('No data rows found in the file.');
      return;
    }

    const firstRow = rawRows[0];
    const headers = Object.keys(firstRow);

    // Build column map: header -> field key
    const columnMap: Record<string, string> = {};
    for (const header of headers) {
      const key = mapColumnKey(header);
      if (key) columnMap[header] = key;
    }

    const valid: ParsedRow[] = [];
    let skipped = 0;

    for (const raw of rawRows) {
      const mapped: Record<string, string> = {};
      for (const [header, fieldKey] of Object.entries(columnMap)) {
        mapped[fieldKey] = String(raw[header] ?? '').trim();
      }

      const rawTitle = mapped['title'] ?? '';
      const rawDate = mapped['date'] ?? '';

      const parsedDate = parseDate(rawDate);
      const parsedTime = parseTime(mapped['startTime'] ?? '') ?? '09:00';

      if (!rawTitle || !parsedDate) {
        skipped++;
        continue;
      }

      const homeTeamName = (mapped['homeTeam'] ?? '').toLowerCase();
      const awayTeamName = (mapped['awayTeam'] ?? '').toLowerCase();
      const homeTeam = teams.find(t => t.name.toLowerCase() === homeTeamName);
      const awayTeam = teams.find(t => t.name.toLowerCase() === awayTeamName);

      const parsedEndTime = mapped['endTime'] ? parseTime(mapped['endTime']) ?? undefined : undefined;

      valid.push({
        valid: true,
        title: rawTitle,
        type: parseEventType(mapped['type'] ?? ''),
        date: parsedDate,
        startTime: parsedTime,
        ...(parsedEndTime ? { endTime: parsedEndTime } : {}),
        ...(mapped['location'] ? { location: mapped['location'] } : {}),
        ...(homeTeam ? { homeTeamId: homeTeam.id } : {}),
        ...(awayTeam ? { awayTeamId: awayTeam.id } : {}),
        ...(mapped['notes'] ? { notes: mapped['notes'] } : {}),
        _rawDate: rawDate,
        _rawTitle: rawTitle,
      });
    }

    setParsedRows(valid);
    setSkippedCount(skipped);
    setStep('preview');
  }

  async function handleFile(file: File) {
    setParseError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      setParseError('Please upload a .xlsx, .xls, or .csv file.');
      return;
    }
    try {
      const rows = await parseFile(file);
      processRows(rows);
    } catch {
      setParseError('Failed to parse the file. Please check the format and try again.');
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  async function handleImport() {
    setImporting(true);
    const now = new Date().toISOString();
    const events: ScheduledEvent[] = parsedRows.map(row => {
      const teamIds = [...new Set([row.homeTeamId, row.awayTeamId].filter(Boolean) as string[])];
      return {
        id: crypto.randomUUID(),
        title: row.title,
        type: row.type,
        status: 'scheduled' as const,
        date: row.date,
        startTime: row.startTime,
        teamIds,
        isRecurring: false,
        createdAt: now,
        updatedAt: now,
        ...(row.endTime ? { endTime: row.endTime } : {}),
        ...(row.location ? { location: row.location } : {}),
        ...(row.homeTeamId ? { homeTeamId: row.homeTeamId } : {}),
        ...(row.awayTeamId ? { awayTeamId: row.awayTeamId } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      };
    });
    await bulkAddEvents(events);
    setImporting(false);
    handleClose();
  }

  function handleClose() {
    onClose();
    setTimeout(() => {
      setStep('upload');
      setParsedRows([]);
      setSkippedCount(0);
      setParseError(null);
    }, 300);
  }

  function formatPreviewDate(iso: string) {
    try { return format(parseISO(iso), 'MMM d, yyyy'); } catch { return iso; }
  }

  const today = todayISO();

  return (
    <Modal open={open} onClose={handleClose} title="Import Events" size="lg">
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Upload a spreadsheet (.xlsx, .xls, or .csv) with your event schedule.
          </p>

          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            <Download size={14} /> Download Template
          </button>

          <div
            className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer ${
              isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileSpreadsheet size={36} className="text-gray-400" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">Drop your file here, or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {parseError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{parseError}</p>
          )}

          <div className="text-xs text-gray-400 space-y-1">
            <p className="font-medium text-gray-500">Expected columns (case-insensitive):</p>
            <p>Title, Type, Date, Start Time, End Time, Location, Home Team, Away Team, Notes</p>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{parsedRows.length}</span> events ready to import
              {skippedCount > 0 && (
                <span className="ml-2 text-amber-600">({skippedCount} row{skippedCount !== 1 ? 's' : ''} skipped — missing title or date)</span>
              )}
            </div>
            <button
              type="button"
              className="text-sm text-blue-600 hover:underline"
              onClick={() => { setStep('upload'); setParsedRows([]); setSkippedCount(0); }}
            >
              Upload different file
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 w-6"></th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Title</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Time</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Location</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Teams</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parsedRows.map((row, i) => {
                    const isPast = row.date < today;
                    const homeTeam = teams.find(t => t.id === row.homeTeamId);
                    const awayTeam = teams.find(t => t.id === row.awayTeamId);
                    return (
                      <tr key={i} className={isPast ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-1.5">
                          <CheckCircle size={13} className="text-green-500" />
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{formatPreviewDate(row.date)}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-900 max-w-[140px] truncate">{row.title}</td>
                        <td className="px-3 py-1.5 text-gray-600 capitalize">{row.type}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                          {row.startTime}{row.endTime ? ` – ${row.endTime}` : ''}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 max-w-[100px] truncate">{row.location ?? '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">
                          {homeTeam || awayTeam
                            ? [homeTeam?.name, awayTeam?.name].filter(Boolean).join(' vs ')
                            : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 max-w-[100px] truncate">{row.notes ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {parsedRows.some(r => r.date < today) && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5 flex items-start gap-1.5">
              <XCircle size={13} className="mt-0.5 shrink-0" />
              Some events have past dates (highlighted in amber) — they will still be imported.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleImport} disabled={parsedRows.length === 0 || importing}>
              <Upload size={14} />
              {importing ? 'Importing…' : `Import ${parsedRows.length} Event${parsedRows.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

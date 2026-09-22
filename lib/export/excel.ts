import { Candidate } from '@/types/index';
import * as ExcelJS from 'exceljs';
import { MATCH_STRENGTH_RANGES } from '@/config/scoring';

const NAVY = 'FF0B1F3A';
const TEAL = 'FF00B4A6';
const BAND = 'FFF6F6FB';

type Column = { header: string; key: string; width: number };

const SHORTLIST_COLUMNS: Column[] = [
  { header: 'Candidate Name', key: 'name', width: 26 },
  { header: 'Current Designation', key: 'designation', width: 38 },
  { header: 'Current Organization', key: 'organization', width: 30 },
  { header: 'LinkedIn Profile URL', key: 'url', width: 46 },
  { header: 'Relevance Tier', key: 'tier', width: 22 },
  { header: 'Why kept', key: 'why', width: 44 },
];

const REMOVED_COLUMNS: Column[] = [
  ...SHORTLIST_COLUMNS.slice(0, 4),
  { header: 'Why removed', key: 'why', width: 52 },
];

type MatchBand = keyof typeof MATCH_STRENGTH_RANGES;

function bandLabel(band: MatchBand): string {
  const range = MATCH_STRENGTH_RANGES[band];
  const name = band.charAt(0).toUpperCase() + band.slice(1);
  return `${name} (${range.min}-${range.max})`;
}

function styleHeader(sheet: ExcelJS.Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.height = 22;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  header.alignment = { vertical: 'middle', horizontal: 'left' };

  // Freeze the header and add filter dropdowns so long lists stay navigable.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnCount },
  };
}

function writeRows(
  sheet: ExcelJS.Worksheet,
  candidates: Candidate[],
  includeTier: boolean
): void {
  candidates.forEach((candidate, index) => {
    const url = candidate.linkedinUrl?.trim();

    const row = sheet.addRow({
      name: candidate.name || 'Unknown',
      designation: candidate.currentDesignation || '-',
      organization: candidate.currentOrganization || '-',
      // A hyperlink value keeps the URL readable and clickable.
      url: url ? { text: url, hyperlink: url, tooltip: 'Open LinkedIn profile' } : '-',
      ...(includeTier ? { tier: candidate.relevanceLabel || '-' } : {}),
      why: candidate.relevanceReason || '-',
    });

    row.alignment = { vertical: 'top', wrapText: false };

    // Banding makes wide rows easier to track across columns.
    if (index % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    }

    const urlCell = row.getCell('url');
    if (urlCell.type === ExcelJS.ValueType.Hyperlink) {
      urlCell.font = { color: { argb: TEAL }, underline: 'single' };
    }
  });
}

export async function generateExcelFile(
  candidates: Candidate[],
  roleName: string,
  removed: Candidate[] = []
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AlphaSourcer';
  workbook.created = new Date();

  // --- Shortlist ---
  const shortlist = workbook.addWorksheet('Shortlist');
  shortlist.columns = SHORTLIST_COLUMNS;
  writeRows(shortlist, candidates, true);
  styleHeader(shortlist, SHORTLIST_COLUMNS.length);

  // --- Removed ---
  const removedSheet = workbook.addWorksheet('Removed');
  removedSheet.columns = REMOVED_COLUMNS;
  writeRows(removedSheet, removed, false);
  styleHeader(removedSheet, REMOVED_COLUMNS.length);

  // --- Summary ---
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 34 },
  ];

  const countTier = (tier: string) => candidates.filter((c) => c.relevanceTier === tier).length;
  const countStrength = (s: string) => candidates.filter((c) => c.matchStrength === s).length;

  summary.addRows([
    { metric: 'Role searched', value: roleName },
    { metric: 'Search date', value: new Date().toLocaleDateString() },
    { metric: '', value: '' },
    { metric: 'Shortlisted candidates', value: candidates.length },
    { metric: 'Removed as irrelevant', value: removed.length },
    { metric: '', value: '' },
    { metric: 'Core matches', value: countTier('core') },
    { metric: 'Adjacent matches', value: countTier('adjacent') },
    { metric: 'Skill-based matches', value: countTier('skill') },
    { metric: '', value: '' },
    // Labelled from the same config the scorer bands against, so the sheet
    // cannot quietly state a range the product no longer uses.
    { metric: bandLabel('excellent'), value: countStrength('excellent') },
    { metric: bandLabel('strong'), value: countStrength('strong') },
    { metric: bandLabel('potential'), value: countStrength('potential') },
    { metric: bandLabel('low'), value: countStrength('low') },
  ]);

  styleHeader(summary, 2);
  summary.autoFilter = undefined as never; // a filter makes no sense on a summary
  summary.getColumn('metric').font = { bold: false };
  summary.getRow(4).font = { bold: true };
  summary.getRow(5).font = { bold: true };

  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

export function getExcelFileName(roleName: string): string {
  const date = new Date().toISOString().split('T')[0];
  const cleanRole = roleName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  return `AlphaSourcer_${cleanRole}_${date}.xlsx`;
}

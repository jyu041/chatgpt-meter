export interface PageInfo {
  hasPreviousPage: boolean;
  startCursor: string | null;
}

export function parsePageInfo(value: unknown): PageInfo | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  if (typeof page.has_previous_page !== 'boolean') return null;
  return {
    hasPreviousPage: page.has_previous_page,
    startCursor: typeof page.start_cursor === 'string' && page.start_cursor ? page.start_cursor : null,
  };
}

export function nextPageCursor(
  page: PageInfo,
  seenCursors: Set<string>,
  pagesLoaded: number,
  maxPages: number,
): string | null {
  if (!page.hasPreviousPage || !page.startCursor || seenCursors.has(page.startCursor) || pagesLoaded >= maxPages) return null;
  seenCursors.add(page.startCursor);
  return page.startCursor;
}

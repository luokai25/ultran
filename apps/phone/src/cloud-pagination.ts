/** Fetch every row from a paginated API without silently truncating at its page cap. */
export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => Promise<readonly T[]>,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("Page size must be a positive safe integer.");
  }

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1);
    if (page.length > pageSize) {
      throw new Error("Paged data source returned more rows than requested.");
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

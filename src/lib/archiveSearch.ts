export interface ArchiveSearchCandidate {
  id?: string
  title?: string
  summary?: string
  sourceUrl?: string
  platform?: string
  market?: string
  category?: string
}

export function matchesArchiveQuery(
  candidate: ArchiveSearchCandidate,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return true

  return Object.values(candidate)
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLocaleLowerCase().includes(query))
}

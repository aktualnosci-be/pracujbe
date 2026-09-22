export interface JobFilterFacets {
  total: number;
  categories: Record<string, number>;
  locations: Array<{ city: string; count: number }>;
  contracts: Record<string, number>;
  accommodation: { provided: number; unavailable: number };
  immediate: number;
  noLanguage: number;
}

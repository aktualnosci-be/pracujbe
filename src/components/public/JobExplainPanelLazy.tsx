'use client';

import dynamic from 'next/dynamic';

/**
 * `JobExplainPanel` jako osobny chunk (#773, budżet JS szczegółu oferty #395). Panel renderuje
 * się tylko przy włączonej fladze `AI_JOB_EXPLAIN_ENABLED` — bez niej przeglądarka nie pobiera
 * jego kodu. Z SSR (bez przesunięcia układu po hydratacji).
 */
export const JobExplainPanelLazy = dynamic(() =>
  import('@/components/public/JobExplainPanel').then((m) => m.JobExplainPanel),
);

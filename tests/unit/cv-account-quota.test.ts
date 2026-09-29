import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CV_MAX_FILES_PER_ACCOUNT, CV_MAX_TOTAL_BYTES_PER_ACCOUNT } from '@/lib/validation/cv-file';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0966_soft_delete_contract_cv_quota.sql'), 'utf8');

describe('limit CV na konto (CF-06, 0966)', () => {
  it('stałe TS są lustrem triggera w migracji', () => {
    expect(sql).toContain(`v_count >= ${CV_MAX_FILES_PER_ACCOUNT}`);
    expect(sql).toContain(`> ${CV_MAX_TOTAL_BYTES_PER_ACCOUNT / (1024 * 1024)} * 1024 * 1024`);
  });
  it('kontrola ujemna: inna wartość limitu nie pasuje do migracji', () => {
    expect(sql).not.toContain(`v_count >= ${CV_MAX_FILES_PER_ACCOUNT + 1}`);
  });
});

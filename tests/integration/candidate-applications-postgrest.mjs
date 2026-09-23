#!/usr/bin/env node
// Run explicitly with Node and Docker; this test is deliberately not part of shared CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const runId = `pb187-${randomUUID().slice(0, 12)}`;
const network = `${runId}-net`;
const postgres = `${runId}-pg`;
const postgrest = `${runId}-rest`;
const marker = `pb187-test=${runId}`;
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const jwtSecret = 'test-only-secret-long-enough-123456789';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function dockerWithInput(input, ...args) {
  return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function labelOf(kind, name) {
  try {
    return docker(kind, 'inspect', '-f', '{{index .Labels "pb187-test"}}', name);
  } catch {
    return null;
  }
}

function cleanup() {
  for (const name of [postgrest, postgres]) {
    try {
      const label = docker('inspect', '-f', '{{index .Config.Labels "pb187-test"}}', name);
      if (label === runId) docker('rm', '-f', name);
    } catch {
      // Nothing to remove if creation never completed.
    }
  }
  try {
    if (labelOf('network', network) === runId) docker('network', 'rm', network);
  } catch {
    // Keep the original assertion/error visible; a labeled resource can be inspected manually.
  }
}

function jwt(sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ role: 'app_user', sub, exp: 2_000_000_000 });
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (await predicate()) return;
    } catch {
      // Service is still starting.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function queryPage(client, cursor = null) {
  let query = client
    .from('applications')
    .select('id, submitted_at')
    .eq('candidate_id', ownerId)
    .is('deleted_at', null)
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false });
  if (cursor) {
    const timestamp = `"${cursor.submittedAt}"`;
    query = query.or(`submitted_at.lt.${timestamp},and(submitted_at.eq.${timestamp},id.lt.${cursor.id})`);
  }
  return query.limit(11);
}

try {
  docker('network', 'create', '--label', marker, network);
  docker('run', '-d', '--name', postgres, '--label', marker, '--network', network,
    '-e', 'POSTGRES_PASSWORD=testonly', '-e', 'POSTGRES_DB=cursor_test', 'postgres:16');
  await waitFor(() => {
    docker('exec', postgres, 'psql', '-U', 'postgres', '-d', 'cursor_test', '-Atqc', 'SELECT 1');
    return true;
  }, 'isolated PostgreSQL');

  const sql = `
CREATE ROLE app_user LOGIN PASSWORD 'app-test';
CREATE TABLE public.applications(
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  deleted_at timestamptz
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON public.applications TO app_user;
CREATE POLICY own_applications ON public.applications TO app_user
  USING (candidate_id = (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid);
INSERT INTO public.applications
SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(i::text, 12, '0'))::uuid,
       '${ownerId}'::uuid,
       '2026-09-20T09:00:00Z'::timestamptz - ((i - 1) / 5) * interval '1 day',
       NULL
FROM generate_series(1, 15) AS i;
INSERT INTO public.applications VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001', '${otherId}', '2026-09-22T09:00:00Z', NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002', '${ownerId}', '2026-09-23T09:00:00Z', now());
`;
  dockerWithInput(sql, 'exec', '-i', postgres, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'cursor_test');
  docker('run', '-d', '--name', postgrest, '--label', marker, '--network', network,
    '-e', `PGRST_DB_URI=postgres://app_user:app-test@${postgres}:5432/cursor_test`,
    '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=app_user',
    '-e', `PGRST_JWT_SECRET=${jwtSecret}`,
    'public.ecr.aws/supabase/postgrest:v16.1');
  const ip = docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', postgrest);
  const baseUrl = `http://${ip}:3000`;
  await waitFor(async () => (await fetch(baseUrl)).ok, 'isolated PostgREST');

  const requested = [];
  const client = createClient(baseUrl, jwt(ownerId), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Supabase-js targets /rest/v1; standalone PostgREST serves that same API at /.
      fetch: (input, init) => {
        const url = new URL(input);
        requested.push(url.toString());
        assert.ok(url.pathname.startsWith('/rest/v1/'));
        url.pathname = url.pathname.slice('/rest/v1'.length);
        return fetch(url, init);
      },
    },
  });

  const first = await queryPage(client);
  assert.equal(first.error, null, first.error?.message);
  assert.equal(first.data?.length, 11);
  const visibleFirst = first.data.slice(0, 10);
  const boundary = visibleFirst.at(-1);
  assert.ok(boundary);
  const second = await queryPage(client, { submittedAt: boundary.submitted_at, id: boundary.id });
  assert.equal(second.error, null, second.error?.message);
  assert.equal(second.data?.length, 5);
  const ids = [...visibleFirst, ...second.data].map((row) => row.id);
  assert.equal(new Set(ids).size, 15);
  assert.deepEqual(ids.slice(0, 5).map((id) => id.slice(-3)), ['005', '004', '003', '002', '001']);
  assert.deepEqual(ids.slice(-5).map((id) => id.slice(-3)), ['015', '014', '013', '012', '011']);
  assert.ok(requested[1].includes('%2B00%3A00'), requested[1]);
  assert.ok(!requested[1].includes('+00'), requested[1]);
  console.log('PASS: Supabase-js encoded cursor (+ as %2B), 15 own rows traversed 10+5 without duplicates');

  const other = await client.from('applications').select('id').eq('candidate_id', otherId);
  assert.equal(other.error, null, other.error?.message);
  assert.deepEqual(other.data, []);
  const allVisible = await client.from('applications').select('id');
  assert.equal(allVisible.error, null, allVisible.error?.message);
  assert.equal(allVisible.data?.length, 16); // Includes the soft-deleted own row without the query's filter.
  console.log('PASS: non-owner app role cannot read another candidate even without the client filter');
} finally {
  cleanup();
  assert.equal(labelOf('network', network), null, 'isolated Docker network must be gone');
  for (const name of [postgrest, postgres]) {
    assert.throws(() => docker('inspect', name), /no such object|no such container/i);
  }
  console.log('PASS: only exact-labeled isolated Docker resources removed');
}

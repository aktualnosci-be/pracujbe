'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toUserMessageKey } from '@/lib/errors';
import { setTeamMemberActive, setTeamMemberRole } from '@/lib/actions/team';
import { teamErrorKey, type TeamError } from '@/lib/team/errors';
import { assignableRoles, canManageRole } from '@/lib/team/permissions';
import { roleLabelKey } from './role-keys';

/**
 * Lista członków zespołu (#403): rola, status dostępu, zmiana roli i odebranie/przywrócenie
 * dostępu — tylko tam, gdzie pozwala hierarchia ról (lustro bazy; baza i tak egzekwuje).
 * Własny wiersz i osoby wyżej w hierarchii mają opis zamiast kontrolek.
 *
 * Invariant #11: jedna operacja naraz (blokada przycisków), komunikat sukcesu `role="status"`,
 * błąd `role="alert"`; odebranie dostępu wymaga potwierdzenia.
 */

export interface TeamMemberView {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isSelf: boolean;
  sinceLabel: string;
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

const controlClass =
  'min-h-12 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto';

export function TeamMembers({
  members,
  actorRole,
}: {
  members: TeamMemberView[];
  actorRole: string;
}): React.JSX.Element {
  const t = useTranslations('team');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [roles, setRoles] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => [m.id, m.role])),
  );
  const [confirm, setConfirm] = React.useState<TeamMemberView | null>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);

  React.useEffect(() => {
    setRoles(Object.fromEntries(members.map((m) => [m.id, m.role])));
  }, [members]);

  const errorText = (error: TeamError) => tRoot(teamErrorKey(error, toUserMessageKey));

  async function run(
    memberId: string,
    call: () => Promise<{ ok: true; demo?: boolean } | { ok: false; error: TeamError }>,
    success: string,
  ): Promise<void> {
    setPendingId(memberId);
    setFeedback(null);
    try {
      const result = await call();
      if (!result.ok) setFeedback({ kind: 'error', text: errorText(result.error) });
      else {
        setFeedback({ kind: 'ok', text: result.demo ? t('demoNotice') : success });
        router.refresh();
      }
    } catch {
      setFeedback({ kind: 'error', text: errorText('INTERNAL') });
    } finally {
      setPendingId(null);
    }
  }

  const displayName = (m: TeamMemberView) => m.name || m.email || t('unnamed');
  const options = assignableRoles(actorRole);

  return (
    <div className="space-y-4">
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className={feedback?.kind === 'ok' ? 'rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground' : 'sr-only'}>
        {feedback?.kind === 'ok' ? feedback.text : ''}
      </p>
      {feedback?.kind === 'error' ? (
        <p role="alert" className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text">
          {feedback.text}
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-2xl border border-border" aria-label={t('membersTitle')}>
        {members.map((m) => {
          const name = displayName(m);
          const manageable = !m.isSelf && canManageRole(actorRole, m.role);
          const busy = pendingId !== null;
          const selectId = `team-role-${m.id}`;
          return (
            <li key={m.id} className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="break-words font-semibold text-foreground">
                  {name}
                  {m.isSelf ? (
                    <span className="ml-2 rounded-full bg-soft px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('you')}
                    </span>
                  ) : null}
                </p>
                {m.email && m.email !== name ? (
                  <p className="break-all text-sm text-muted-foreground">{m.email}</p>
                ) : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{t(roleLabelKey(m.role))}</span>
                  {' · '}
                  <span className={m.isActive ? 'text-success-text' : 'text-error-text'}>
                    {m.isActive ? t('statusActive') : t('statusInactive')}
                  </span>
                  {m.sinceLabel ? ` · ${m.sinceLabel}` : ''}
                </p>
              </div>

              {manageable ? (
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  {m.isActive ? (
                    <>
                      <label htmlFor={selectId} className="sr-only">
                        {t('roleSelectLabel', { name })}
                      </label>
                      <select
                        id={selectId}
                        value={roles[m.id] ?? m.role}
                        disabled={busy}
                        onChange={(e) => setRoles((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        className={controlClass}
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {t(roleLabelKey(r))}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12"
                        disabled={busy || (roles[m.id] ?? m.role) === m.role}
                        aria-label={t('saveRoleLabel', { name })}
                        onClick={() =>
                          void run(m.id, () => setTeamMemberRole(m.id, roles[m.id] ?? m.role), t('roleSaved'))
                        }
                      >
                        {pendingId === m.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                        {t('saveRole')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12"
                        disabled={busy}
                        aria-label={t('deactivateLabel', { name })}
                        onClick={() => setConfirm(m)}
                      >
                        {t('deactivate')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={busy}
                      aria-label={t('reactivateLabel', { name })}
                      onClick={() => void run(m.id, () => setTeamMemberActive(m.id, true), t('reactivated'))}
                    >
                      {pendingId === m.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                      {t('reactivate')}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground lg:max-w-xs lg:text-right">
                  {m.isSelf ? t('selfNote') : t('higherNote')}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm ? t('deactivateTitle', { name: displayName(confirm) }) : ''}
        description={t('deactivateDesc')}
        confirmLabel={t('deactivate')}
        cancelLabel={tRoot('common.cancel')}
        pending={confirm !== null && pendingId === confirm.id}
        getReturnFocus={() => statusRef.current}
        onConfirm={() => {
          const target = confirm;
          if (!target) return;
          void run(target.id, () => setTeamMemberActive(target.id, false), t('deactivated')).then(() =>
            setConfirm(null),
          );
        }}
      />
    </div>
  );
}

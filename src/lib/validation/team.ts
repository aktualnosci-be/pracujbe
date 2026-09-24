import { z } from 'zod/v3';

/**
 * Walidacja zarządzania zespołem firmy (#403). Te same schematy w formularzu i akcji.
 * Komunikaty to klucze i18n (`team.error.*`).
 *
 * Rola `owner` nie jest zapraszana — właścicielem zostaje się przez awans istniejącego
 * członka (transfer własności). Hierarchię uprawnień egzekwuje baza (0086).
 */

export const INVITABLE_ROLES = ['admin', 'recruiter', 'member'] as const;
export const MEMBER_ROLES = ['owner', 'admin', 'recruiter', 'member'] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const teamInviteSchema = z.object({
  email: z
    .string({ required_error: 'team.error.emailRequired' })
    .trim()
    .min(1, 'team.error.emailRequired')
    .max(254, 'team.error.emailInvalid')
    .email('team.error.emailInvalid'),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'team.error.roleRequired' }) }),
});

export type TeamInviteInput = z.infer<typeof teamInviteSchema>;

export const memberRoleSchema = z.enum(MEMBER_ROLES);
export const uuidSchema = z.string().uuid();

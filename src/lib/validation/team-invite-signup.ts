import { registerEmployerSchema } from './auth';

/**
 * Rejestracja pracodawcy z linku zaproszenia do zespołu (0124). Te same pola i reguły co
 * `registerEmployerSchema`, ale bez nazwy firmy: osoba dołącza do istniejącej firmy
 * (zaproszenie czeka w panelu po potwierdzeniu adresu), więc nie zakładamy jej własnej.
 * Schemat pochodny — zmiany pól rejestracji pracodawcy przechodzą tu automatycznie.
 */
export const registerInvitedEmployerSchema = registerEmployerSchema
  .innerType()
  .omit({ companyName: true })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

export type RegisterInvitedEmployerInput = typeof registerInvitedEmployerSchema._input;

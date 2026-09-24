/**
 * Treści (i18n) wiadomości e-mail Pracuj.be — pl / nl / fr / en.
 *
 * ZASADA KLUCZOWA: język maila = język ODBIORCY, przekazywany jako argument `locale`
 * (patrz `@/lib/i18n/recipient-locale`). Ten moduł NIE korzysta z next-intl ani z kontekstu
 * żądania — maile renderowane są po stronie serwera dla dowolnego odbiorcy, więc cała treść
 * pochodzi z tego statycznego, w pełni typowanego słownika.
 *
 * Moduł jest czystymi danymi (bez I/O, bez env) — bezpieczny do importu w każdym miejscu.
 *
 * Interpolacja: pola mogą zawierać tokeny `{token}` (np. `{jobTitle}`, `{companyName}`),
 * podstawiane przez `interpolate()` na podstawie danych przekazanych do szablonu. Tokeny
 * odpowiadają nazwom pól danych maila (patrz `EmailDataMap` w `templates.tsx`).
 */

import type { Locale } from '@/i18n/routing';

/** Wszystkie obsługiwane typy maili (kolejność bez znaczenia). */
export const EMAIL_TYPES = [
  'accountConfirmation',
  'welcome',
  'passwordReset',
  'magicLink',
  'emailChange',
  'invite',
  'newApplication',
  'applicationViewed',
  'contactInvitation',
  'newMessage',
  'jobOffer',
  'offerAccepted',
  'offerDeclined',
  'statusChanged',
  'jobPublished',
  'companyVerified',
  'companyRejected',
  'companySuspended',
  'teamInvitation',
  'jobMatch',
  'guestApplicationConfirm',
  'guestApplicationSent',
  'jobExpiring',
  'payment',
  'invoice',
  'supportContact',
  'reportReceived',
  'reportDecisionActioned',
  'reportDecisionNoAction',
  'moderationJobRemoved',
  'moderationCompanySuspended',
  'moderationRestored',
  'appealReceived',
  'appealUpheld',
  'appealReversed',
  'breachNotice',
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

/** Pojedynczy blok treści maila w jednym języku. */
export interface EmailCopy {
  /** Temat wiadomości (może zawierać tokeny `{...}`). */
  subject: string;
  /** Tekst podglądu (preheader) widoczny na liście maili. */
  preview: string;
  /** Nagłówek (H1) w treści maila. */
  heading: string;
  /** Główna treść; akapity rozdzielone `\n\n`. */
  body: string;
  /** Etykieta przycisku CTA. */
  cta: string;
  /** Opcjonalne wyróżnienie (np. tytuł stanowiska, kwota) renderowane w wyróżnionym boksie. */
  highlight?: string;
  /** Opcjonalny tekst dodatkowy pod przyciskiem (np. informacja o ważności linku). */
  outro?: string;
  /**
   * Neutralny wariant treści (#288/#294) — nadpisuje wskazane pola, gdy kluczowa dana maila
   * jest nieznana (brak imienia/nazwiska nadawcy albo nierozpoznany status). Dzięki temu mail
   * nie zawiera zdania z pustym podmiotem („— zgłosił(a) się…”) ani surowego kodu technicznego.
   * Pusty `highlight` ukrywa wyróżniony boks.
   */
  anonymous?: Partial<Pick<EmailCopy, 'subject' | 'preview' | 'heading' | 'body' | 'highlight'>>;
  /**
   * Nadpisanie noty w stopce („masz konto…”) — dla odbiorców, którzy mogą nie mieć konta
   * (np. potwierdzenie zgłoszenia treści wysłanego bez logowania, #41).
   */
  footerNote?: string;
}

/** Powitanie (bez imienia) w każdym języku — imię dołączane jest w szablonie. */
export const greetings: Record<Locale, string> = {
  pl: 'Cześć',
  nl: 'Hallo',
  fr: 'Bonjour',
  en: 'Hi',
};

/** Wspólne teksty layoutu (nagłówek/stopka/fallback przycisku) per język. */
export interface LayoutCopy {
  /** Krótkie hasło marki w stopce. */
  tagline: string;
  /** Wyjaśnienie, dlaczego odbiorca dostał tę wiadomość. */
  footerNote: string;
  /** Nota o prawach autorskich (zawiera token `{year}`). */
  rights: string;
  /** Etykieta linku do pomocy. */
  help: string;
  /** Etykieta linku do polityki prywatności. */
  privacy: string;
  /** Link wypisania z kategorii tej wiadomości (#45); tylko gdy mail ma kategorię preferencji. */
  unsubscribe: string;
  /** Etykiety tożsamości nadawcy w stopce (#45; wartości z konfiguracji, nie z kodu). */
  sender: string;
  postalAddress: string;
  /** Tekst wprowadzający surowy link (gdy przycisk nie działa). */
  buttonFallback: string;
}

export const layoutCopy: Record<Locale, LayoutCopy> = {
  pl: {
    tagline: 'Praca w Belgii bez CV i barier językowych.',
    footerNote: 'Otrzymujesz tę wiadomość, ponieważ masz konto w serwisie Pracuj.be.',
    rights: '© {year} Pracuj.be. Wszelkie prawa zastrzeżone.',
    help: 'Pomoc',
    privacy: 'Prywatność',
    unsubscribe: 'Wypisz się z tych e-maili',
    sender: 'Nadawca',
    postalAddress: 'Adres pocztowy',
    buttonFallback: 'Jeśli przycisk nie działa, skopiuj i wklej ten adres do przeglądarki:',
  },
  nl: {
    tagline: 'Werk in België zonder cv en zonder taaldrempels.',
    footerNote: 'Je ontvangt dit bericht omdat je een account hebt op Pracuj.be.',
    rights: '© {year} Pracuj.be. Alle rechten voorbehouden.',
    help: 'Help',
    privacy: 'Privacy',
    unsubscribe: 'Afmelden voor deze e-mails',
    sender: 'Afzender',
    postalAddress: 'Postadres',
    buttonFallback: 'Werkt de knop niet? Kopieer en plak deze link in je browser:',
  },
  fr: {
    tagline: 'Du travail en Belgique sans CV ni barrière de langue.',
    footerNote: 'Vous recevez ce message car vous avez un compte sur Pracuj.be.',
    rights: '© {year} Pracuj.be. Tous droits réservés.',
    help: 'Aide',
    privacy: 'Confidentialité',
    unsubscribe: 'Se désinscrire de ces e-mails',
    sender: 'Expéditeur',
    postalAddress: 'Adresse postale',
    buttonFallback: 'Le bouton ne fonctionne pas ? Copiez-collez ce lien dans votre navigateur :',
  },
  en: {
    tagline: 'Work in Belgium without a CV or language barriers.',
    footerNote: 'You are receiving this email because you have an account on Pracuj.be.',
    rights: '© {year} Pracuj.be. All rights reserved.',
    help: 'Help',
    privacy: 'Privacy',
    unsubscribe: 'Unsubscribe from these emails',
    sender: 'Sender',
    postalAddress: 'Postal address',
    buttonFallback: 'If the button does not work, copy and paste this link into your browser:',
  },
};

/** Etykiety markowej karty w wiadomości z propozycją pracy. */
export const jobOfferPassportCopy: Record<
  Locale,
  { title: string; jobTitle: string; companyName: string; salary: string; expiresAt: string }
> = {
  pl: {
    title: 'Paszport pracy',
    jobTitle: 'Stanowisko',
    companyName: 'Firma',
    salary: 'Wynagrodzenie',
    expiresAt: 'Odpowiedz do',
  },
  nl: {
    title: 'Werkpaspoort',
    jobTitle: 'Functie',
    companyName: 'Bedrijf',
    salary: 'Loon',
    expiresAt: 'Reageer vóór',
  },
  fr: {
    title: 'Passeport emploi',
    jobTitle: 'Poste',
    companyName: 'Entreprise',
    salary: 'Rémunération',
    expiresAt: 'Répondre avant le',
  },
  en: {
    title: 'Job passport',
    jobTitle: 'Position',
    companyName: 'Company',
    salary: 'Salary',
    expiresAt: 'Respond by',
  },
};

/**
 * Podstawia tokeny `{token}` w szablonie wartościami z `vars`.
 * Brakujące / puste (undefined | null) wartości podstawiane są jako pusty ciąg.
 */
export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Pełny słownik treści: typ maila -> język -> blok treści. */
/**
 * Etykiety uzasadnienia decyzji moderacyjnej (#42) w języku odbiorcy: podstawa ograniczenia
 * i udział automatyzacji. Podstawiane jako `{groundLabel}` / `{automationLabel}`.
 */
export const moderationLabels: Record<
  Locale,
  { terms: string; law: string; automatedYes: string; automatedNo: string }
> = {
  pl: {
    terms: 'Regulamin serwisu',
    law: 'Przepis prawa',
    automatedYes: 'Treść została wykryta lub oznaczona automatycznie. Decyzję podjął człowiek.',
    automatedNo: 'Treść nie została wykryta automatycznie. Decyzję podjął człowiek.',
  },
  nl: {
    terms: 'Gebruiksvoorwaarden van de website',
    law: 'Wettelijke bepaling',
    automatedYes: 'De inhoud werd automatisch opgespoord of gemarkeerd. De beslissing werd door een mens genomen.',
    automatedNo: 'De inhoud werd niet automatisch opgespoord. De beslissing werd door een mens genomen.',
  },
  fr: {
    terms: 'Conditions d’utilisation du site',
    law: 'Disposition légale',
    automatedYes: 'Le contenu a été détecté ou signalé automatiquement. La décision a été prise par une personne.',
    automatedNo: 'Le contenu n’a pas été détecté automatiquement. La décision a été prise par une personne.',
  },
  en: {
    terms: 'Website terms of use',
    law: 'Legal provision',
    automatedYes: 'The content was detected or flagged automatically. The decision was made by a person.',
    automatedNo: 'The content was not detected automatically. The decision was made by a person.',
  },
};

export const emailCopy: Record<EmailType, Record<Locale, EmailCopy>> = {
  accountConfirmation: {
    pl: {
      subject: 'Potwierdź swój adres e-mail',
      preview: 'Jeszcze jeden krok, aby aktywować konto.',
      heading: 'Potwierdź adres e-mail',
      body: 'Dziękujemy za założenie konta w Pracuj.be. Kliknij przycisk poniżej, aby potwierdzić swój adres e-mail i aktywować konto.',
      cta: 'Potwierdź adres e-mail',
      outro: 'Jeśli to nie Ty zakładałeś(-aś) konto, po prostu zignoruj tę wiadomość.',
    },
    nl: {
      subject: 'Bevestig je e-mailadres',
      preview: 'Nog één stap om je account te activeren.',
      heading: 'Bevestig je e-mailadres',
      body: 'Bedankt dat je een account hebt aangemaakt bij Pracuj.be. Klik op de knop hieronder om je e-mailadres te bevestigen en je account te activeren.',
      cta: 'E-mailadres bevestigen',
      outro: 'Heb je dit account niet aangemaakt? Dan mag je deze e-mail negeren.',
    },
    fr: {
      subject: 'Confirmez votre adresse e-mail',
      preview: 'Encore une étape pour activer votre compte.',
      heading: 'Confirmez votre adresse e-mail',
      body: 'Merci d’avoir créé un compte sur Pracuj.be. Cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail et activer votre compte.',
      cta: 'Confirmer l’adresse e-mail',
      outro: 'Si vous n’êtes pas à l’origine de cette inscription, ignorez simplement cet e-mail.',
    },
    en: {
      subject: 'Confirm your email address',
      preview: 'One more step to activate your account.',
      heading: 'Confirm your email address',
      body: 'Thanks for creating an account on Pracuj.be. Click the button below to confirm your email address and activate your account.',
      cta: 'Confirm email address',
      outro: 'If you did not create this account, you can safely ignore this email.',
    },
  },

  welcome: {
    pl: {
      subject: 'Witaj w Pracuj.be!',
      preview: 'Twoje konto jest gotowe — zacznij już teraz.',
      heading: 'Witaj w Pracuj.be!',
      body: 'Cieszymy się, że jesteś z nami.\n\nUzupełnij swój profil, aby pracodawcy mogli szybciej Cię znaleźć i zaprosić do pracy — bez CV i bez barier językowych.',
      cta: 'Przejdź do panelu',
      outro: 'Masz pytania? Chętnie pomożemy.',
    },
    nl: {
      subject: 'Welkom bij Pracuj.be!',
      preview: 'Je account is klaar — begin meteen.',
      heading: 'Welkom bij Pracuj.be!',
      body: 'Fijn dat je erbij bent.\n\nVul je profiel aan zodat werkgevers je sneller vinden en uitnodigen — zonder cv en zonder taaldrempels.',
      cta: 'Naar het dashboard',
      outro: 'Vragen? We helpen je graag.',
    },
    fr: {
      subject: 'Bienvenue sur Pracuj.be !',
      preview: 'Votre compte est prêt — commencez dès maintenant.',
      heading: 'Bienvenue sur Pracuj.be !',
      body: 'Ravis de vous compter parmi nous.\n\nComplétez votre profil pour que les employeurs vous trouvent plus vite et vous proposent du travail — sans CV et sans barrière de langue.',
      cta: 'Accéder au tableau de bord',
      outro: 'Des questions ? Nous sommes là pour vous aider.',
    },
    en: {
      subject: 'Welcome to Pracuj.be!',
      preview: 'Your account is ready — get started now.',
      heading: 'Welcome to Pracuj.be!',
      body: 'We are glad to have you on board.\n\nComplete your profile so employers can find you faster and invite you to work — no CV and no language barriers.',
      cta: 'Go to dashboard',
      outro: 'Questions? We are happy to help.',
    },
  },

  passwordReset: {
    pl: {
      subject: 'Zresetuj hasło',
      preview: 'Ustaw nowe hasło do swojego konta.',
      heading: 'Zresetuj hasło',
      body: 'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby ustawić nowe hasło.',
      cta: 'Ustaw nowe hasło',
      outro: 'Link jest ważny przez 60 minut. Jeśli to nie Ty prosiłeś(-aś) o zmianę hasła, zignoruj tę wiadomość — Twoje hasło pozostanie bez zmian.',
    },
    nl: {
      subject: 'Wachtwoord opnieuw instellen',
      preview: 'Stel een nieuw wachtwoord in voor je account.',
      heading: 'Wachtwoord opnieuw instellen',
      body: 'We hebben een verzoek ontvangen om het wachtwoord van je account opnieuw in te stellen. Klik op de knop hieronder om een nieuw wachtwoord in te stellen.',
      cta: 'Nieuw wachtwoord instellen',
      outro: 'Deze link is 60 minuten geldig. Heb je hier niet om gevraagd? Negeer dan deze e-mail — je wachtwoord blijft ongewijzigd.',
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe',
      preview: 'Définissez un nouveau mot de passe pour votre compte.',
      heading: 'Réinitialisez votre mot de passe',
      body: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte. Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe.',
      cta: 'Définir un nouveau mot de passe',
      outro: 'Ce lien est valable 60 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail — votre mot de passe restera inchangé.',
    },
    en: {
      subject: 'Reset your password',
      preview: 'Set a new password for your account.',
      heading: 'Reset your password',
      body: 'We received a request to reset the password for your account. Click the button below to set a new password.',
      cta: 'Set a new password',
      outro: 'This link is valid for 60 minutes. If you did not request this, you can safely ignore this email — your password will stay the same.',
    },
  },

  magicLink: {
    pl: {
      subject: 'Twój link do logowania',
      preview: 'Zaloguj się jednym kliknięciem.',
      heading: 'Zaloguj się do Pracuj.be',
      body: 'Kliknij przycisk poniżej, aby zalogować się do swojego konta w Pracuj.be.',
      cta: 'Zaloguj się',
      outro: 'Jeśli to nie Ty prosiłeś(-aś) o link do logowania, po prostu zignoruj tę wiadomość.',
    },
    nl: {
      subject: 'Je inloglink',
      preview: 'Log in met één klik.',
      heading: 'Inloggen bij Pracuj.be',
      body: 'Klik op de knop hieronder om in te loggen op je account bij Pracuj.be.',
      cta: 'Inloggen',
      outro: 'Heb je deze link niet aangevraagd? Dan mag je deze e-mail negeren.',
    },
    fr: {
      subject: 'Votre lien de connexion',
      preview: 'Connectez-vous en un clic.',
      heading: 'Connexion à Pracuj.be',
      body: 'Cliquez sur le bouton ci-dessous pour vous connecter à votre compte Pracuj.be.',
      cta: 'Se connecter',
      outro: 'Si vous n’avez pas demandé ce lien, ignorez simplement cet e-mail.',
    },
    en: {
      subject: 'Your sign-in link',
      preview: 'Sign in with one click.',
      heading: 'Sign in to Pracuj.be',
      body: 'Click the button below to sign in to your Pracuj.be account.',
      cta: 'Sign in',
      outro: 'If you did not request this link, you can safely ignore this email.',
    },
  },

  emailChange: {
    pl: {
      subject: 'Potwierdź zmianę adresu e-mail',
      preview: 'Potwierdź nowy adres e-mail swojego konta.',
      heading: 'Potwierdź zmianę adresu e-mail',
      body: 'Otrzymaliśmy prośbę o zmianę adresu e-mail przypisanego do Twojego konta w Pracuj.be. Kliknij przycisk poniżej, aby ją potwierdzić.',
      cta: 'Potwierdź zmianę',
      outro: 'Jeśli to nie Ty prosiłeś(-aś) o zmianę, zignoruj tę wiadomość — adres e-mail pozostanie bez zmian.',
    },
    nl: {
      subject: 'Bevestig de wijziging van je e-mailadres',
      preview: 'Bevestig het nieuwe e-mailadres van je account.',
      heading: 'Bevestig de wijziging van je e-mailadres',
      body: 'We hebben een verzoek ontvangen om het e-mailadres van je account bij Pracuj.be te wijzigen. Klik op de knop hieronder om dit te bevestigen.',
      cta: 'Wijziging bevestigen',
      outro: 'Heb je hier niet om gevraagd? Negeer dan deze e-mail — je e-mailadres blijft ongewijzigd.',
    },
    fr: {
      subject: 'Confirmez le changement d’adresse e-mail',
      preview: 'Confirmez la nouvelle adresse e-mail de votre compte.',
      heading: 'Confirmez le changement d’adresse e-mail',
      body: 'Nous avons reçu une demande de modification de l’adresse e-mail de votre compte Pracuj.be. Cliquez sur le bouton ci-dessous pour la confirmer.',
      cta: 'Confirmer le changement',
      outro: 'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail — votre adresse restera inchangée.',
    },
    en: {
      subject: 'Confirm your email address change',
      preview: 'Confirm the new email address for your account.',
      heading: 'Confirm your email address change',
      body: 'We received a request to change the email address for your Pracuj.be account. Click the button below to confirm it.',
      cta: 'Confirm change',
      outro: 'If you did not request this, you can safely ignore this email — your email address will stay the same.',
    },
  },

  invite: {
    pl: {
      subject: 'Zaproszenie do Pracuj.be',
      preview: 'Aktywuj konto i dołącz do Pracuj.be.',
      heading: 'Zaproszenie do Pracuj.be',
      body: 'Otrzymujesz zaproszenie do serwisu Pracuj.be. Kliknij przycisk poniżej, aby przyjąć zaproszenie i aktywować konto.',
      cta: 'Przyjmij zaproszenie',
      outro: 'Jeśli nie spodziewasz się tego zaproszenia, po prostu zignoruj tę wiadomość.',
    },
    nl: {
      subject: 'Uitnodiging voor Pracuj.be',
      preview: 'Activeer je account en sluit je aan bij Pracuj.be.',
      heading: 'Uitnodiging voor Pracuj.be',
      body: 'Je bent uitgenodigd voor Pracuj.be. Klik op de knop hieronder om de uitnodiging te aanvaarden en je account te activeren.',
      cta: 'Uitnodiging aanvaarden',
      outro: 'Verwachtte je deze uitnodiging niet? Dan mag je deze e-mail negeren.',
    },
    fr: {
      subject: 'Invitation à rejoindre Pracuj.be',
      preview: 'Activez votre compte et rejoignez Pracuj.be.',
      heading: 'Invitation à rejoindre Pracuj.be',
      body: 'Vous êtes invité(e) à rejoindre Pracuj.be. Cliquez sur le bouton ci-dessous pour accepter l’invitation et activer votre compte.',
      cta: 'Accepter l’invitation',
      outro: 'Si vous n’attendiez pas cette invitation, ignorez simplement cet e-mail.',
    },
    en: {
      subject: 'Invitation to Pracuj.be',
      preview: 'Activate your account and join Pracuj.be.',
      heading: 'You are invited to Pracuj.be',
      body: 'You have been invited to join Pracuj.be. Click the button below to accept the invitation and activate your account.',
      cta: 'Accept invitation',
      outro: 'If you were not expecting this invitation, you can safely ignore this email.',
    },
  },

  newApplication: {
    pl: {
      subject: 'Nowe zgłoszenie na ogłoszenie: {jobTitle}',
      preview: '{candidateName} zgłosił(a) się na Twoje ogłoszenie.',
      heading: 'Nowe zgłoszenie',
      body: '{candidateName} zgłosił(a) się na Twoje ogłoszenie „{jobTitle}”. Zobacz profil kandydata i zdecyduj o kolejnych krokach.',
      cta: 'Zobacz zgłoszenie',
      highlight: '{jobTitle}',
      anonymous: {
        preview: 'Nowy kandydat zgłosił się na Twoje ogłoszenie.',
        body: 'Nowy kandydat zgłosił się na Twoje ogłoszenie „{jobTitle}”. Zobacz profil kandydata i zdecyduj o kolejnych krokach.',
      },
    },
    nl: {
      subject: 'Nieuwe sollicitatie op: {jobTitle}',
      preview: '{candidateName} heeft gesolliciteerd op je vacature.',
      heading: 'Nieuwe sollicitatie',
      body: '{candidateName} heeft gesolliciteerd op je vacature ‘{jobTitle}’. Bekijk het profiel van de kandidaat en bepaal de volgende stap.',
      cta: 'Sollicitatie bekijken',
      highlight: '{jobTitle}',
      anonymous: {
        preview: 'Een nieuwe kandidaat heeft gesolliciteerd op je vacature.',
        body: 'Een nieuwe kandidaat heeft gesolliciteerd op je vacature ‘{jobTitle}’. Bekijk het profiel van de kandidaat en bepaal de volgende stap.',
      },
    },
    fr: {
      subject: 'Nouvelle candidature pour : {jobTitle}',
      preview: '{candidateName} a postulé à votre offre.',
      heading: 'Nouvelle candidature',
      body: '{candidateName} a postulé à votre offre « {jobTitle} ». Consultez le profil du candidat et décidez de la suite.',
      cta: 'Voir la candidature',
      highlight: '{jobTitle}',
      anonymous: {
        preview: 'Un nouveau candidat a postulé à votre offre.',
        body: 'Un nouveau candidat a postulé à votre offre « {jobTitle} ». Consultez le profil du candidat et décidez de la suite.',
      },
    },
    en: {
      subject: 'New application for: {jobTitle}',
      preview: '{candidateName} applied to your job.',
      heading: 'New application',
      body: '{candidateName} applied to your job “{jobTitle}”. Review the candidate’s profile and decide on the next steps.',
      cta: 'View application',
      highlight: '{jobTitle}',
      anonymous: {
        preview: 'A new candidate applied to your job.',
        body: 'A new candidate applied to your job “{jobTitle}”. Review the candidate’s profile and decide on the next steps.',
      },
    },
  },

  applicationViewed: {
    pl: {
      subject: 'Pracodawca obejrzał Twoje zgłoszenie',
      preview: '{companyName} sprawdził(a) Twoją aplikację.',
      heading: 'Twoje zgłoszenie zostało obejrzane',
      body: 'Dobra wiadomość! {companyName} obejrzał(a) Twoje zgłoszenie na stanowisko „{jobTitle}”. Trzymamy kciuki za kolejne kroki.',
      cta: 'Zobacz status zgłoszenia',
      highlight: '{jobTitle}',
    },
    nl: {
      subject: 'Werkgever heeft je sollicitatie bekeken',
      preview: '{companyName} heeft je sollicitatie bekeken.',
      heading: 'Je sollicitatie is bekeken',
      body: 'Goed nieuws! {companyName} heeft je sollicitatie voor ‘{jobTitle}’ bekeken. We duimen voor de volgende stap.',
      cta: 'Status bekijken',
      highlight: '{jobTitle}',
    },
    fr: {
      subject: 'Un employeur a consulté votre candidature',
      preview: '{companyName} a consulté votre candidature.',
      heading: 'Votre candidature a été consultée',
      body: 'Bonne nouvelle ! {companyName} a consulté votre candidature pour « {jobTitle} ». Nous croisons les doigts pour la suite.',
      cta: 'Voir le statut',
      highlight: '{jobTitle}',
    },
    en: {
      subject: 'An employer viewed your application',
      preview: '{companyName} viewed your application.',
      heading: 'Your application was viewed',
      body: 'Good news! {companyName} viewed your application for “{jobTitle}”. Fingers crossed for the next steps.',
      cta: 'View application status',
      highlight: '{jobTitle}',
    },
  },

  contactInvitation: {
    pl: {
      subject: '{companyName} chce się z Tobą skontaktować',
      preview: 'Zaproszenie do kontaktu od {companyName}.',
      heading: 'Zaproszenie do kontaktu',
      body: '{companyName} chce porozmawiać z Tobą o możliwej współpracy. Odpowiedz, aby umówić kolejny krok.',
      cta: 'Odpowiedz na zaproszenie',
      highlight: '{jobTitle}',
    },
    nl: {
      subject: '{companyName} wil contact met je opnemen',
      preview: 'Uitnodiging voor contact van {companyName}.',
      heading: 'Uitnodiging voor contact',
      body: '{companyName} wil met je praten over een mogelijke samenwerking. Reageer om een volgende stap af te spreken.',
      cta: 'Reageren op uitnodiging',
      highlight: '{jobTitle}',
    },
    fr: {
      subject: '{companyName} souhaite vous contacter',
      preview: 'Invitation à échanger de la part de {companyName}.',
      heading: 'Invitation à échanger',
      body: '{companyName} souhaite discuter avec vous d’une éventuelle collaboration. Répondez pour convenir de la suite.',
      cta: 'Répondre à l’invitation',
      highlight: '{jobTitle}',
    },
    en: {
      subject: '{companyName} wants to get in touch',
      preview: 'Contact invitation from {companyName}.',
      heading: 'Contact invitation',
      body: '{companyName} would like to talk with you about a possible collaboration. Reply to arrange the next step.',
      cta: 'Respond to invitation',
      highlight: '{jobTitle}',
    },
  },

  newMessage: {
    pl: {
      subject: 'Masz nową wiadomość od {senderName}',
      preview: '{senderName} wysłał(a) Ci wiadomość.',
      heading: 'Nowa wiadomość',
      body: '{senderName} wysłał(a) Ci wiadomość w serwisie Pracuj.be. Przeczytaj ją i odpowiedz bezpośrednio w panelu.',
      cta: 'Przeczytaj wiadomość',
      highlight: '{senderName}',
      anonymous: {
        subject: 'Masz nową wiadomość',
        preview: 'Czeka na Ciebie nowa wiadomość.',
        body: 'Czeka na Ciebie nowa wiadomość w serwisie Pracuj.be. Przeczytaj ją i odpowiedz bezpośrednio w panelu.',
        highlight: '',
      },
    },
    nl: {
      subject: 'Nieuw bericht van {senderName}',
      preview: '{senderName} heeft je een bericht gestuurd.',
      heading: 'Nieuw bericht',
      body: '{senderName} heeft je een bericht gestuurd op Pracuj.be. Lees het en reageer rechtstreeks in je dashboard.',
      cta: 'Bericht lezen',
      highlight: '{senderName}',
      anonymous: {
        subject: 'Je hebt een nieuw bericht',
        preview: 'Er wacht een nieuw bericht op je.',
        body: 'Er wacht een nieuw bericht op je op Pracuj.be. Lees het en reageer rechtstreeks in je dashboard.',
        highlight: '',
      },
    },
    fr: {
      subject: 'Nouveau message de {senderName}',
      preview: '{senderName} vous a envoyé un message.',
      heading: 'Nouveau message',
      body: '{senderName} vous a envoyé un message sur Pracuj.be. Lisez-le et répondez directement depuis votre tableau de bord.',
      cta: 'Lire le message',
      highlight: '{senderName}',
      anonymous: {
        subject: 'Vous avez un nouveau message',
        preview: 'Un nouveau message vous attend.',
        body: 'Un nouveau message vous attend sur Pracuj.be. Lisez-le et répondez directement depuis votre tableau de bord.',
        highlight: '',
      },
    },
    en: {
      subject: 'New message from {senderName}',
      preview: '{senderName} sent you a message.',
      heading: 'New message',
      body: '{senderName} sent you a message on Pracuj.be. Read it and reply directly from your dashboard.',
      cta: 'Read message',
      highlight: '{senderName}',
      anonymous: {
        subject: 'You have a new message',
        preview: 'A new message is waiting for you.',
        body: 'A new message is waiting for you on Pracuj.be. Read it and reply directly from your dashboard.',
        highlight: '',
      },
    },
  },

  jobOffer: {
    pl: {
      subject: 'Oferta pracy od {companyName}',
      preview: '{companyName} przesłał(a) Ci ofertę pracy.',
      heading: 'Masz ofertę pracy',
      body: '{companyName} przesłał(a) Ci ofertę pracy na stanowisko „{jobTitle}”. Zapoznaj się ze szczegółami i zdecyduj, czy chcesz ją przyjąć.',
      cta: 'Zobacz ofertę',
      highlight: '{jobTitle}',
    },
    nl: {
      subject: 'Jobaanbod van {companyName}',
      preview: '{companyName} heeft je een jobaanbod gestuurd.',
      heading: 'Je hebt een jobaanbod',
      body: '{companyName} heeft je een aanbod gestuurd voor de functie ‘{jobTitle}’. Bekijk de details en beslis of je het aanvaardt.',
      cta: 'Aanbod bekijken',
      highlight: '{jobTitle}',
    },
    fr: {
      subject: 'Offre d’emploi de {companyName}',
      preview: '{companyName} vous a envoyé une offre d’emploi.',
      heading: 'Vous avez une offre d’emploi',
      body: '{companyName} vous a envoyé une offre pour le poste « {jobTitle} ». Consultez les détails et décidez si vous l’acceptez.',
      cta: 'Voir l’offre',
      highlight: '{jobTitle}',
    },
    en: {
      subject: 'Job offer from {companyName}',
      preview: '{companyName} sent you a job offer.',
      heading: 'You have a job offer',
      body: '{companyName} sent you an offer for the “{jobTitle}” role. Review the details and decide whether to accept.',
      cta: 'View offer',
      highlight: '{jobTitle}',
    },
  },

  offerAccepted: {
    pl: {
      subject: '{candidateName} przyjął(-ęła) Twoją ofertę',
      preview: 'Dobra wiadomość dotycząca oferty „{jobTitle}”.',
      heading: 'Oferta przyjęta',
      body: '{candidateName} przyjął(-ęła) Twoją ofertę pracy na stanowisko „{jobTitle}”. Skontaktuj się, aby ustalić szczegóły rozpoczęcia współpracy.',
      cta: 'Zobacz szczegóły',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Twoja oferta została przyjęta',
        body: 'Twoja oferta pracy na stanowisko „{jobTitle}” została przyjęta przez kandydata. Skontaktuj się, aby ustalić szczegóły rozpoczęcia współpracy.',
        highlight: '{jobTitle}',
      },
    },
    nl: {
      subject: '{candidateName} heeft je aanbod aanvaard',
      preview: 'Goed nieuws over het aanbod ‘{jobTitle}’.',
      heading: 'Aanbod aanvaard',
      body: '{candidateName} heeft je jobaanbod voor ‘{jobTitle}’ aanvaard. Neem contact op om de start te regelen.',
      cta: 'Details bekijken',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Je aanbod is aanvaard',
        body: 'Je jobaanbod voor ‘{jobTitle}’ is aanvaard door de kandidaat. Neem contact op om de start te regelen.',
        highlight: '{jobTitle}',
      },
    },
    fr: {
      subject: '{candidateName} a accepté votre offre',
      preview: 'Bonne nouvelle concernant l’offre « {jobTitle} ».',
      heading: 'Offre acceptée',
      body: '{candidateName} a accepté votre offre pour le poste « {jobTitle} ». Contactez-le/la pour organiser le démarrage.',
      cta: 'Voir les détails',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Votre offre a été acceptée',
        body: 'Votre offre pour le poste « {jobTitle} » a été acceptée par le candidat. Prenez contact pour organiser le démarrage.',
        highlight: '{jobTitle}',
      },
    },
    en: {
      subject: '{candidateName} accepted your offer',
      preview: 'Good news about the “{jobTitle}” offer.',
      heading: 'Offer accepted',
      body: '{candidateName} accepted your job offer for “{jobTitle}”. Get in touch to arrange the start.',
      cta: 'View details',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Your offer was accepted',
        body: 'Your job offer for “{jobTitle}” was accepted by the candidate. Get in touch to arrange the start.',
        highlight: '{jobTitle}',
      },
    },
  },

  offerDeclined: {
    pl: {
      subject: '{candidateName} odrzucił(a) Twoją ofertę',
      preview: 'Aktualizacja oferty „{jobTitle}”.',
      heading: 'Oferta odrzucona',
      body: '{candidateName} niestety odrzucił(a) Twoją ofertę na stanowisko „{jobTitle}”. Możesz przejrzeć innych kandydatów dopasowanych do tego ogłoszenia.',
      cta: 'Zobacz kandydatów',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Twoja oferta została odrzucona',
        body: 'Twoja oferta na stanowisko „{jobTitle}” została niestety odrzucona przez kandydata. Możesz przejrzeć innych kandydatów dopasowanych do tego ogłoszenia.',
        highlight: '{jobTitle}',
      },
    },
    nl: {
      subject: '{candidateName} heeft je aanbod afgewezen',
      preview: 'Update over het aanbod ‘{jobTitle}’.',
      heading: 'Aanbod afgewezen',
      body: '{candidateName} heeft je aanbod voor ‘{jobTitle}’ helaas afgewezen. Bekijk andere kandidaten die bij deze vacature passen.',
      cta: 'Kandidaten bekijken',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Je aanbod is afgewezen',
        body: 'Je aanbod voor ‘{jobTitle}’ is helaas afgewezen door de kandidaat. Bekijk andere kandidaten die bij deze vacature passen.',
        highlight: '{jobTitle}',
      },
    },
    fr: {
      subject: '{candidateName} a décliné votre offre',
      preview: 'Mise à jour de l’offre « {jobTitle} ».',
      heading: 'Offre déclinée',
      body: '{candidateName} a malheureusement décliné votre offre pour « {jobTitle} ». Vous pouvez consulter d’autres candidats correspondant à cette annonce.',
      cta: 'Voir les candidats',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Votre offre a été déclinée',
        body: 'Votre offre pour « {jobTitle} » a malheureusement été déclinée par le candidat. Vous pouvez consulter d’autres candidats correspondant à cette annonce.',
        highlight: '{jobTitle}',
      },
    },
    en: {
      subject: '{candidateName} declined your offer',
      preview: 'Update on the “{jobTitle}” offer.',
      heading: 'Offer declined',
      body: '{candidateName} unfortunately declined your offer for “{jobTitle}”. You can review other candidates matching this listing.',
      cta: 'View candidates',
      highlight: '{candidateName}',
      anonymous: {
        subject: 'Your offer was declined',
        body: 'Your offer for “{jobTitle}” was unfortunately declined by the candidate. You can review other candidates matching this listing.',
        highlight: '{jobTitle}',
      },
    },
  },

  statusChanged: {
    pl: {
      subject: 'Zmiana statusu zgłoszenia: {jobTitle}',
      preview: 'Status Twojego zgłoszenia to teraz: {status}.',
      heading: 'Zmiana statusu zgłoszenia',
      body: 'Status Twojego zgłoszenia na stanowisko „{jobTitle}” w firmie {companyName} został zaktualizowany.',
      cta: 'Zobacz zgłoszenie',
      highlight: '{status}',
      anonymous: {
        preview: 'Status Twojego zgłoszenia został zaktualizowany.',
        highlight: '',
      },
    },
    nl: {
      subject: 'Statuswijziging sollicitatie: {jobTitle}',
      preview: 'De status van je sollicitatie is nu: {status}.',
      heading: 'Statuswijziging sollicitatie',
      body: 'De status van je sollicitatie voor ‘{jobTitle}’ bij {companyName} is bijgewerkt.',
      cta: 'Sollicitatie bekijken',
      highlight: '{status}',
      anonymous: {
        preview: 'De status van je sollicitatie is bijgewerkt.',
        highlight: '',
      },
    },
    fr: {
      subject: 'Changement de statut de candidature : {jobTitle}',
      preview: 'Le statut de votre candidature est désormais : {status}.',
      heading: 'Changement de statut',
      body: 'Le statut de votre candidature pour « {jobTitle} » chez {companyName} a été mis à jour.',
      cta: 'Voir la candidature',
      highlight: '{status}',
      anonymous: {
        preview: 'Le statut de votre candidature a été mis à jour.',
        highlight: '',
      },
    },
    en: {
      subject: 'Application status update: {jobTitle}',
      preview: 'Your application status is now: {status}.',
      heading: 'Application status update',
      body: 'The status of your application for “{jobTitle}” at {companyName} has been updated.',
      cta: 'View application',
      highlight: '{status}',
      anonymous: {
        preview: 'Your application status has been updated.',
        highlight: '',
      },
    },
  },

  jobPublished: {
    pl: {
      subject: 'Twoje ogłoszenie jest już online: {jobTitle}',
      preview: '„{jobTitle}” zostało opublikowane.',
      heading: 'Ogłoszenie opublikowane',
      body: 'Twoje ogłoszenie „{jobTitle}” jest już widoczne dla kandydatów w Pracuj.be. Powiadomimy Cię, gdy pojawią się pierwsze zgłoszenia.',
      cta: 'Zobacz ogłoszenie',
      highlight: '{jobTitle}',
    },
    nl: {
      subject: 'Je vacature staat online: {jobTitle}',
      preview: '‘{jobTitle}’ is gepubliceerd.',
      heading: 'Vacature gepubliceerd',
      body: 'Je vacature ‘{jobTitle}’ is nu zichtbaar voor kandidaten op Pracuj.be. We laten het je weten zodra de eerste sollicitaties binnenkomen.',
      cta: 'Vacature bekijken',
      highlight: '{jobTitle}',
    },
    fr: {
      subject: 'Votre annonce est en ligne : {jobTitle}',
      preview: '« {jobTitle} » a été publiée.',
      heading: 'Annonce publiée',
      body: 'Votre annonce « {jobTitle} » est désormais visible par les candidats sur Pracuj.be. Nous vous préviendrons dès les premières candidatures.',
      cta: 'Voir l’annonce',
      highlight: '{jobTitle}',
    },
    en: {
      subject: 'Your job is now live: {jobTitle}',
      preview: '“{jobTitle}” has been published.',
      heading: 'Job published',
      body: 'Your job “{jobTitle}” is now visible to candidates on Pracuj.be. We will let you know as soon as the first applications arrive.',
      cta: 'View job',
      highlight: '{jobTitle}',
    },
  },

  companyVerified: {
    pl: {
      subject: 'Firma {companyName} jest zweryfikowana',
      preview: 'Możesz publikować oferty pracy w Pracuj.be.',
      heading: 'Firma zweryfikowana',
      body: 'Sprawdziliśmy dane firmy {companyName}. Możesz teraz publikować oferty pracy i odpowiadać kandydatom.',
      cta: 'Przejdź do danych firmy',
      highlight: '{companyName}',
    },
    nl: {
      subject: 'Bedrijf {companyName} is geverifieerd',
      preview: 'Je kunt vacatures publiceren op Pracuj.be.',
      heading: 'Bedrijf geverifieerd',
      body: 'We hebben de gegevens van {companyName} gecontroleerd. Je kunt nu vacatures publiceren en kandidaten antwoorden.',
      cta: 'Naar bedrijfsgegevens',
      highlight: '{companyName}',
    },
    fr: {
      subject: 'L’entreprise {companyName} est vérifiée',
      preview: 'Vous pouvez publier des offres d’emploi sur Pracuj.be.',
      heading: 'Entreprise vérifiée',
      body: 'Nous avons vérifié les données de {companyName}. Vous pouvez maintenant publier des offres d’emploi et répondre aux candidats.',
      cta: 'Voir les données de l’entreprise',
      highlight: '{companyName}',
    },
    en: {
      subject: '{companyName} is verified',
      preview: 'You can now publish jobs on Pracuj.be.',
      heading: 'Company verified',
      body: 'We have checked the details of {companyName}. You can now publish jobs and reply to candidates.',
      cta: 'Go to company details',
      highlight: '{companyName}',
    },
  },

  companyRejected: {
    pl: {
      subject: 'Weryfikacja firmy {companyName} nie powiodła się',
      preview: 'Sprawdź powód i popraw dane firmy.',
      heading: 'Firma niezweryfikowana',
      body: 'Nie mogliśmy zweryfikować firmy {companyName}. Powód podajemy poniżej. Popraw dane firmy i wyślij ją ponownie do weryfikacji w panelu pracodawcy.',
      cta: 'Popraw dane firmy',
      highlight: '{companyName}',
      anonymous: {
        body: 'Nie mogliśmy zweryfikować firmy {companyName}. Popraw dane firmy i wyślij ją ponownie do weryfikacji w panelu pracodawcy.',
      },
    },
    nl: {
      subject: 'Verificatie van {companyName} is niet gelukt',
      preview: 'Bekijk de reden en pas de bedrijfsgegevens aan.',
      heading: 'Bedrijf niet geverifieerd',
      body: 'We konden {companyName} niet verifiëren. De reden staat hieronder. Pas de bedrijfsgegevens aan en stuur het bedrijf opnieuw ter verificatie in via het werkgeverspaneel.',
      cta: 'Bedrijfsgegevens aanpassen',
      highlight: '{companyName}',
      anonymous: {
        body: 'We konden {companyName} niet verifiëren. Pas de bedrijfsgegevens aan en stuur het bedrijf opnieuw ter verificatie in via het werkgeverspaneel.',
      },
    },
    fr: {
      subject: 'La vérification de {companyName} n’a pas abouti',
      preview: 'Consultez le motif et corrigez les données de l’entreprise.',
      heading: 'Entreprise non vérifiée',
      body: 'Nous n’avons pas pu vérifier {companyName}. Le motif figure ci-dessous. Corrigez les données de l’entreprise et renvoyez-la en vérification depuis l’espace employeur.',
      cta: 'Corriger les données',
      highlight: '{companyName}',
      anonymous: {
        body: 'Nous n’avons pas pu vérifier {companyName}. Corrigez les données de l’entreprise et renvoyez-la en vérification depuis l’espace employeur.',
      },
    },
    en: {
      subject: 'Verification of {companyName} was not successful',
      preview: 'See the reason and update your company details.',
      heading: 'Company not verified',
      body: 'We could not verify {companyName}. The reason is shown below. Update your company details and send the company for verification again from the employer panel.',
      cta: 'Update company details',
      highlight: '{companyName}',
      anonymous: {
        body: 'We could not verify {companyName}. Update your company details and send the company for verification again from the employer panel.',
      },
    },
  },

  companySuspended: {
    pl: {
      subject: 'Firma {companyName} została zawieszona',
      preview: 'Oferty firmy nie są teraz widoczne dla kandydatów.',
      heading: 'Firma zawieszona',
      body: 'Zawiesiliśmy firmę {companyName}. Do czasu wyjaśnienia sprawy nie możesz publikować nowych ofert. Powód podajemy poniżej.',
      cta: 'Przejdź do danych firmy',
      highlight: '{companyName}',
      anonymous: {
        body: 'Zawiesiliśmy firmę {companyName}. Do czasu wyjaśnienia sprawy nie możesz publikować nowych ofert.',
      },
    },
    nl: {
      subject: 'Bedrijf {companyName} is opgeschort',
      preview: 'De vacatures van het bedrijf zijn nu niet zichtbaar voor kandidaten.',
      heading: 'Bedrijf opgeschort',
      body: 'We hebben {companyName} opgeschort. Tot de zaak is opgehelderd, kun je geen nieuwe vacatures publiceren. De reden staat hieronder.',
      cta: 'Naar bedrijfsgegevens',
      highlight: '{companyName}',
      anonymous: {
        body: 'We hebben {companyName} opgeschort. Tot de zaak is opgehelderd, kun je geen nieuwe vacatures publiceren.',
      },
    },
    fr: {
      subject: 'L’entreprise {companyName} a été suspendue',
      preview: 'Les offres de l’entreprise ne sont plus visibles par les candidats.',
      heading: 'Entreprise suspendue',
      body: 'Nous avons suspendu {companyName}. Tant que la situation n’est pas clarifiée, vous ne pouvez pas publier de nouvelles offres. Le motif figure ci-dessous.',
      cta: 'Voir les données de l’entreprise',
      highlight: '{companyName}',
      anonymous: {
        body: 'Nous avons suspendu {companyName}. Tant que la situation n’est pas clarifiée, vous ne pouvez pas publier de nouvelles offres.',
      },
    },
    en: {
      subject: '{companyName} has been suspended',
      preview: 'The company’s jobs are not visible to candidates for now.',
      heading: 'Company suspended',
      body: 'We have suspended {companyName}. Until the matter is resolved, you cannot publish new jobs. The reason is shown below.',
      cta: 'Go to company details',
      highlight: '{companyName}',
      anonymous: {
        body: 'We have suspended {companyName}. Until the matter is resolved, you cannot publish new jobs.',
      },
    },
  },

  teamInvitation: {
    pl: {
      subject: 'Zaproszenie do zespołu firmy {companyName}',
      preview: '{inviterName} zaprasza Cię do zespołu {companyName} w Pracuj.be.',
      heading: 'Zaproszenie do zespołu',
      body: '{inviterName} zaprasza Cię do zespołu firmy {companyName} w Pracuj.be. Zaloguj się na swoje konto pracodawcy i otwórz zakładkę „Zespół”, aby dołączyć albo odrzucić zaproszenie.',
      cta: 'Zobacz zaproszenie',
      highlight: '{companyName}',
      outro: 'Zaproszenie jest ważne 14 dni. Jeśli nie znasz tej firmy, zignoruj tę wiadomość.',
      anonymous: {
        preview: 'Masz zaproszenie do zespołu {companyName} w Pracuj.be.',
        body: 'Masz zaproszenie do zespołu firmy {companyName} w Pracuj.be. Zaloguj się na swoje konto pracodawcy i otwórz zakładkę „Zespół”, aby dołączyć albo odrzucić zaproszenie.',
      },
    },
    nl: {
      subject: 'Uitnodiging voor het team van {companyName}',
      preview: '{inviterName} nodigt je uit voor het team van {companyName} op Pracuj.be.',
      heading: 'Uitnodiging voor het team',
      body: '{inviterName} nodigt je uit voor het team van {companyName} op Pracuj.be. Log in op je werkgeversaccount en open het tabblad ‘Team’ om deel te nemen of de uitnodiging te weigeren.',
      cta: 'Uitnodiging bekijken',
      highlight: '{companyName}',
      outro: 'De uitnodiging is 14 dagen geldig. Ken je dit bedrijf niet? Negeer dan dit bericht.',
      anonymous: {
        preview: 'Je bent uitgenodigd voor het team van {companyName} op Pracuj.be.',
        body: 'Je bent uitgenodigd voor het team van {companyName} op Pracuj.be. Log in op je werkgeversaccount en open het tabblad ‘Team’ om deel te nemen of de uitnodiging te weigeren.',
      },
    },
    fr: {
      subject: 'Invitation à rejoindre l’équipe de {companyName}',
      preview: '{inviterName} vous invite à rejoindre l’équipe de {companyName} sur Pracuj.be.',
      heading: 'Invitation à rejoindre une équipe',
      body: '{inviterName} vous invite à rejoindre l’équipe de {companyName} sur Pracuj.be. Connectez-vous à votre compte employeur et ouvrez l’onglet « Équipe » pour accepter ou refuser l’invitation.',
      cta: 'Voir l’invitation',
      highlight: '{companyName}',
      outro: 'L’invitation est valable 14 jours. Si vous ne connaissez pas cette entreprise, ignorez ce message.',
      anonymous: {
        preview: 'Vous êtes invité(e) à rejoindre l’équipe de {companyName} sur Pracuj.be.',
        body: 'Vous êtes invité(e) à rejoindre l’équipe de {companyName} sur Pracuj.be. Connectez-vous à votre compte employeur et ouvrez l’onglet « Équipe » pour accepter ou refuser l’invitation.',
      },
    },
    en: {
      subject: 'Invitation to join the {companyName} team',
      preview: '{inviterName} invites you to join the {companyName} team on Pracuj.be.',
      heading: 'Team invitation',
      body: '{inviterName} invites you to join the {companyName} team on Pracuj.be. Sign in to your employer account and open the “Team” tab to join or decline the invitation.',
      cta: 'View invitation',
      highlight: '{companyName}',
      outro: 'The invitation is valid for 14 days. If you do not know this company, you can ignore this message.',
      anonymous: {
        preview: 'You have been invited to join the {companyName} team on Pracuj.be.',
        body: 'You have been invited to join the {companyName} team on Pracuj.be. Sign in to your employer account and open the “Team” tab to join or decline the invitation.',
      },
    },
  },

  guestApplicationConfirm: {
    pl: {
      subject: 'Potwierdź aplikację: {jobTitle}',
      preview: 'Potwierdź adres e-mail, aby wysłać aplikację do {companyName}.',
      heading: 'Potwierdź adres e-mail',
      body: 'Otrzymaliśmy Twoją aplikację na ofertę {jobTitle} w firmie {companyName}. Przekażemy ją pracodawcy dopiero po potwierdzeniu, że ten adres e-mail należy do Ciebie.',
      cta: 'Potwierdź i wyślij aplikację',
      highlight: '{jobTitle}',
      outro: 'Link jest ważny 48 godzin. Jeśli to nie Ty wysłałeś(-aś) aplikację, zignoruj tę wiadomość — aplikacja nie trafi do pracodawcy.',
    },
    nl: {
      subject: 'Bevestig je sollicitatie: {jobTitle}',
      preview: 'Bevestig je e-mailadres om je sollicitatie naar {companyName} te sturen.',
      heading: 'Bevestig je e-mailadres',
      body: 'We hebben je sollicitatie voor de vacature {jobTitle} bij {companyName} ontvangen. We sturen ze pas door naar de werkgever nadat je hebt bevestigd dat dit e-mailadres van jou is.',
      cta: 'Bevestigen en sollicitatie versturen',
      highlight: '{jobTitle}',
      outro: 'De link is 48 uur geldig. Heb jij niet gesolliciteerd? Negeer dan dit bericht — de sollicitatie gaat niet naar de werkgever.',
    },
    fr: {
      subject: 'Confirmez votre candidature : {jobTitle}',
      preview: 'Confirmez votre adresse e-mail pour envoyer votre candidature à {companyName}.',
      heading: 'Confirmez votre adresse e-mail',
      body: 'Nous avons reçu votre candidature pour l’offre {jobTitle} chez {companyName}. Nous la transmettrons à l’employeur uniquement après la confirmation que cette adresse e-mail vous appartient.',
      cta: 'Confirmer et envoyer la candidature',
      highlight: '{jobTitle}',
      outro: 'Le lien est valable 48 heures. Si vous n’avez pas postulé, ignorez ce message — la candidature ne sera pas transmise à l’employeur.',
    },
    en: {
      subject: 'Confirm your application: {jobTitle}',
      preview: 'Confirm your email address to send your application to {companyName}.',
      heading: 'Confirm your email address',
      body: 'We received your application for the {jobTitle} job at {companyName}. We will pass it on to the employer only after you confirm that this email address belongs to you.',
      cta: 'Confirm and send application',
      highlight: '{jobTitle}',
      outro: 'The link is valid for 48 hours. If you did not apply, ignore this message — the application will not be sent to the employer.',
    },
  },

  guestApplicationSent: {
    pl: {
      subject: 'Aplikacja wysłana: {jobTitle}',
      preview: 'Twoja aplikacja trafiła do firmy {companyName}.',
      heading: 'Aplikacja wysłana',
      body: 'Twoja aplikacja na ofertę {jobTitle} trafiła do firmy {companyName}. Pracodawca może skontaktować się z Tobą podanym adresem e-mail lub telefonem.\n\nChcesz śledzić status aplikacji? Załóż konto kandydata w Pracuj.be na ten sam adres e-mail (albo zaloguj się) i przypisz do niego tę aplikację.',
      cta: 'Przypisz aplikację do konta',
      highlight: '{jobTitle}',
      outro: 'Link do przypisania aplikacji jest ważny 30 dni i działa dla jednego konta z tym adresem e-mail.',
    },
    nl: {
      subject: 'Sollicitatie verstuurd: {jobTitle}',
      preview: 'Je sollicitatie is bij {companyName} aangekomen.',
      heading: 'Sollicitatie verstuurd',
      body: 'Je sollicitatie voor de vacature {jobTitle} is bij {companyName} aangekomen. De werkgever kan contact met je opnemen via het opgegeven e-mailadres of telefoonnummer.\n\nWil je de status van je sollicitatie volgen? Maak een kandidaat-account aan op Pracuj.be met hetzelfde e-mailadres (of log in) en koppel deze sollicitatie eraan.',
      cta: 'Sollicitatie aan account koppelen',
      highlight: '{jobTitle}',
      outro: 'De koppellink is 30 dagen geldig en werkt voor één account met dit e-mailadres.',
    },
    fr: {
      subject: 'Candidature envoyée : {jobTitle}',
      preview: 'Votre candidature est parvenue à {companyName}.',
      heading: 'Candidature envoyée',
      body: 'Votre candidature pour l’offre {jobTitle} est parvenue à {companyName}. L’employeur peut vous contacter à l’adresse e-mail ou au numéro de téléphone indiqués.\n\nVous voulez suivre le statut de votre candidature ? Créez un compte candidat sur Pracuj.be avec la même adresse e-mail (ou connectez-vous) et rattachez-y cette candidature.',
      cta: 'Rattacher la candidature à mon compte',
      highlight: '{jobTitle}',
      outro: 'Le lien de rattachement est valable 30 jours et fonctionne pour un seul compte avec cette adresse e-mail.',
    },
    en: {
      subject: 'Application sent: {jobTitle}',
      preview: 'Your application has reached {companyName}.',
      heading: 'Application sent',
      body: 'Your application for the {jobTitle} job has reached {companyName}. The employer can contact you using the email address or phone number you provided.\n\nWant to follow the status of your application? Create a candidate account on Pracuj.be with the same email address (or log in) and link this application to it.',
      cta: 'Link application to my account',
      highlight: '{jobTitle}',
      outro: 'The link is valid for 30 days and works for one account with this email address.',
    },
  },

  jobMatch: {
    pl: {
      subject: 'Nowe oferty dla wyszukiwania: {searchName}',
      preview: 'Nowe oferty pasujące do zapisanego wyszukiwania: {count}.',
      heading: 'Nowe oferty dla Ciebie',
      body: 'Pojawiły się nowe oferty pasujące do Twojego zapisanego wyszukiwania „{searchName}”. Liczba nowych ofert: {count}. Poniżej znajdziesz najnowsze z nich.',
      cta: 'Zarządzaj wyszukiwaniami',
      outro: 'Wysyłamy ten alert najwyżej raz na okres wybrany przy wyszukiwaniu. Możesz go wyłączyć albo usunąć wyszukiwanie w panelu kandydata.',
    },
    nl: {
      subject: 'Nieuwe vacatures voor je zoekopdracht: {searchName}',
      preview: 'Nieuwe vacatures voor je opgeslagen zoekopdracht: {count}.',
      heading: 'Nieuwe vacatures voor jou',
      body: 'Er zijn nieuwe vacatures die passen bij je opgeslagen zoekopdracht ‘{searchName}’. Aantal nieuwe vacatures: {count}. Hieronder vind je de nieuwste.',
      cta: 'Zoekopdrachten beheren',
      outro: 'We sturen deze melding hoogstens één keer per gekozen periode. Je kunt ze uitzetten of de zoekopdracht verwijderen in je kandidatenpaneel.',
    },
    fr: {
      subject: 'Nouvelles offres pour votre recherche : {searchName}',
      preview: 'Nouvelles offres pour votre recherche enregistrée : {count}.',
      heading: 'De nouvelles offres pour vous',
      body: 'De nouvelles offres correspondent à votre recherche enregistrée « {searchName} ». Nombre de nouvelles offres : {count}. Voici les plus récentes.',
      cta: 'Gérer les recherches',
      outro: 'Nous envoyons cette alerte au maximum une fois par période choisie. Vous pouvez la désactiver ou supprimer la recherche dans votre espace candidat.',
    },
    en: {
      subject: 'New jobs for your search: {searchName}',
      preview: 'New jobs matching your saved search: {count}.',
      heading: 'New jobs for you',
      body: 'New jobs match your saved search “{searchName}”. Number of new jobs: {count}. The latest ones are listed below.',
      cta: 'Manage searches',
      outro: 'We send this alert at most once per period you chose. You can turn it off or delete the search in your candidate panel.',
    },
  },

  jobExpiring: {
    pl: {
      subject: 'Twoje ogłoszenie wkrótce wygaśnie: {jobTitle}',
      preview: '„{jobTitle}” wygasa {expiryDate}.',
      heading: 'Ogłoszenie wkrótce wygaśnie',
      body: 'Twoje ogłoszenie „{jobTitle}” wygaśnie {expiryDate}. Przedłuż je, aby nadal docierać do kandydatów.',
      cta: 'Przedłuż ogłoszenie',
      highlight: '{expiryDate}',
    },
    nl: {
      subject: 'Je vacature verloopt binnenkort: {jobTitle}',
      preview: '‘{jobTitle}’ verloopt op {expiryDate}.',
      heading: 'Vacature verloopt binnenkort',
      body: 'Je vacature ‘{jobTitle}’ verloopt op {expiryDate}. Verleng ze om kandidaten te blijven bereiken.',
      cta: 'Vacature verlengen',
      highlight: '{expiryDate}',
    },
    fr: {
      subject: 'Votre annonce expire bientôt : {jobTitle}',
      preview: '« {jobTitle} » expire le {expiryDate}.',
      heading: 'Votre annonce expire bientôt',
      body: 'Votre annonce « {jobTitle} » expirera le {expiryDate}. Prolongez-la pour continuer à toucher des candidats.',
      cta: 'Prolonger l’annonce',
      highlight: '{expiryDate}',
    },
    en: {
      subject: 'Your job is expiring soon: {jobTitle}',
      preview: '“{jobTitle}” expires on {expiryDate}.',
      heading: 'Your job is expiring soon',
      body: 'Your job “{jobTitle}” will expire on {expiryDate}. Renew it to keep reaching candidates.',
      cta: 'Renew job',
      highlight: '{expiryDate}',
    },
  },

  payment: {
    pl: {
      subject: 'Potwierdzenie płatności',
      preview: 'Otrzymaliśmy Twoją płatność {amount}.',
      heading: 'Płatność potwierdzona',
      body: 'Dziękujemy! Otrzymaliśmy Twoją płatność. Kwotę oraz szczegóły transakcji znajdziesz poniżej i w swoim panelu.',
      cta: 'Zobacz szczegóły płatności',
      highlight: '{amount}',
    },
    nl: {
      subject: 'Betalingsbevestiging',
      preview: 'We hebben je betaling van {amount} ontvangen.',
      heading: 'Betaling bevestigd',
      body: 'Bedankt! We hebben je betaling ontvangen. Het bedrag en de details van de transactie vind je hieronder en in je dashboard.',
      cta: 'Betaaldetails bekijken',
      highlight: '{amount}',
    },
    fr: {
      subject: 'Confirmation de paiement',
      preview: 'Nous avons reçu votre paiement de {amount}.',
      heading: 'Paiement confirmé',
      body: 'Merci ! Nous avons bien reçu votre paiement. Le montant et les détails de la transaction figurent ci-dessous et dans votre tableau de bord.',
      cta: 'Voir les détails du paiement',
      highlight: '{amount}',
    },
    en: {
      subject: 'Payment confirmation',
      preview: 'We received your payment of {amount}.',
      heading: 'Payment confirmed',
      body: 'Thank you! We have received your payment. The amount and transaction details are below and in your dashboard.',
      cta: 'View payment details',
      highlight: '{amount}',
    },
  },

  invoice: {
    pl: {
      subject: 'Twoja faktura {invoiceNumber}',
      preview: 'Faktura {invoiceNumber} na kwotę {amount}.',
      heading: 'Faktura gotowa do pobrania',
      body: 'Twoja faktura {invoiceNumber} na kwotę {amount} jest gotowa. Pobierz ją, klikając przycisk poniżej.',
      cta: 'Pobierz fakturę',
      highlight: '{invoiceNumber} · {amount}',
    },
    nl: {
      subject: 'Je factuur {invoiceNumber}',
      preview: 'Factuur {invoiceNumber} van {amount}.',
      heading: 'Factuur klaar om te downloaden',
      body: 'Je factuur {invoiceNumber} van {amount} staat klaar. Download ze via de knop hieronder.',
      cta: 'Factuur downloaden',
      highlight: '{invoiceNumber} · {amount}',
    },
    fr: {
      subject: 'Votre facture {invoiceNumber}',
      preview: 'Facture {invoiceNumber} d’un montant de {amount}.',
      heading: 'Facture prête à télécharger',
      body: 'Votre facture {invoiceNumber} d’un montant de {amount} est disponible. Téléchargez-la via le bouton ci-dessous.',
      cta: 'Télécharger la facture',
      highlight: '{invoiceNumber} · {amount}',
    },
    en: {
      subject: 'Your invoice {invoiceNumber}',
      preview: 'Invoice {invoiceNumber} for {amount}.',
      heading: 'Your invoice is ready',
      body: 'Your invoice {invoiceNumber} for {amount} is ready. Download it using the button below.',
      cta: 'Download invoice',
      highlight: '{invoiceNumber} · {amount}',
    },
  },

  supportContact: {
    pl: {
      subject: 'Otrzymaliśmy Twoją wiadomość',
      preview: 'Dziękujemy za kontakt z Pracuj.be.',
      heading: 'Dziękujemy za kontakt',
      body: 'Otrzymaliśmy Twoją wiadomość i wkrótce się z Tobą skontaktujemy. Poniżej znajduje się kopia Twojego zgłoszenia.',
      cta: 'Przejdź do centrum pomocy',
      outro: 'Zwykle odpowiadamy w ciągu jednego dnia roboczego.',
    },
    nl: {
      subject: 'We hebben je bericht ontvangen',
      preview: 'Bedankt voor je bericht aan Pracuj.be.',
      heading: 'Bedankt voor je bericht',
      body: 'We hebben je bericht ontvangen en nemen binnenkort contact met je op. Hieronder vind je een kopie van je bericht.',
      cta: 'Naar het helpcentrum',
      outro: 'Meestal reageren we binnen één werkdag.',
    },
    fr: {
      subject: 'Nous avons bien reçu votre message',
      preview: 'Merci d’avoir contacté Pracuj.be.',
      heading: 'Merci de nous avoir contactés',
      body: 'Nous avons bien reçu votre message et reviendrons vers vous rapidement. Vous trouverez ci-dessous une copie de votre demande.',
      cta: 'Accéder au centre d’aide',
      outro: 'Nous répondons généralement sous un jour ouvrable.',
    },
    en: {
      subject: 'We have received your message',
      preview: 'Thanks for contacting Pracuj.be.',
      heading: 'Thanks for reaching out',
      body: 'We have received your message and will get back to you soon. A copy of your request is below.',
      cta: 'Go to help center',
      outro: 'We usually reply within one business day.',
    },
  },

  reportReceived: {
    pl: {
      subject: 'Przyjęliśmy Twoje zgłoszenie {caseNumber}',
      preview: 'Numer sprawy: {caseNumber}.',
      heading: 'Zgłoszenie przyjęte',
      body: 'Przyjęliśmy Twoje zgłoszenie treści w serwisie Pracuj.be i nadaliśmy mu numer sprawy podany poniżej.\n\nStatus sprawy sprawdzisz przyciskiem poniżej albo na stronie „Status zgłoszenia”, podając numer sprawy i kod dostępu: {accessCode}.',
      cta: 'Sprawdź status sprawy',
      highlight: '{caseNumber}',
      outro: 'Nie przekazujemy Twoich danych autorowi zgłoszonej treści. Nie udostępniaj kodu dostępu innym osobom.',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be wysłano zgłoszenie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je melding {caseNumber} ontvangen',
      preview: 'Dossiernummer: {caseNumber}.',
      heading: 'Melding ontvangen',
      body: 'We hebben je melding over inhoud op Pracuj.be ontvangen en er het dossiernummer hieronder aan gegeven.\n\nDe status van je dossier bekijk je via de knop hieronder of op de pagina ‘Status van je melding’, met het dossiernummer en de toegangscode: {accessCode}.',
      cta: 'Status van je dossier bekijken',
      highlight: '{caseNumber}',
      outro: 'We geven je gegevens niet door aan de auteur van de gemelde inhoud. Deel je toegangscode met niemand.',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een melding met dit e-mailadres is verstuurd.',
    },
    fr: {
      subject: 'Nous avons bien reçu votre signalement {caseNumber}',
      preview: 'Numéro de dossier : {caseNumber}.',
      heading: 'Signalement reçu',
      body: 'Nous avons bien reçu votre signalement de contenu sur Pracuj.be et lui avons attribué le numéro de dossier ci-dessous.\n\nVous pouvez suivre votre dossier avec le bouton ci-dessous ou sur la page « Statut du signalement », à l’aide du numéro de dossier et du code d’accès : {accessCode}.',
      cta: 'Voir le statut du dossier',
      highlight: '{caseNumber}',
      outro: 'Nous ne transmettons pas vos données à l’auteur du contenu signalé. Ne communiquez votre code d’accès à personne.',
      footerNote: 'Vous recevez ce message car un signalement a été envoyé sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have received your report {caseNumber}',
      preview: 'Case number: {caseNumber}.',
      heading: 'Report received',
      body: 'We have received your report about content on Pracuj.be and given it the case number shown below.\n\nYou can check the status of your case with the button below or on the “Report status” page, using the case number and access code: {accessCode}.',
      cta: 'Check case status',
      highlight: '{caseNumber}',
      outro: 'We do not share your details with the author of the reported content. Do not share your access code with anyone.',
      footerNote: 'You are receiving this email because a report was sent on Pracuj.be with this email address.',
    },
  },
  reportDecisionActioned: {
    pl: {
      subject: 'Rozpatrzyliśmy Twoje zgłoszenie {caseNumber}',
      preview: 'Podjęliśmy działania wobec zgłoszonej treści.',
      heading: 'Zgłoszenie rozpatrzone',
      body: 'Rozpatrzyliśmy Twoje zgłoszenie treści w serwisie Pracuj.be i podjęliśmy działania wobec zgłoszonej treści.\n\nStatus sprawy sprawdzisz przyciskiem poniżej, podając numer sprawy i kod dostępu z wiadomości potwierdzającej przyjęcie zgłoszenia.',
      cta: 'Sprawdź status sprawy',
      highlight: '{caseNumber}',
      outro: 'Nie przekazujemy Twoich danych autorowi zgłoszonej treści.',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be wysłano zgłoszenie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je melding {caseNumber} behandeld',
      preview: 'We hebben maatregelen genomen tegen de gemelde inhoud.',
      heading: 'Melding behandeld',
      body: 'We hebben je melding over inhoud op Pracuj.be behandeld en maatregelen genomen tegen de gemelde inhoud.\n\nDe status van je dossier bekijk je via de knop hieronder, met het dossiernummer en de toegangscode uit de ontvangstbevestiging van je melding.',
      cta: 'Status van je dossier bekijken',
      highlight: '{caseNumber}',
      outro: 'We geven je gegevens niet door aan de auteur van de gemelde inhoud.',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een melding met dit e-mailadres is verstuurd.',
    },
    fr: {
      subject: 'Nous avons traité votre signalement {caseNumber}',
      preview: 'Nous avons pris des mesures concernant le contenu signalé.',
      heading: 'Signalement traité',
      body: 'Nous avons traité votre signalement de contenu sur Pracuj.be et pris des mesures concernant le contenu signalé.\n\nVous pouvez suivre votre dossier avec le bouton ci-dessous, à l’aide du numéro de dossier et du code d’accès indiqués dans le message confirmant la réception de votre signalement.',
      cta: 'Voir le statut du dossier',
      highlight: '{caseNumber}',
      outro: 'Nous ne transmettons pas vos données à l’auteur du contenu signalé.',
      footerNote: 'Vous recevez ce message car un signalement a été envoyé sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have handled your report {caseNumber}',
      preview: 'We have taken action on the reported content.',
      heading: 'Report handled',
      body: 'We have handled your report about content on Pracuj.be and taken action on the reported content.\n\nYou can check the status of your case with the button below, using the case number and access code from the email confirming we received your report.',
      cta: 'Check case status',
      highlight: '{caseNumber}',
      outro: 'We do not share your details with the author of the reported content.',
      footerNote: 'You are receiving this email because a report was sent on Pracuj.be with this email address.',
    },
  },

  reportDecisionNoAction: {
    pl: {
      subject: 'Rozpatrzyliśmy Twoje zgłoszenie {caseNumber}',
      preview: 'Po analizie nie podjęliśmy działań wobec zgłoszonej treści.',
      heading: 'Zgłoszenie rozpatrzone',
      body: 'Rozpatrzyliśmy Twoje zgłoszenie treści w serwisie Pracuj.be. Po analizie nie stwierdziliśmy podstaw do działań wobec zgłoszonej treści.\n\nStatus sprawy sprawdzisz przyciskiem poniżej, podając numer sprawy i kod dostępu z wiadomości potwierdzającej przyjęcie zgłoszenia.',
      cta: 'Sprawdź status sprawy',
      highlight: '{caseNumber}',
      outro: 'Jeśli nie zgadzasz się z tym wynikiem, możesz złożyć odwołanie na stronie sprawy, podając numer sprawy {caseNumber} i kod dostępu.',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be wysłano zgłoszenie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je melding {caseNumber} behandeld',
      preview: 'Na onderzoek hebben we geen maatregelen genomen tegen de gemelde inhoud.',
      heading: 'Melding behandeld',
      body: 'We hebben je melding over inhoud op Pracuj.be behandeld. Na onderzoek vonden we geen reden om maatregelen te nemen tegen de gemelde inhoud.\n\nDe status van je dossier bekijk je via de knop hieronder, met het dossiernummer en de toegangscode uit de ontvangstbevestiging van je melding.',
      cta: 'Status van je dossier bekijken',
      highlight: '{caseNumber}',
      outro: 'Ben je het niet eens met deze uitkomst? Je kunt bezwaar maken op de pagina van je dossier, met dossiernummer {caseNumber} en je toegangscode.',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een melding met dit e-mailadres is verstuurd.',
    },
    fr: {
      subject: 'Nous avons traité votre signalement {caseNumber}',
      preview: 'Après examen, nous n’avons pris aucune mesure concernant le contenu signalé.',
      heading: 'Signalement traité',
      body: 'Nous avons traité votre signalement de contenu sur Pracuj.be. Après examen, nous n’avons pas trouvé de motif de prendre des mesures concernant le contenu signalé.\n\nVous pouvez suivre votre dossier avec le bouton ci-dessous, à l’aide du numéro de dossier et du code d’accès indiqués dans le message confirmant la réception de votre signalement.',
      cta: 'Voir le statut du dossier',
      highlight: '{caseNumber}',
      outro: 'Si vous n’êtes pas d’accord avec ce résultat, vous pouvez introduire un recours sur la page de votre dossier, avec le numéro de dossier {caseNumber} et votre code d’accès.',
      footerNote: 'Vous recevez ce message car un signalement a été envoyé sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have handled your report {caseNumber}',
      preview: 'After review, we took no action on the reported content.',
      heading: 'Report handled',
      body: 'We have handled your report about content on Pracuj.be. After review, we found no grounds to take action on the reported content.\n\nYou can check the status of your case with the button below, using the case number and access code from the email confirming we received your report.',
      cta: 'Check case status',
      highlight: '{caseNumber}',
      outro: 'If you disagree with this outcome, you can appeal on your case page using case number {caseNumber} and your access code.',
      footerNote: 'You are receiving this email because a report was sent on Pracuj.be with this email address.',
    },
  },

  moderationJobRemoved: {
    pl: {
      subject: 'Oferta „{jobTitle}” została wycofana decyzją moderacyjną',
      preview: 'Decyzja {decisionReference} — uzasadnienie w treści wiadomości.',
      heading: 'Oferta wycofana z serwisu',
      body: 'Po rozpatrzeniu zgłoszenia wycofaliśmy ofertę „{jobTitle}” firmy {companyName}. Oferta nie jest widoczna dla kandydatów i nie można jej ponownie opublikować, dopóki decyzja obowiązuje.\n\nPodstawa: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nNumer decyzji i ustalone fakty podajemy poniżej. Uzasadnienie znajdziesz też w panelu, w danych firmy.',
      cta: 'Przejdź do danych firmy',
      highlight: '{decisionReference}',
      outro: 'Jeśli nie zgadzasz się z decyzją {decisionReference}, możesz złożyć odwołanie w panelu, w danych firmy.',
    },
    nl: {
      subject: 'De vacature ‘{jobTitle}’ is ingetrokken na een moderatiebeslissing',
      preview: 'Beslissing {decisionReference} — de motivering staat in dit bericht.',
      heading: 'Vacature ingetrokken',
      body: 'Na behandeling van een melding hebben we de vacature ‘{jobTitle}’ van {companyName} ingetrokken. De vacature is niet zichtbaar voor kandidaten en kan niet opnieuw worden gepubliceerd zolang de beslissing geldt.\n\nGrond: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nHet beslissingsnummer en de vastgestelde feiten vind je hieronder. De motivering staat ook in je dashboard, bij de bedrijfsgegevens.',
      cta: 'Naar de bedrijfsgegevens',
      highlight: '{decisionReference}',
      outro: 'Ben je het niet eens met beslissing {decisionReference}? Je kunt bezwaar maken in je dashboard, bij de bedrijfsgegevens.',
    },
    fr: {
      subject: 'L’offre « {jobTitle} » a été retirée par une décision de modération',
      preview: 'Décision {decisionReference} — la motivation figure dans ce message.',
      heading: 'Offre retirée du site',
      body: 'Après examen d’un signalement, nous avons retiré l’offre « {jobTitle} » de l’entreprise {companyName}. L’offre n’est pas visible par les candidats et ne peut pas être republiée tant que la décision s’applique.\n\nFondement : {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nLe numéro de décision et les faits constatés figurent ci-dessous. La motivation est aussi disponible dans votre espace, dans les données de l’entreprise.',
      cta: 'Voir les données de l’entreprise',
      highlight: '{decisionReference}',
      outro: 'Si vous n’êtes pas d’accord avec la décision {decisionReference}, vous pouvez introduire un recours dans votre espace, dans les données de l’entreprise.',
    },
    en: {
      subject: 'The job “{jobTitle}” has been removed by a moderation decision',
      preview: 'Decision {decisionReference} — the statement of reasons is in this email.',
      heading: 'Job removed from the website',
      body: 'After reviewing a report, we removed the job “{jobTitle}” posted by {companyName}. The job is not visible to candidates and cannot be republished while the decision applies.\n\nGround: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nThe decision number and the facts we established are shown below. You can also find the statement of reasons in your dashboard, under company details.',
      cta: 'Go to company details',
      highlight: '{decisionReference}',
      outro: 'If you disagree with decision {decisionReference}, you can appeal in your dashboard, under company details.',
    },
  },

  moderationCompanySuspended: {
    pl: {
      subject: 'Firma {companyName} została zawieszona decyzją moderacyjną',
      preview: 'Decyzja {decisionReference} — uzasadnienie w treści wiadomości.',
      heading: 'Firma zawieszona',
      body: 'Po rozpatrzeniu zgłoszenia zawiesiliśmy firmę {companyName}. Oferty firmy nie są widoczne dla kandydatów, dopóki decyzja obowiązuje.\n\nPodstawa: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nNumer decyzji i ustalone fakty podajemy poniżej. Uzasadnienie znajdziesz też w panelu, w danych firmy.',
      cta: 'Przejdź do danych firmy',
      highlight: '{decisionReference}',
      outro: 'Jeśli nie zgadzasz się z decyzją {decisionReference}, możesz złożyć odwołanie w panelu, w danych firmy.',
    },
    nl: {
      subject: 'Het bedrijf {companyName} is geschorst na een moderatiebeslissing',
      preview: 'Beslissing {decisionReference} — de motivering staat in dit bericht.',
      heading: 'Bedrijf geschorst',
      body: 'Na behandeling van een melding hebben we het bedrijf {companyName} geschorst. De vacatures van het bedrijf zijn niet zichtbaar voor kandidaten zolang de beslissing geldt.\n\nGrond: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nHet beslissingsnummer en de vastgestelde feiten vind je hieronder. De motivering staat ook in je dashboard, bij de bedrijfsgegevens.',
      cta: 'Naar de bedrijfsgegevens',
      highlight: '{decisionReference}',
      outro: 'Ben je het niet eens met beslissing {decisionReference}? Je kunt bezwaar maken in je dashboard, bij de bedrijfsgegevens.',
    },
    fr: {
      subject: 'L’entreprise {companyName} a été suspendue par une décision de modération',
      preview: 'Décision {decisionReference} — la motivation figure dans ce message.',
      heading: 'Entreprise suspendue',
      body: 'Après examen d’un signalement, nous avons suspendu l’entreprise {companyName}. Ses offres ne sont pas visibles par les candidats tant que la décision s’applique.\n\nFondement : {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nLe numéro de décision et les faits constatés figurent ci-dessous. La motivation est aussi disponible dans votre espace, dans les données de l’entreprise.',
      cta: 'Voir les données de l’entreprise',
      highlight: '{decisionReference}',
      outro: 'Si vous n’êtes pas d’accord avec la décision {decisionReference}, vous pouvez introduire un recours dans votre espace, dans les données de l’entreprise.',
    },
    en: {
      subject: 'The company {companyName} has been suspended by a moderation decision',
      preview: 'Decision {decisionReference} — the statement of reasons is in this email.',
      heading: 'Company suspended',
      body: 'After reviewing a report, we suspended the company {companyName}. Its jobs are not visible to candidates while the decision applies.\n\nGround: {groundLabel} — {groundReference}.\n\n{automationLabel}\n\nThe decision number and the facts we established are shown below. You can also find the statement of reasons in your dashboard, under company details.',
      cta: 'Go to company details',
      highlight: '{decisionReference}',
      outro: 'If you disagree with decision {decisionReference}, you can appeal in your dashboard, under company details.',
    },
  },

  moderationRestored: {
    pl: {
      subject: 'Cofnęliśmy decyzję moderacyjną {decisionReference}',
      preview: 'Ograniczenie treści firmy {companyName} zostało cofnięte.',
      heading: 'Ograniczenie cofnięte',
      body: 'Cofnęliśmy decyzję {decisionReference} dotyczącą firmy {companyName}. Treść wraca do stanu sprzed decyzji, chyba że obowiązuje wobec niej inna decyzja.\n\nPowód cofnięcia podajemy poniżej.',
      cta: 'Przejdź do danych firmy',
      highlight: '{decisionReference}',
    },
    nl: {
      subject: 'We hebben moderatiebeslissing {decisionReference} ingetrokken',
      preview: 'De beperking van de inhoud van {companyName} is opgeheven.',
      heading: 'Beperking opgeheven',
      body: 'We hebben beslissing {decisionReference} over het bedrijf {companyName} ingetrokken. De inhoud krijgt weer de status van vóór de beslissing, tenzij er een andere beslissing voor geldt.\n\nDe reden vind je hieronder.',
      cta: 'Naar de bedrijfsgegevens',
      highlight: '{decisionReference}',
    },
    fr: {
      subject: 'Nous avons annulé la décision de modération {decisionReference}',
      preview: 'La restriction du contenu de {companyName} a été levée.',
      heading: 'Restriction levée',
      body: 'Nous avons annulé la décision {decisionReference} concernant l’entreprise {companyName}. Le contenu retrouve son état antérieur à la décision, sauf si une autre décision s’y applique.\n\nLe motif de l’annulation figure ci-dessous.',
      cta: 'Voir les données de l’entreprise',
      highlight: '{decisionReference}',
    },
    en: {
      subject: 'We have reversed moderation decision {decisionReference}',
      preview: 'The restriction on content from {companyName} has been lifted.',
      heading: 'Restriction lifted',
      body: 'We have reversed decision {decisionReference} concerning the company {companyName}. The content returns to its state before the decision, unless another decision applies to it.\n\nThe reason is shown below.',
      cta: 'Go to company details',
      highlight: '{decisionReference}',
    },
  },
  appealReceived: {
    pl: {
      subject: 'Otrzymaliśmy Twoje odwołanie {appealReference}',
      preview: 'Odwołanie od decyzji moderacyjnej ({subjectRef}) czeka na rozpatrzenie.',
      heading: 'Odwołanie przyjęte',
      body: 'Przyjęliśmy Twoje odwołanie od decyzji moderacyjnej ({subjectRef}). Rozpatrzy je człowiek — w miarę możliwości inna osoba niż ta, która podjęła decyzję.\n\nO wyniku poinformujemy Cię e-mailem, razem z uzasadnieniem.',
      cta: 'Zobacz szczegóły',
      highlight: '{appealReference}',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be złożono odwołanie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je bezwaar {appealReference} ontvangen',
      preview: 'Je bezwaar tegen een moderatiebeslissing ({subjectRef}) wacht op behandeling.',
      heading: 'Bezwaar ontvangen',
      body: 'We hebben je bezwaar tegen een moderatiebeslissing ({subjectRef}) ontvangen. Een mens behandelt het — waar mogelijk een andere persoon dan wie de beslissing nam.\n\nWe laten je de uitkomst per e-mail weten, samen met de motivering.',
      cta: 'Details bekijken',
      highlight: '{appealReference}',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een bezwaar met dit e-mailadres is ingediend.',
    },
    fr: {
      subject: 'Nous avons reçu votre recours {appealReference}',
      preview: 'Votre recours contre une décision de modération ({subjectRef}) est en attente d’examen.',
      heading: 'Recours reçu',
      body: 'Nous avons reçu votre recours contre une décision de modération ({subjectRef}). Il sera examiné par une personne — si possible une autre que celle qui a pris la décision.\n\nNous vous communiquerons le résultat par e-mail, avec sa motivation.',
      cta: 'Voir les détails',
      highlight: '{appealReference}',
      footerNote: 'Vous recevez ce message car un recours a été introduit sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have received your appeal {appealReference}',
      preview: 'Your appeal against a moderation decision ({subjectRef}) is awaiting review.',
      heading: 'Appeal received',
      body: 'We have received your appeal against a moderation decision ({subjectRef}). A person will review it — where possible, someone other than the person who made the decision.\n\nWe will email you the outcome, together with the reasons.',
      cta: 'View details',
      highlight: '{appealReference}',
      footerNote: 'You are receiving this email because an appeal was submitted on Pracuj.be with this email address.',
    },
  },

  appealUpheld: {
    pl: {
      subject: 'Rozpatrzyliśmy Twoje odwołanie {appealReference}',
      preview: 'Po ponownym przeglądzie decyzja pozostaje bez zmian.',
      heading: 'Decyzja utrzymana',
      body: 'Rozpatrzyliśmy Twoje odwołanie od decyzji moderacyjnej ({subjectRef}). Po ponownym przeglądzie decyzja pozostaje bez zmian.\n\nUzasadnienie podajemy poniżej.',
      cta: 'Zobacz szczegóły',
      highlight: '{appealReference}',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be złożono odwołanie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je bezwaar {appealReference} behandeld',
      preview: 'Na een nieuwe beoordeling blijft de beslissing ongewijzigd.',
      heading: 'Beslissing gehandhaafd',
      body: 'We hebben je bezwaar tegen een moderatiebeslissing ({subjectRef}) behandeld. Na een nieuwe beoordeling blijft de beslissing ongewijzigd.\n\nDe motivering vind je hieronder.',
      cta: 'Details bekijken',
      highlight: '{appealReference}',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een bezwaar met dit e-mailadres is ingediend.',
    },
    fr: {
      subject: 'Nous avons examiné votre recours {appealReference}',
      preview: 'Après un nouvel examen, la décision est maintenue.',
      heading: 'Décision maintenue',
      body: 'Nous avons examiné votre recours contre une décision de modération ({subjectRef}). Après un nouvel examen, la décision est maintenue.\n\nVous trouverez la motivation ci-dessous.',
      cta: 'Voir les détails',
      highlight: '{appealReference}',
      footerNote: 'Vous recevez ce message car un recours a été introduit sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have reviewed your appeal {appealReference}',
      preview: 'After a new review, the decision stands.',
      heading: 'Decision upheld',
      body: 'We have reviewed your appeal against a moderation decision ({subjectRef}). After a new review, the decision stands.\n\nThe reasons are below.',
      cta: 'View details',
      highlight: '{appealReference}',
      footerNote: 'You are receiving this email because an appeal was submitted on Pracuj.be with this email address.',
    },
  },

  appealReversed: {
    pl: {
      subject: 'Uwzględniliśmy Twoje odwołanie {appealReference}',
      preview: 'Po ponownym przeglądzie zmieniliśmy decyzję.',
      heading: 'Odwołanie uwzględnione',
      body: 'Rozpatrzyliśmy Twoje odwołanie od decyzji moderacyjnej ({subjectRef}) i je uwzględniliśmy — decyzja została zmieniona.\n\nUzasadnienie podajemy poniżej.',
      cta: 'Zobacz szczegóły',
      highlight: '{appealReference}',
      footerNote: 'Otrzymujesz tę wiadomość, ponieważ w serwisie Pracuj.be złożono odwołanie z tym adresem e-mail.',
    },
    nl: {
      subject: 'We hebben je bezwaar {appealReference} gegrond verklaard',
      preview: 'Na een nieuwe beoordeling hebben we de beslissing gewijzigd.',
      heading: 'Bezwaar gegrond',
      body: 'We hebben je bezwaar tegen een moderatiebeslissing ({subjectRef}) behandeld en gegrond verklaard — de beslissing is gewijzigd.\n\nDe motivering vind je hieronder.',
      cta: 'Details bekijken',
      highlight: '{appealReference}',
      footerNote: 'Je ontvangt dit bericht omdat op Pracuj.be een bezwaar met dit e-mailadres is ingediend.',
    },
    fr: {
      subject: 'Nous avons fait droit à votre recours {appealReference}',
      preview: 'Après un nouvel examen, nous avons modifié la décision.',
      heading: 'Recours accueilli',
      body: 'Nous avons examiné votre recours contre une décision de modération ({subjectRef}) et y avons fait droit — la décision a été modifiée.\n\nVous trouverez la motivation ci-dessous.',
      cta: 'Voir les détails',
      highlight: '{appealReference}',
      footerNote: 'Vous recevez ce message car un recours a été introduit sur Pracuj.be avec cette adresse e-mail.',
    },
    en: {
      subject: 'We have upheld your appeal {appealReference}',
      preview: 'After a new review, we changed the decision.',
      heading: 'Appeal upheld',
      body: 'We have reviewed your appeal against a moderation decision ({subjectRef}) and upheld it — the decision has been changed.\n\nThe reasons are below.',
      cta: 'View details',
      highlight: '{appealReference}',
      footerNote: 'You are receiving this email because an appeal was submitted on Pracuj.be with this email address.',
    },
  },
  /**
   * Zawiadomienie osób o naruszeniu danych (#490) — szablon techniczny: temat i treść wpisuje
   * administrator w języku odbiorcy (payload), szablon dodaje tylko identyfikator i link.
   */
  breachNotice: {
    pl: {
      subject: '{noticeSubject}',
      preview: '{noticeSubject}',
      heading: '{noticeSubject}',
      body: '{noticeText}',
      cta: 'Przejdź do ustawień konta',
      outro: 'Identyfikator zdarzenia: {incidentReference}. Podaj go, jeśli kontaktujesz się z nami w tej sprawie.',
    },
    nl: {
      subject: '{noticeSubject}',
      preview: '{noticeSubject}',
      heading: '{noticeSubject}',
      body: '{noticeText}',
      cta: 'Naar je accountinstellingen',
      outro: 'Referentie van het incident: {incidentReference}. Vermeld deze als je hierover contact met ons opneemt.',
    },
    fr: {
      subject: '{noticeSubject}',
      preview: '{noticeSubject}',
      heading: '{noticeSubject}',
      body: '{noticeText}',
      cta: 'Accéder aux paramètres du compte',
      outro: 'Référence de l’incident : {incidentReference}. Indiquez-la si vous nous contactez à ce sujet.',
    },
    en: {
      subject: '{noticeSubject}',
      preview: '{noticeSubject}',
      heading: '{noticeSubject}',
      body: '{noticeText}',
      cta: 'Go to account settings',
      outro: 'Incident reference: {incidentReference}. Please quote it if you contact us about this.',
    },
  },
};

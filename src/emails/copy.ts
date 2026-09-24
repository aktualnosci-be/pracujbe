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
  'jobExpiring',
  'payment',
  'invoice',
  'supportContact',
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
    buttonFallback: 'Jeśli przycisk nie działa, skopiuj i wklej ten adres do przeglądarki:',
  },
  nl: {
    tagline: 'Werk in België zonder cv en zonder taaldrempels.',
    footerNote: 'Je ontvangt dit bericht omdat je een account hebt op Pracuj.be.',
    rights: '© {year} Pracuj.be. Alle rechten voorbehouden.',
    help: 'Help',
    privacy: 'Privacy',
    buttonFallback: 'Werkt de knop niet? Kopieer en plak deze link in je browser:',
  },
  fr: {
    tagline: 'Du travail en Belgique sans CV ni barrière de langue.',
    footerNote: 'Vous recevez ce message car vous avez un compte sur Pracuj.be.',
    rights: '© {year} Pracuj.be. Tous droits réservés.',
    help: 'Aide',
    privacy: 'Confidentialité',
    buttonFallback: 'Le bouton ne fonctionne pas ? Copiez-collez ce lien dans votre navigateur :',
  },
  en: {
    tagline: 'Work in Belgium without a CV or language barriers.',
    footerNote: 'You are receiving this email because you have an account on Pracuj.be.',
    rights: '© {year} Pracuj.be. All rights reserved.',
    help: 'Help',
    privacy: 'Privacy',
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
};

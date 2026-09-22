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
  'newApplication',
  'applicationViewed',
  'contactInvitation',
  'newMessage',
  'jobOffer',
  'offerAccepted',
  'offerDeclined',
  'statusChanged',
  'jobPublished',
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
  { title: string; jobTitle: string; companyName: string; salary: string }
> = {
  pl: {
    title: 'Paszport pracy',
    jobTitle: 'Stanowisko',
    companyName: 'Firma',
    salary: 'Wynagrodzenie',
  },
  nl: {
    title: 'Werkpaspoort',
    jobTitle: 'Functie',
    companyName: 'Bedrijf',
    salary: 'Loon',
  },
  fr: {
    title: 'Passeport emploi',
    jobTitle: 'Poste',
    companyName: 'Entreprise',
    salary: 'Rémunération',
  },
  en: {
    title: 'Job passport',
    jobTitle: 'Position',
    companyName: 'Company',
    salary: 'Salary',
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

  newApplication: {
    pl: {
      subject: 'Nowe zgłoszenie na ogłoszenie: {jobTitle}',
      preview: '{candidateName} zgłosił(a) się na Twoje ogłoszenie.',
      heading: 'Nowe zgłoszenie',
      body: '{candidateName} zgłosił(a) się na Twoje ogłoszenie „{jobTitle}”. Zobacz profil kandydata i zdecyduj o kolejnych krokach.',
      cta: 'Zobacz zgłoszenie',
      highlight: '{jobTitle}',
    },
    nl: {
      subject: 'Nieuwe sollicitatie op: {jobTitle}',
      preview: '{candidateName} heeft gesolliciteerd op je vacature.',
      heading: 'Nieuwe sollicitatie',
      body: '{candidateName} heeft gesolliciteerd op je vacature ‘{jobTitle}’. Bekijk het profiel van de kandidaat en bepaal de volgende stap.',
      cta: 'Sollicitatie bekijken',
      highlight: '{jobTitle}',
    },
    fr: {
      subject: 'Nouvelle candidature pour : {jobTitle}',
      preview: '{candidateName} a postulé à votre offre.',
      heading: 'Nouvelle candidature',
      body: '{candidateName} a postulé à votre offre « {jobTitle} ». Consultez le profil du candidat et décidez de la suite.',
      cta: 'Voir la candidature',
      highlight: '{jobTitle}',
    },
    en: {
      subject: 'New application for: {jobTitle}',
      preview: '{candidateName} applied to your job.',
      heading: 'New application',
      body: '{candidateName} applied to your job “{jobTitle}”. Review the candidate’s profile and decide on the next steps.',
      cta: 'View application',
      highlight: '{jobTitle}',
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
    },
    nl: {
      subject: 'Nieuw bericht van {senderName}',
      preview: '{senderName} heeft je een bericht gestuurd.',
      heading: 'Nieuw bericht',
      body: '{senderName} heeft je een bericht gestuurd op Pracuj.be. Lees het en reageer rechtstreeks in je dashboard.',
      cta: 'Bericht lezen',
      highlight: '{senderName}',
    },
    fr: {
      subject: 'Nouveau message de {senderName}',
      preview: '{senderName} vous a envoyé un message.',
      heading: 'Nouveau message',
      body: '{senderName} vous a envoyé un message sur Pracuj.be. Lisez-le et répondez directement depuis votre tableau de bord.',
      cta: 'Lire le message',
      highlight: '{senderName}',
    },
    en: {
      subject: 'New message from {senderName}',
      preview: '{senderName} sent you a message.',
      heading: 'New message',
      body: '{senderName} sent you a message on Pracuj.be. Read it and reply directly from your dashboard.',
      cta: 'Read message',
      highlight: '{senderName}',
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
    },
    nl: {
      subject: '{candidateName} heeft je aanbod aanvaard',
      preview: 'Goed nieuws over het aanbod ‘{jobTitle}’.',
      heading: 'Aanbod aanvaard',
      body: '{candidateName} heeft je jobaanbod voor ‘{jobTitle}’ aanvaard. Neem contact op om de start te regelen.',
      cta: 'Details bekijken',
      highlight: '{candidateName}',
    },
    fr: {
      subject: '{candidateName} a accepté votre offre',
      preview: 'Bonne nouvelle concernant l’offre « {jobTitle} ».',
      heading: 'Offre acceptée',
      body: '{candidateName} a accepté votre offre pour le poste « {jobTitle} ». Contactez-le/la pour organiser le démarrage.',
      cta: 'Voir les détails',
      highlight: '{candidateName}',
    },
    en: {
      subject: '{candidateName} accepted your offer',
      preview: 'Good news about the “{jobTitle}” offer.',
      heading: 'Offer accepted',
      body: '{candidateName} accepted your job offer for “{jobTitle}”. Get in touch to arrange the start.',
      cta: 'View details',
      highlight: '{candidateName}',
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
    },
    nl: {
      subject: '{candidateName} heeft je aanbod afgewezen',
      preview: 'Update over het aanbod ‘{jobTitle}’.',
      heading: 'Aanbod afgewezen',
      body: '{candidateName} heeft je aanbod voor ‘{jobTitle}’ helaas afgewezen. Bekijk andere kandidaten die bij deze vacature passen.',
      cta: 'Kandidaten bekijken',
      highlight: '{candidateName}',
    },
    fr: {
      subject: '{candidateName} a décliné votre offre',
      preview: 'Mise à jour de l’offre « {jobTitle} ».',
      heading: 'Offre déclinée',
      body: '{candidateName} a malheureusement décliné votre offre pour « {jobTitle} ». Vous pouvez consulter d’autres candidats correspondant à cette annonce.',
      cta: 'Voir les candidats',
      highlight: '{candidateName}',
    },
    en: {
      subject: '{candidateName} declined your offer',
      preview: 'Update on the “{jobTitle}” offer.',
      heading: 'Offer declined',
      body: '{candidateName} unfortunately declined your offer for “{jobTitle}”. You can review other candidates matching this listing.',
      cta: 'View candidates',
      highlight: '{candidateName}',
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
    },
    nl: {
      subject: 'Statuswijziging sollicitatie: {jobTitle}',
      preview: 'De status van je sollicitatie is nu: {status}.',
      heading: 'Statuswijziging sollicitatie',
      body: 'De status van je sollicitatie voor ‘{jobTitle}’ bij {companyName} is bijgewerkt.',
      cta: 'Sollicitatie bekijken',
      highlight: '{status}',
    },
    fr: {
      subject: 'Changement de statut de candidature : {jobTitle}',
      preview: 'Le statut de votre candidature est désormais : {status}.',
      heading: 'Changement de statut',
      body: 'Le statut de votre candidature pour « {jobTitle} » chez {companyName} a été mis à jour.',
      cta: 'Voir la candidature',
      highlight: '{status}',
    },
    en: {
      subject: 'Application status update: {jobTitle}',
      preview: 'Your application status is now: {status}.',
      heading: 'Application status update',
      body: 'The status of your application for “{jobTitle}” at {companyName} has been updated.',
      cta: 'View application',
      highlight: '{status}',
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

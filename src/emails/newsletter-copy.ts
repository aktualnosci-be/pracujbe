import type { Locale } from "@/i18n/routing";

export interface NewsletterCopy {
  subject: string;
  preview: string;
  heading: string;
  intro: string;
  passport: string;
  location: string;
  salary: string;
  viewJob: string;
  viewAll: string;
  preferences: string;
  preferencesNote: string;
}

export const newsletterCopy: Record<Locale, NewsletterCopy> = {
  pl: {
    subject: "Nowe oferty pracy w Belgii",
    preview: "Sprawdź stanowiska, miejsca i warunki pracy w Belgii.",
    heading: "Nowe oferty. Twój kolejny krok.",
    intro:
      "Sprawdź, gdzie przydadzą się Twoje umiejętności. Porównaj miejsca i warunki pracy.",
    passport: "Paszport pracy",
    location: "Miejsce",
    salary: "Wynagrodzenie",
    viewJob: "Zobacz ofertę",
    viewAll: "Przeglądaj wszystkie oferty",
    preferences: "Ustawienia powiadomień",
    preferencesNote:
      "Tutaj możesz zmienić lub wyłączyć powiadomienia o ofertach:",
  },
  nl: {
    subject: "Nieuwe jobs in België",
    preview: "Bekijk functies, locaties en arbeidsvoorwaarden in België.",
    heading: "Nieuwe jobs. Jouw volgende stap.",
    intro:
      "Ontdek waar jouw vaardigheden van pas komen. Vergelijk locaties en arbeidsvoorwaarden.",
    passport: "Werkpaspoort",
    location: "Locatie",
    salary: "Loon",
    viewJob: "Bekijk de job",
    viewAll: "Bekijk alle jobs",
    preferences: "Meldingsinstellingen",
    preferencesNote: "Hier kun je jobmeldingen wijzigen of uitschakelen:",
  },
  fr: {
    subject: "Nouvelles offres d’emploi en Belgique",
    preview:
      "Découvrez les postes, les lieux et les conditions de travail en Belgique.",
    heading: "De nouvelles offres. Votre prochaine étape.",
    intro:
      "Découvrez où vos compétences sont recherchées. Comparez les lieux et les conditions de travail.",
    passport: "Passeport emploi",
    location: "Lieu",
    salary: "Rémunération",
    viewJob: "Voir l’offre",
    viewAll: "Voir toutes les offres",
    preferences: "Paramètres des notifications",
    preferencesNote:
      "Vous pouvez modifier ou désactiver les alertes emploi ici :",
  },
  en: {
    subject: "New jobs in Belgium",
    preview: "Explore roles, locations and working conditions in Belgium.",
    heading: "New jobs. Your next step.",
    intro:
      "See where your skills are needed. Compare locations and working conditions.",
    passport: "Job passport",
    location: "Location",
    salary: "Salary",
    viewJob: "View job",
    viewAll: "Browse all jobs",
    preferences: "Notification settings",
    preferencesNote: "You can change or turn off job notifications here:",
  },
};

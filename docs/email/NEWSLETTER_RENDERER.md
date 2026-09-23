# Renderer newslettera — granica fundamentu

`src/emails/newsletter.tsx` renderuje markowy HTML oraz równoległy `text/plain`
do podglądu i dalszej integracji. Oba warianty otrzymują te same 1–3 oferty,
język odbiorcy, linki do ofert i ustawień oraz pomijają niepodaną stawkę.
Nie wysyła wiadomości, nie wybiera odbiorców i nie jest gotowym kontraktem transportu.
Typ wyniku ma stałe `transportReady: false`, aby tej granicy nie dało się przeoczyć.

Wyniku renderera **nie wolno przekazać do Resend, outboxa ani innego transportu**,
dopóki issue #45 nie wdroży i nie przetestuje wszystkich poniższych elementów:

- ponownej kontroli aktualnej zgody odbiorcy bezpośrednio przed wysyłką,
- indywidualnego adresu one-click unsubscribe oraz nagłówków RFC 8058,
- prawdziwej tożsamości i adresu pocztowego nadawcy,
- testów w rzeczywistych klientach pocztowych dla HTML i `text/plain`.

Guard `assertRenderableJobs` dopuszcza wyłącznie 1–3 niedemonstracyjne oferty,
bez placeholderów, z bezpiecznym publicznym slugiem i językiem zgodnym z językiem
wiadomości. Jest to ochrona wejścia renderera, a nie substytut kontroli zgód #45.

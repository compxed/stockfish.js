# Ręczny test wydania na Chess.com

To paczka testowa, nie nowe wydanie. Silniki pochodzą z buildu AWS opartego na
oficjalnym Stockfish.js 19 z naszymi poprawkami. Nie trzeba ich samodzielnie
budować. Diagnostyka nie wchodzi do zwykłego rozszerzenia.

## Instalacja w Chrome

1. Wyłącz poprzednie rozszerzenie „Stockfish 19 for Chess.com Analysis”, jeśli
   jest zainstalowane. Nie uruchamiaj obu rozszerzeń naraz.
2. Rozpakuj ZIP. Otwórz `chrome://extensions`, włącz tryb programisty i wybierz
   **Załaduj rozpakowane**. Wskaż katalog zawierający `manifest.json`.
3. Otwórz <https://www.chess.com/analysis> w nowej karcie lub przeładuj już
   otwartą kartę. Testy wykonuj wyłącznie w analizie, nie podczas gry.

## Dwa przebiegi

Panel w prawym górnym rogu pokazuje tryb. Można go zwinąć.

1. Przełącz na **silnik Chess.com**. Strona przeładuje się. W tym trybie
   podmiana jest całkowicie wyłączona; działa tylko rejestrator testu.
2. Włącz lokalną analizę pozycji. Sprawdź, że pojawiają się ocena i wariant.
3. Załaduj partię, szybko przewiń około 20 półruchów w przód i w tył, po czym
   zatrzymaj się na wybranej pozycji. Sprawdź, że analiza aktualizuje się dla
   pozycji, którą rzeczywiście widać na szachownicy.
4. Wstrzymaj i wznów analizę. Przeładuj stronę i ponownie włącz analizę.
5. Zaznacz tylko punkty, które rzeczywiście przeszły, i kliknij **Eksportuj JSON**.
6. Przełącz na **nasz SF19** i powtórz te same kroki na tej samej partii.
   Po uruchomieniu analizy musi pojawić się dolny zielony znacznik
   **SF19 override active**. Samo **SF19: ready** nie potwierdza podmiany.
7. Wyeksportuj drugi JSON i przekaż oba pliki do oceny.

Jeśli Chess.com pozwala zmienić liczbę wątków, warto powtórzyć przebieg naszego
silnika dla jednego i kilku wątków, eksportując oddzielny raport dla każdej
konfiguracji. Raport pokaże żądane `Threads` i wykryte silniki. Jeden wątek nie
musi oznaczać osobnego wariantu single-threaded WASM.

Podmiana dotyczy tylko lokalnego Stockfisha **lite**. Pełne NNUE, Torch i inne
silniki zostają bez zmian. Jeżeli wybrany silnik nie jest lite, nie traktuj
braku podmiany jako pozytywnego wyniku testu. Zanotuj, co było wybrane.

Jeżeli wystąpi zacięcie, błąd albo fallback, również wyeksportuj raport i opisz
ostatnią czynność. Nie trzeba otwierać konsoli. Jeśli nic nie zostanie wykryte,
sprawdź, czy lokalna analiza jest rzeczywiście włączona.

## Co jest w raporcie

Raport zawiera wersję przeglądarki, izolację originu, nazwy silników z UCI,
URL-e skryptów Stockfisha bez query/hash, liczniki komend i odpowiedzi,
ostatnią głębokość/ocenę/bestmove, błędy Workerów oraz ręczne potwierdzenia.
Nie rejestruje FEN-ów, całej partii, wariantów PV, loginu ani URL-a partii.

Eksport próbuje dodatkowo pobrać wykryte skrypty Stockfisha z Chess.com i
policzyć ich SHA-256. Hash identyfikuje JavaScript pobrany przy eksporcie, nie WASM ani całe
źródła silnika. Nie dowodzi, że publiczny upstream jest identyczny z buildem
strony. Raport pozostaje lokalnym plikiem; nie jest automatycznie wysyłany.
Błędy zawierają komunikaty skryptów strony — przed udostępnieniem możesz
przejrzeć JSON.

To test funkcjonalny. Czasy i głębokości nie są benchmarkiem szybkości ani
podstawą deklarowania przewagi nad Chess.com. Ręczne potwierdzenie aktualnej
pozycji jest konieczne — same odpowiedzi UCI nie dowodzą jej poprawności.

## Złożenie paczki testowej ze źródeł

```sh
node tools/chesscom-analysis-override/manual-test/build.js \
  --engine-dir bin --engine-revision FULL_ENGINE_BUILD_COMMIT
```

Builder zapisuje bazowy build w `../dist` i paczkę testową w `manual-test/dist`.
Kod produkcyjnego rozszerzenia i silników nie jest zmieniany. `TEST-BUILD.json`
oddzielnie zapisuje rewizję źródeł narzędzia i rewizję buildu silników oraz
hash każdego pliku silnika w paczce.
Builder wymaga lokalnego repozytorium z refem `upstream/master` i zmianami
zapisanymi w commitach. Paczka zawiera odpowiadające jej źródła w `SOURCE.tar.gz`.

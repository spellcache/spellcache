package io.github.spellcache.scanner;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Texte d'une carte lu par la reconnaissance, ramené à ce que le serveur sait
 * chercher : code de set, numéro de collection et langue imprimés en bas à
 * gauche des cartes récentes, et les lignes du haut, candidates au nom.
 *
 * Bas de carte depuis 2014 (deux lignes, l'ordre des éléments varie selon
 * l'époque) :
 *
 *   123/280 R            R 0123
 *   M19 • EN  Artiste    MKM • EN  Artiste
 *
 * Pur Java, sans dépendance Android : testé par `CardTextParserTest`.
 */
public final class CardTextParser {

    /** Une ligne reconnue, avec sa boîte dans l'image (pixels). */
    public static final class TextLine {
        final String text;
        final int left;
        final int top;
        final int right;
        final int bottom;

        public TextLine(String text, int left, int top, int right, int bottom) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    // Langues imprimées à côté du code de set.
    private static final Set<String> LANGUAGES = new HashSet<>(Arrays.asList(
        "EN", "FR", "DE", "IT", "ES", "SP", "PT", "JP", "JA", "KO", "RU", "CS", "CT", "PH", "ZHS", "ZHT"
    ));
    private static final Pattern SET_CODE = Pattern.compile("[A-Z0-9]{3,5}");
    private static final Pattern HAS_LETTER = Pattern.compile(".*[A-Z].*");
    // Un O lu à la place d'un zéro reste candidat, le serveur le corrige.
    private static final Pattern COLLECTOR_NUMBER = Pattern.compile("[0-9O]{1,4}[A-Z]?(/[0-9O]{1,4})?");
    private static final Pattern HAS_DIGIT = Pattern.compile(".*[0-9].*");
    private static final Pattern TOKEN_SEPARATOR = Pattern.compile("[^A-Z0-9/]+");

    static final int MAX_NAMES = 3;
    private static final int MIN_NAME_LETTERS = 3;

    private CardTextParser() {}

    /** Une carte seule dans les lignes données (mode Cadre : lignes du cadre). */
    public static ScanReading parse(List<TextLine> lines) {
        return parse(lines, null);
    }

    /**
     * Mode Auto : l'image entière, où d'autres cartes ou objets portent du
     * texte. La ligne de set la plus proche du centre de l'image désigne la
     * carte visée ; son numéro est juste au-dessus, son nom en haut de la même
     * colonne de texte (bord gauche à moins de `columnTolerance` pixels de
     * celui de la ligne de set).
     */
    public static ScanReading parseAround(List<TextLine> lines, int centerX, int centerY, int columnTolerance) {
        return parse(lines, new int[] {centerX, centerY, columnTolerance});
    }

    /** Lignes lisibles comme du texte : peu nombreuses, l'image est sans doute de travers. */
    public static int readableLines(List<TextLine> lines) {
        int count = 0;
        for (TextLine line : lines) {
            if (looksLikeName(line.text.trim())) count++;
        }
        return count;
    }

    private static ScanReading parse(List<TextLine> lines, int[] anchor) {
        List<TextLine> sorted = new ArrayList<>(lines);
        Collections.sort(sorted, (a, b) -> Integer.compare(a.top, b.top));

        String setCode = null;
        String language = null;
        String number = null;
        TextLine setLine = null;
        boolean token = false;
        long bestDistance = Long.MAX_VALUE;

        // Sans ancre, du bas vers le haut : la ligne du set est au pied de la
        // carte, une paire de mots du texte de règles (« put it ») ne doit pas
        // passer avant elle. Avec ancre, la plus proche du centre.
        for (int index = sorted.size() - 1; index >= 0; index--) {
            TextLine line = sorted.get(index);
            String[] tokens = tokensOf(line.text);
            for (int i = 0; i + 1 < tokens.length; i++) {
                if (!isSetCode(tokens[i]) || !LANGUAGES.contains(tokens[i + 1])) continue;
                // En tête de ligne, après au plus le numéro et la rareté :
                // « copy it », « put it » du texte de règles ne passent pas.
                if (!onlyNumberOrRarityBefore(tokens, i)) break;
                long distance = anchor == null ? 0 : distanceTo(line, anchor);
                if (setLine == null || distance < bestDistance) {
                    bestDistance = distance;
                    setCode = tokens[i];
                    language = tokens[i + 1];
                    setLine = line;
                    // Numéro sur la même ligne quand la reconnaissance a
                    // fusionné les deux.
                    String[] before = Arrays.copyOfRange(tokens, 0, i);
                    number = numberIn(before);
                    token = hasTokenRarity(before);
                }
                break;
            }
            if (setLine != null && anchor == null) break;
        }

        if (setLine != null && number == null) {
            TextLine numberLine = numberLineAbove(sorted, setLine);
            if (numberLine != null) {
                String[] tokens = tokensOf(numberLine.text);
                number = numberIn(tokens);
                token = token || hasTokenRarity(tokens);
            }
        }
        // Sans ligne de set : le numéro des cartes de 2008 à 2014.
        if (setLine == null) number = oldNumberIn(sorted);

        List<String> names = new ArrayList<>();
        for (TextLine line : sorted) {
            if (names.size() == MAX_NAMES) break;
            if (line == setLine) continue;
            if (anchor != null && setLine != null
                && (line.top >= setLine.top || Math.abs(line.left - setLine.left) > anchor[2])) continue;
            String text = line.text.trim();
            if (looksLikeName(text)) names.add(text);
        }

        return new ScanReading(setCode, number, language, names, token);
    }

    private static boolean onlyNumberOrRarityBefore(String[] tokens, int index) {
        for (int j = 0; j < index; j++) {
            String token = tokens[j];
            boolean rarity = token.length() == 1 && Character.isLetter(token.charAt(0));
            if (!rarity && numberIn(new String[] {token}) == null) return false;
        }
        return true;
    }

    private static long distanceTo(TextLine line, int[] anchor) {
        long dx = (line.left + line.right) / 2 - anchor[0];
        long dy = (line.top + line.bottom) / 2 - anchor[1];
        return dx * dx + dy * dy;
    }

    private static String[] tokensOf(String text) {
        String upper = text.toUpperCase(Locale.ROOT).trim();
        if (upper.isEmpty()) return new String[0];
        return TOKEN_SEPARATOR.split(upper);
    }

    private static boolean isSetCode(String token) {
        return SET_CODE.matcher(token).matches() && HAS_LETTER.matcher(token).matches();
    }

    // Premier jeton qui a la forme d'un numéro (chiffres, avec au moins un
    // vrai chiffre : un `O` seul est une lettre de rareté ou du bruit).
    // Lettre de rareté collée au numéro par la reconnaissance (`RO162`).
    private static final Pattern RARITY_PREFIX = Pattern.compile("^[CURMSLTP](?=[0-9O]{3,4}[A-Z]?$)");

    private static String numberIn(String[] tokens) {
        for (String raw : tokens) {
            String token = RARITY_PREFIX.matcher(raw).replaceFirst("");
            if (COLLECTOR_NUMBER.matcher(token).matches() && HAS_DIGIT.matcher(token).matches()) {
                return token;
            }
        }
        return null;
    }

    // Numéro sur la ligne juste au-dessus, dans la même colonne de texte.
    // La reconnaissance coupe souvent cette ligne en morceaux (`R 0162` et
    // `FFVIII`) : le plus proche qui porte un numéro.
    private static TextLine numberLineAbove(List<TextLine> sorted, TextLine target) {
        int height = Math.max(1, target.bottom - target.top);
        List<TextLine> candidates = new ArrayList<>();
        for (TextLine line : sorted) {
            if (line == target || line.top >= target.top) continue;
            boolean overlaps = line.left < target.right && target.left < line.right;
            int gap = target.top - line.bottom;
            if (overlaps && gap <= height * 2) candidates.add(line);
        }
        Collections.sort(candidates, (a, b) -> Integer.compare(b.top, a.top));
        for (TextLine line : candidates) {
            if (numberIn(tokensOf(line.text)) != null) return line;
        }
        return null;
    }

    // Rareté `T` des jetons, seule (`T 0003`) ou collée au numéro (`T0003`).
    private static final Pattern TOKEN_RARITY = Pattern.compile("T|T[0-9O]{3,4}");

    private static boolean hasTokenRarity(String[] tokens) {
        for (String token : tokens) {
            if (TOKEN_RARITY.matcher(token).matches()) return true;
        }
        return false;
    }

    // Numéro des cartes de 2008 à 2014 : `51/264` (ou `51a/264`) dans la ligne
    // du copyright, sans code de set. Un total d'au moins 20 cartes et un
    // numéro qui ne le dépasse pas écartent force/endurance (`3/2`).
    private static final Pattern OLD_NUMBER = Pattern.compile("([0-9O]{1,3})([A-Z]?)/([0-9O]{2,3})");

    private static String oldNumberIn(List<TextLine> sorted) {
        for (int index = sorted.size() - 1; index >= 0; index--) {
            for (String token : tokensOf(sorted.get(index).text)) {
                java.util.regex.Matcher matcher = OLD_NUMBER.matcher(token);
                if (!matcher.matches()) continue;
                int number = Integer.parseInt(matcher.group(1).replace('O', '0'));
                int total = Integer.parseInt(matcher.group(3).replace('O', '0'));
                if (total >= 20 && number >= 1 && number <= total) return token;
            }
        }
        return null;
    }

    private static boolean looksLikeName(String text) {
        int letters = 0;
        int others = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isLetter(c)) letters++;
            else if (!Character.isWhitespace(c) && c != '\'' && c != '’' && c != ',' && c != '-') others++;
        }
        return letters >= MIN_NAME_LETTERS && others * 3 <= letters;
    }
}

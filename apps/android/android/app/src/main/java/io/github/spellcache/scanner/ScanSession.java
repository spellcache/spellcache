package io.github.spellcache.scanner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Mode rafale : la caméra reste ouverte et chaque carte reconnue rejoint la
 * pile. Une lecture n'est demandée au serveur qu'une fois stable (la même
 * sur deux images de suite) et une seule fois par texte lu. Une carte qui
 * reste dans le cadre n'est comptée qu'une fois : la même carte ne recompte
 * qu'après avoir disparu de plusieurs images de suite (sortie du champ), ou
 * après une autre carte. Compté en images et non en temps : l'analyse peut
 * ne traiter qu'une image par seconde. Le nom
 * ne sert qu'à défaut du bas de carte, et une carte comptée par son nom puis
 * lue par son numéro devient cette impression exacte, sans second exemplaire.
 *
 * Pur Java, appelé depuis un seul fil : testé par `ScanSessionTest`.
 */
public final class ScanSession {

    /** Carte du catalogue rendue par le serveur pour une lecture. */
    public static final class Match {
        public final String cardId;
        public final String name;
        public final String setCode;
        public final String collectorNumber;
        public final boolean exact;
        public final String language;
        /** Icône du set (SVG de Scryfall), `null` si inconnue. */
        public final String setIconUri;
        /** Nom complet du set, `null` si inconnu. */
        public final String setName;
        /** Finitions de l'impression (`nonfoil`, `foil`…), vides si inconnues. */
        public final List<String> finishes;

        public Match(String cardId, String name, String setCode, String collectorNumber, boolean exact, String language) {
            this(cardId, name, setCode, collectorNumber, exact, language, null, null, Collections.<String>emptyList());
        }

        public Match(
            String cardId, String name, String setCode, String collectorNumber,
            boolean exact, String language, String setIconUri, String setName, List<String> finishes
        ) {
            this.cardId = cardId;
            this.name = name;
            this.setCode = setCode;
            this.collectorNumber = collectorNumber;
            this.exact = exact;
            this.language = language;
            this.setIconUri = setIconUri;
            this.setName = setName;
            this.finishes = finishes;
        }

        public boolean hasFinish(String finish) {
            return finishes.contains(finish);
        }
    }

    /** Une ligne de la pile : une impression et ses exemplaires. */
    public static final class Entry {
        /** Impression : remplacée par le choix d'édition du scanner. */
        public Match match;
        public int qty;
        /** Langue choisie sur le scanner, `null` : celle par défaut. */
        public String language;
        /** Foil choisi sur le scanner, `null` : celui par défaut. */
        public Boolean foil;

        Entry(Match match) {
            this.match = match;
        }
    }

    static final int STABLE_FRAMES = 2;
    // Images de suite sans la carte comptée avant qu'elle puisse recompter.
    static final int ABSENT_FRAMES_TO_REARM = 2;
    // Et au moins ce temps sans elle : une image plus rapide (build
    // release) ne doit pas raccourcir l'absence exigée.
    static final long ABSENT_MS_TO_REARM = 1_000;
    // Images sans bas de carte lisible avant de chercher par le nom.
    static final int NAME_FALLBACK_FRAMES = 6;

    // Lecture connue sans carte correspondante.
    private static final Match NO_MATCH = new Match(null, null, null, null, false, null);

    private final Map<String, Match> resolved = new HashMap<>();
    private final Set<String> pending = new HashSet<>();
    private final List<Entry> entries = new ArrayList<>();
    // Ordre des ajouts, pour annuler le dernier.
    private final List<Entry> history = new ArrayList<>();

    private String lastKey;
    // Titre de la lecture en cours de stabilisation.
    private String lastTitle;
    private int streak;
    private int framesWithoutCollector;
    private Entry lastCounted;
    // Images de suite où la dernière carte comptée n'apparaît plus.
    private int absentFrames;
    // Dernière image où elle a été lue.
    private long lastSeenAt;
    // Dernier exemplaire annulé : la carte encore dans le cadre ne recompte pas.
    private boolean lastUndone;

    /** Carte comptée par le dernier `onReading`, `null` sinon. */
    public Entry counted;
    /**
     * Le dernier comptage remplace l'exemplaire compté par son nom par
     * l'impression exacte : la même carte, ni son ni animation de plus.
     */
    public boolean upgraded;

    /**
     * Une image lue. Renvoie la lecture à demander au serveur, ou `null`
     * (instable, déjà connue, déjà demandée). Une lecture déjà connue est
     * comptée tout de suite : voir `counted`.
     */
    public String onReading(ScanReading reading, long now) {
        counted = null;
        String key = read(reading, now);
        // Après la décision : une carte qui revient après son absence
        // recompte avant d'être de nouveau vue comme présente.
        trackPresence(reading, now);
        return key;
    }

    private String read(ScanReading reading, long now) {
        // Bas de carte ou numéro + nom : assez précis pour ne pas attendre.
        boolean specific = reading.hasCollectorInfo() || reading.hasNumberAndName();
        if (specific) framesWithoutCollector = 0;
        else framesWithoutCollector++;
        String key = reading.key();
        String title = reading.names.isEmpty() ? null : reading.names.get(0);
        // Bas de carte manqué sur une image, même titre : la stabilité attend
        // l'image suivante au lieu de repartir de zéro.
        if (!specific && framesWithoutCollector < NAME_FALLBACK_FRAMES
            && lastKey != null && lastTitle != null && title != null && sameCard(title, lastTitle)) {
            return null;
        }
        if (!specific && framesWithoutCollector < NAME_FALLBACK_FRAMES) key = null;
        if (key == null) {
            lastKey = null;
            lastTitle = null;
            streak = 0;
            return null;
        }
        lastTitle = title;
        if (key.equals(lastKey)) {
            streak++;
        } else {
            lastKey = key;
            streak = 1;
        }

        Match known = resolved.get(key);
        if (known != null) {
            if (known != NO_MATCH) counted = accept(known, now);
            return null;
        }
        if (pending.contains(key)) return null;
        // Bas de carte et titre lus : demandée dès la première image, le
        // serveur dit si le nom confirme l'impression (`onLookup`).
        boolean confirmable = reading.hasCollectorInfo() && !reading.names.isEmpty();
        if (streak < STABLE_FRAMES && !confirmable) return null;
        pending.add(key);
        return key;
    }

    /** Réponse du serveur pour `key` (`match` nul : aucune carte), non confirmée. */
    public Entry onLookup(String key, Match match, long now) {
        return onLookup(key, match, false, now);
    }

    /**
     * Réponse du serveur pour `key`. Confirmée par le nom lu, la carte compte
     * tout de suite ; sinon après une deuxième image de la même lecture.
     */
    public Entry onLookup(String key, Match match, boolean confirmed, long now) {
        pending.remove(key);
        resolved.put(key, match == null ? NO_MATCH : match);
        if (match == null) return null;
        boolean stable = key.equals(lastKey) && streak >= STABLE_FRAMES;
        return confirmed || stable ? accept(match, now) : null;
    }

    /** Échec réseau : la lecture pourra être redemandée. */
    public void onLookupFailed(String key) {
        pending.remove(key);
    }

    // La dernière carte comptée est-elle encore lue ? Par son nom (une de
    // ses lignes candidates) ou par une lecture déjà résolue vers elle.
    private void trackPresence(ScanReading reading, long now) {
        if (lastCounted == null) return;
        Match known = reading.key() == null ? null : resolved.get(reading.key());
        boolean present = known != null && known != NO_MATCH
            && sameCard(known.name, lastCounted.match.name);
        for (String name : reading.names) {
            if (sameCard(name, lastCounted.match.name) || startOfName(name, lastCounted.match.name)) present = true;
        }
        if (present) {
            absentFrames = 0;
            lastSeenAt = now;
        } else {
            absentFrames++;
        }
    }

    // Même carte : noms égaux en ignorant casse et ponctuation ; une carte
    // double face n'est souvent lue que par sa face avant.
    static boolean sameCard(String read, String name) {
        String a = normalized(read);
        String b = normalized(name);
        if (a.isEmpty() || b.isEmpty()) return false;
        int faces = name.indexOf("//");
        String front = faces < 0 ? b : normalized(name.substring(0, faces));
        return a.equals(b) || a.equals(front);
    }

    // Titre lu tronqué (`Circle of` pour « Circle of Power ») : la carte est
    // toujours là. Assez long pour ne pas confondre deux cartes.
    static boolean startOfName(String read, String name) {
        String a = normalized(read);
        return a.length() >= MIN_NAME_START && normalized(name).startsWith(a);
    }

    private static final int MIN_NAME_START = 6;

    private static String normalized(String text) {
        return text.toLowerCase(java.util.Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", "");
    }

    private Entry accept(Match match, long now) {
        boolean stillInFrame = lastCounted != null
            && sameCard(match.name, lastCounted.match.name)
            && (absentFrames < ABSENT_FRAMES_TO_REARM || now - lastSeenAt < ABSENT_MS_TO_REARM);
        if (stillInFrame) {
            if (lastUndone || lastCounted.match.exact || !match.exact) return null;
            // Lue par son nom puis par son numéro : l'exemplaire compté
            // devient l'impression exacte.
            removeLast();
        }
        upgraded = stillInFrame;

        // Un nouvel exemplaire prend les réglages par défaut : la ligne de
        // cette carte passée en foil ou dans une autre langue reste à part.
        Entry entry = find(match.cardId, null, null, null);
        if (entry == null) {
            entry = new Entry(match);
            entries.add(entry);
        }
        entry.qty++;
        history.add(entry);
        lastCounted = entry;
        lastUndone = false;
        absentFrames = 0;
        lastSeenAt = now;
        return entry;
    }

    private Entry removeLast() {
        Entry entry = history.remove(history.size() - 1);
        entry.qty--;
        if (entry.qty == 0) entries.remove(entry);
        return entry;
    }

    /** Un exemplaire de plus de cette carte (bouton +). */
    public void increment(Entry entry) {
        if (entry.qty == 0) entries.add(entry);
        entry.qty++;
        history.add(entry);
    }

    /**
     * Un exemplaire de moins (bouton −). La carte encore dans le cadre ne
     * recompte pas aussitôt, comme après `undo`.
     */
    public void decrement(Entry entry) {
        if (entry.qty == 0) return;
        history.remove(history.lastIndexOf(entry));
        entry.qty--;
        if (entry.qty == 0) entries.remove(entry);
        if (entry == lastCounted) lastUndone = true;
    }

    private Entry find(String cardId, Boolean foil, String language, Entry except) {
        for (Entry candidate : entries) {
            if (candidate != except
                && candidate.match.cardId.equals(cardId)
                && java.util.Objects.equals(candidate.foil, foil)
                && java.util.Objects.equals(candidate.language, language)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Impression, foil ou langue changés sur le scanner (`null` : par
     * défaut). Une ligne déjà identique reçoit les exemplaires ; renvoie la
     * ligne qui les porte.
     */
    public Entry restyle(Entry entry, Match printing, Boolean foil, String language) {
        Entry other = find(printing.cardId, foil, language, entry);
        if (other != null) {
            other.qty += entry.qty;
            for (int i = 0; i < history.size(); i++) {
                if (history.get(i) == entry) history.set(i, other);
            }
            entries.remove(entry);
            if (lastCounted == entry) lastCounted = other;
            return other;
        }
        entry.match = printing;
        entry.foil = foil;
        entry.language = language;
        return entry;
    }

    /** Retire le dernier exemplaire compté ; `null` si la pile est vide. */
    public Entry undo() {
        if (history.isEmpty()) return null;
        Entry entry = removeLast();
        lastCounted = entry;
        lastUndone = true;
        return entry;
    }

    public Entry last() {
        return history.isEmpty() ? null : history.get(history.size() - 1);
    }

    public int total() {
        return history.size();
    }

    public List<Entry> entries() {
        return Collections.unmodifiableList(entries);
    }
}

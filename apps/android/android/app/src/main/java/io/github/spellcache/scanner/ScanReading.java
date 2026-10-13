package io.github.spellcache.scanner;

import java.util.Collections;
import java.util.List;

/** Ce qu'une image a donné : bas de carte et lignes candidates au nom. */
public final class ScanReading {

    public final String setCode;
    public final String collectorNumber;
    public final String language;
    public final List<String> names;
    /** Jeton (rareté `T`) : cherché dans le set de jetons du set lu. */
    public final boolean token;

    public ScanReading(String setCode, String collectorNumber, String language, List<String> names) {
        this(setCode, collectorNumber, language, names, false);
    }

    public ScanReading(String setCode, String collectorNumber, String language, List<String> names, boolean token) {
        this.setCode = setCode;
        this.collectorNumber = collectorNumber;
        this.language = language;
        this.names = Collections.unmodifiableList(names);
        this.token = token;
    }

    public boolean hasCollectorInfo() {
        return setCode != null && collectorNumber != null;
    }

    /**
     * Cartes de 2008 à 2014 : numéro (`51/264`) sans code de set écrit. Avec
     * le nom, il désigne en général une seule impression.
     */
    public boolean hasNumberAndName() {
        return setCode == null && collectorNumber != null && !names.isEmpty();
    }

    /**
     * Clé de stabilité : la même lecture sur des images successives. Le bas de
     * carte suffit quand il est lu ; sinon le numéro et le nom ; sinon la
     * première ligne du haut. `null` : rien d'exploitable.
     */
    public String key() {
        String first = names.isEmpty() ? null : names.get(0).toLowerCase(java.util.Locale.ROOT);
        if (hasCollectorInfo()) {
            return setCode + "|" + keyNumber() + "|" + (language == null ? "" : language) + (token ? "|T" : "");
        }
        if (hasNumberAndName()) return "num|" + keyNumber() + "|" + first;
        if (first != null) return "name|" + first;
        return null;
    }

    // Numéro comme le cherche le serveur (`collectorNumberVariants`) : la
    // lecture alterne souvent `O173` et `0173` d'une image à l'autre, ce
    // qui ne doit pas relancer la stabilité.
    private String keyNumber() {
        String number = collectorNumber.toLowerCase(java.util.Locale.ROOT).replace('o', '0');
        return number.replaceFirst("^0+(?=[0-9])", "");
    }
}

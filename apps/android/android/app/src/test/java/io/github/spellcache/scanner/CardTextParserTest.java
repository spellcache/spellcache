package io.github.spellcache.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

public class CardTextParserTest {

    private static CardTextParser.TextLine line(String text, int left, int top) {
        return new CardTextParser.TextLine(text, left, top, left + 200, top + 20);
    }

    @Test
    public void readsTheBottomOfAnM15Frame() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Llanowar Elves", 40, 30),
            line("Creature — Elf Druid", 40, 500),
            line("261/280 C", 30, 900),
            line("M19 • EN  Chris Rahn", 30, 925)
        ));
        assertEquals("M19", reading.setCode);
        assertEquals("261/280", reading.collectorNumber);
        assertEquals("EN", reading.language);
        assertEquals("Llanowar Elves", reading.names.get(0));
        assertEquals("M19|261/280|EN", reading.key());
    }

    @Test
    public void readsTheFourDigitNumberWithTheRarityFirst() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("R 0123", 30, 900),
            line("mkm·fr Artiste", 30, 925)
        ));
        assertEquals("MKM", reading.setCode);
        assertEquals("0123", reading.collectorNumber);
        assertEquals("FR", reading.language);
    }

    @Test
    public void readsBothLinesMergedIntoOne() {
        ScanReading reading = CardTextParser.parse(Collections.singletonList(line("0045 U WOE • EN", 30, 900)));
        assertEquals("WOE", reading.setCode);
        assertEquals("0045", reading.collectorNumber);
    }

    @Test
    public void ignoresANumberFromAnotherColumn() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("2/2", 700, 880),
            line("M19 • EN", 30, 925)
        ));
        assertEquals("M19", reading.setCode);
        assertNull(reading.collectorNumber);
        assertFalse(reading.hasCollectorInfo());
    }

    @Test
    public void fallsBackToTheTopLinesWithoutABottomLine() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Instant", 40, 500),
            line("Lightning Bolt", 40, 30),
            line("@ 3", 600, 30)
        ));
        assertNull(reading.setCode);
        assertEquals(Arrays.asList("Lightning Bolt", "Instant"), reading.names);
        assertEquals("name|lightning bolt", reading.key());
    }

    // Texte lu sur une carte réelle (Summon: G.F. Cerberus, FIN #162).
    @Test
    public void prefersTheBottomLineOverRulesTextAndDetachesTheRarity() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Summon: G.F. Cerberus", 399, 392),
            line("library. You may put it", 433, 644),
            line("RO162", 372, 1389),
            line("FFVIII", 479, 1388),
            line("FIN EN KEVIN GLINT", 376, 1409)
        ));
        assertEquals("FIN", reading.setCode);
        assertEquals("EN", reading.language);
        assertEquals("O162", reading.collectorNumber);
        assertEquals("Summon: G.F. Cerberus", reading.names.get(0));
    }

    // Ligne d'une carte droite, tournée de `degrees` autour du centre d'une
    // image 1440×1920 : ce que rend la reconnaissance pour une carte tenue
    // de côté, à l'envers ou penchée.
    private static CardTextParser.RawLine turned(String text, int left, int top, int degrees) {
        int right = left + 200;
        int bottom = top + 20;
        double a = Math.toRadians(degrees);
        float[] corners = new float[8];
        int[][] points = {{left, top}, {right, top}, {right, bottom}, {left, bottom}};
        for (int i = 0; i < 4; i++) {
            double x = points[i][0] - 720;
            double y = points[i][1] - 960;
            corners[i * 2] = (float) (x * Math.cos(a) - y * Math.sin(a) + 720);
            corners[i * 2 + 1] = (float) (x * Math.sin(a) + y * Math.cos(a) + 960);
        }
        return new CardTextParser.RawLine(text, corners);
    }

    private static ScanReading cerberusTurnedBy(int degrees) {
        CardTextParser.Straightened straight = CardTextParser.straighten(Arrays.asList(
            turned("Summon: G.F. Cerberus", 399, 392, degrees),
            turned("library. You may put it", 433, 644, degrees),
            turned("RO162", 372, 1389, degrees),
            turned("FFVIII", 479, 1388, degrees),
            turned("FIN EN KEVIN GLINT", 376, 1409, degrees)
        ), 1440, 1920);
        return CardTextParser.parseAround(straight.lines, straight.centerX, straight.centerY,
            Math.round(straight.width * 0.06f));
    }

    @Test
    public void readsACardHeldSidewaysUpsideDownOrTilted() {
        for (int degrees : new int[] {0, 90, 180, -90, 15, -20}) {
            ScanReading reading = cerberusTurnedBy(degrees);
            assertEquals("at " + degrees + "°", "FIN", reading.setCode);
            assertEquals("at " + degrees + "°", "O162", reading.collectorNumber);
            assertEquals("at " + degrees + "°", "Summon: G.F. Cerberus", reading.names.get(0));
        }
    }

    @Test
    public void dropsTextRunningAcrossTheCard() {
        CardTextParser.Straightened straight = CardTextParser.straighten(Arrays.asList(
            turned("Summon: G.F. Cerberus", 399, 392, 90),
            turned("RO162", 372, 1389, 90),
            turned("FIN EN KEVIN GLINT", 376, 1409, 90),
            // Boîte posée à côté, son texte dans l'autre sens.
            turned("Booster Display Box", 900, 300, 0)
        ), 1440, 1920);
        assertEquals(90, straight.degrees);
        assertEquals(3, straight.lines.size());
    }

    @Test
    public void readsTheRarityAndNumberSeparated() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("R O162", 381, 1389),
            // Même ligne imprimée, lue un pixel plus bas que le numéro.
            line("FFVIII", 479, 1390),
            line("FIN EN KEVIN GLINT", 375, 1409)
        ));
        assertEquals("O162", reading.collectorNumber);
    }

    // Mode Auto : deux cartes côte à côte, la plus proche du centre l'emporte,
    // avec le nom de sa propre colonne.
    @Test
    public void picksTheCardNearestTheCentreInAutoMode() {
        ScanReading reading = CardTextParser.parseAround(Arrays.asList(
            line("Lightning Bolt", 40, 100),
            line("Llanowar Elves", 600, 120),
            line("146/249 C", 40, 900),
            line("M10 • EN", 40, 925),
            line("314/280 C", 600, 920),
            line("M19 • EN", 600, 945)
        ), 760, 600, 80);
        assertEquals("M19", reading.setCode);
        assertEquals("314/280", reading.collectorNumber);
        assertEquals("Llanowar Elves", reading.names.get(0));
        assertEquals(1, reading.names.size());
    }

    @Test
    public void countsReadableLines() {
        assertEquals(2, CardTextParser.readableLines(Arrays.asList(
            line("Lightning Bolt", 0, 0),
            line("|| ;", 0, 30),
            line("Instant", 0, 60)
        )));
    }

    // Texte de règles lu sur une carte réelle : « copy it » n'est pas un set.
    @Test
    public void ignoresSetLookalikesInsideRulesText() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Summon: G.F. Cerberus", 399, 392),
            line("turn, copy it twice.", 434, 1058),
            line("R O162 FFVIII", 381, 1389)
        ));
        assertNull(reading.setCode);
        assertEquals("Summon: G.F. Cerberus", reading.names.get(0));
    }

    // Carte de 2011 (Delver of Secrets, ISD #51a) : numéro dans la ligne du
    // copyright, pas de code de set ; la force/endurance ne passe pas pour un
    // numéro.
    @Test
    public void readsTheNumberOfCardsFrom2008To2014() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Delver of Secrets", 40, 30),
            line("1/1", 700, 880),
            line("TM & © 1993-2011 Wizards of the Coast LLC 51a/264", 30, 920)
        ));
        assertNull(reading.setCode);
        assertEquals("51A/264", reading.collectorNumber);
        assertTrue(reading.hasNumberAndName());
        assertEquals("num|51a/264|delver of secrets", reading.key());
    }

    @Test
    public void flagsATokenFromItsRarity() {
        ScanReading reading = CardTextParser.parse(Arrays.asList(
            line("Detective", 40, 30),
            line("T 0003", 30, 900),
            line("MKM • EN  Artiste", 30, 925)
        ));
        assertEquals("MKM", reading.setCode);
        assertEquals("0003", reading.collectorNumber);
        assertTrue(reading.token);
        assertEquals("MKM|3|EN|T", reading.key());

        ScanReading card = CardTextParser.parse(Arrays.asList(
            line("C 0118", 30, 900),
            line("FIN • EN", 30, 925)
        ));
        assertFalse(card.token);
    }

    @Test
    public void ignoresTextWithoutAnyCardShape() {
        ScanReading reading = CardTextParser.parse(Collections.singletonList(line("12 %%", 0, 0)));
        assertNull(reading.key());
        assertTrue(reading.names.isEmpty());
    }
}

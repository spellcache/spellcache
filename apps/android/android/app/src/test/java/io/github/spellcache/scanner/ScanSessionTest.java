package io.github.spellcache.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import java.util.Collections;

import org.junit.Test;

public class ScanSessionTest {

    private static final ScanReading BOLT_M10 =
        new ScanReading("M10", "146", "EN", Collections.singletonList("Lightning Bolt"));
    private static final ScanReading ELVES =
        new ScanReading("M19", "314", "EN", Collections.singletonList("Llanowar Elves"));
    private static final ScanReading BOLT_NAME =
        new ScanReading(null, null, null, Collections.singletonList("Lightning Bolt"));

    private static ScanSession.Match match(String id, String name, boolean exact) {
        return new ScanSession.Match(id, name, "m10", "146", exact, "en");
    }

    private static final ScanSession.Match BOLT = match("bolt-m10", "Lightning Bolt", true);
    private static final ScanSession.Match BOLT_OTHER = match("bolt-2x2", "Lightning Bolt", false);
    private static final ScanSession.Match ELF = match("elves-m19", "Llanowar Elves", true);

    // Lecture lue deux fois de suite, clé demandée une seule fois.
    private static String twoFrames(ScanSession session, ScanReading reading, long first, long second) {
        String key = session.onReading(reading, first);
        String again = session.onReading(reading, second);
        return key != null ? key : again;
    }

    private static final ScanReading BOLT_BOTTOM =
        new ScanReading("M10", "146", "EN", Collections.<String>emptyList());

    @Test
    public void looksUpOnlyAStableReadingAndOnlyOnce() {
        ScanSession session = new ScanSession();
        assertNull(session.onReading(BOLT_BOTTOM, 0));
        String key = session.onReading(BOLT_BOTTOM, 100);
        assertEquals(BOLT_BOTTOM.key(), key);
        assertNull(session.onReading(BOLT_BOTTOM, 200));
    }

    @Test
    public void looksUpAReadingWithItsTitleOnTheFirstFrameAndOnlyOnce() {
        ScanSession session = new ScanSession();
        assertEquals(BOLT_M10.key(), session.onReading(BOLT_M10, 0));
        assertNull(session.onReading(BOLT_M10, 100));
    }

    @Test
    public void countsACardKeptInTheFrameOnce() {
        ScanSession session = new ScanSession();
        String key = twoFrames(session, BOLT_M10, 0, 100);
        assertNotNull(session.onLookup(key, BOLT, 300));
        for (long t = 400; t < 5_000; t += 100) {
            session.onReading(BOLT_M10, t);
            assertNull(session.counted);
        }
        assertEquals(1, session.total());
    }

    private static final ScanReading NOTHING =
        new ScanReading(null, null, null, Collections.<String>emptyList());

    @Test
    public void countsTheSameCardAgainAfterItLeftTheFrame() {
        ScanSession session = new ScanSession();
        session.onLookup(twoFrames(session, BOLT_M10, 0, 100), BOLT, 200);
        session.onReading(NOTHING, 300);
        session.onReading(NOTHING, 400);
        session.onReading(BOLT_M10, 1_300);
        assertNotNull(session.counted);
        assertEquals(2, session.entries().get(0).qty);
    }

    @Test
    public void countsAnotherCardRightAway() {
        ScanSession session = new ScanSession();
        session.onLookup(twoFrames(session, BOLT_M10, 0, 100), BOLT, 200);
        session.onLookup(twoFrames(session, ELVES, 300, 400), ELF, 500);
        session.onReading(BOLT_M10, 600);
        assertNotNull(session.counted);
        assertEquals(3, session.total());
    }

    @Test
    public void searchesByNameOnlyAfterSeveralFramesWithoutABottomLine() {
        ScanSession session = new ScanSession();
        long t = 0;
        // Le nom doit ensuite rester stable, comme toute lecture.
        for (int i = 0; i < ScanSession.NAME_FALLBACK_FRAMES; i++) {
            assertNull(session.onReading(BOLT_NAME, t += 100));
        }
        assertEquals(BOLT_NAME.key(), session.onReading(BOLT_NAME, t + 100));
    }

    @Test
    public void turnsACardFoundByNameIntoTheExactPrinting() {
        ScanSession session = new ScanSession();
        long t = 0;
        String key = null;
        while (key == null) key = session.onReading(BOLT_NAME, t += 100);
        session.onLookup(key, BOLT_OTHER, t += 100);
        String exactKey = twoFrames(session, BOLT_M10, t += 100, t += 100);
        assertNotNull(session.onLookup(exactKey, BOLT, t + 100));
        assertEquals(1, session.total());
        assertEquals(1, session.entries().size());
        assertSame(BOLT, session.entries().get(0).match);
    }

    @Test
    public void neverCountsAReadingWithoutCard() {
        ScanSession session = new ScanSession();
        assertNull(session.onLookup(twoFrames(session, ELVES, 0, 100), null, 200));
        assertNull(session.onReading(ELVES, 300));
        assertNull(session.counted);
        assertEquals(0, session.total());
    }

    // Analyse lente (une image par seconde) avec des images où le bas de
    // carte n'est pas lu : la carte toujours là ne recompte pas.
    @Test
    public void neverRecountsACardStillInViewEvenWithSlowPartialFrames() {
        ScanSession session = new ScanSession();
        session.onLookup(twoFrames(session, BOLT_M10, 0, 1_000), BOLT, 1_100);
        long t = 2_000;
        for (int i = 0; i < 10; i++) {
            session.onReading(i % 2 == 0 ? BOLT_NAME : BOLT_M10, t += 1_000);
            assertNull(session.counted);
        }
        assertEquals(1, session.total());
    }

    @Test
    public void undoesTheLastCopyWithoutRecountingTheCardInTheFrame() {
        ScanSession session = new ScanSession();
        session.onLookup(twoFrames(session, BOLT_M10, 0, 100), BOLT, 200);
        assertNotNull(session.undo());
        assertEquals(0, session.total());
        assertEquals(0, session.entries().size());
        session.onReading(BOLT_M10, 300);
        assertNull(session.counted);
        assertNull(session.undo());
    }

    @Test
    public void adjustsTheCopiesOfACardWithTheStepper() {
        ScanSession session = new ScanSession();
        ScanSession.Entry entry = session.onLookup(twoFrames(session, BOLT_M10, 0, 100), BOLT, 200);
        session.increment(entry);
        session.increment(entry);
        assertEquals(3, entry.qty);
        assertEquals(3, session.total());
        session.decrement(entry);
        session.decrement(entry);
        session.decrement(entry);
        session.decrement(entry);
        assertEquals(0, entry.qty);
        assertEquals(0, session.entries().size());
        // Toujours dans le cadre : ne recompte pas après être passée à zéro.
        session.onReading(BOLT_M10, 300);
        assertNull(session.counted);
        session.increment(entry);
        assertEquals(1, session.entries().size());
        assertEquals(1, session.total());
    }

    @Test
    public void retriesALookupThatFailed() {
        ScanSession session = new ScanSession();
        String key = session.onReading(BOLT_M10, 0);
        session.onLookupFailed(key);
        assertEquals(key, session.onReading(BOLT_M10, 200));
    }

    // Premier exemplaire lu, puis la carte sortie du cadre et relue.
    private static ScanSession.Entry countBolt(ScanSession session, long t) {
        if (session.total() == 0) {
            return session.onLookup(twoFrames(session, BOLT_M10, t, t + 10), BOLT, t + 20);
        }
        session.onReading(NOTHING, t);
        session.onReading(NOTHING, t + 10);
        session.onReading(BOLT_M10, t + 2_000);
        return session.counted;
    }

    @Test
    public void keepsAFoilCopyApartFromTheNextCopiesOfTheCard() {
        ScanSession session = new ScanSession();
        ScanSession.Entry first = countBolt(session, 0);
        ScanSession.Entry foil = session.restyle(first, BOLT, true, null);
        ScanSession.Entry next = countBolt(session, 100);
        assertEquals(2, session.entries().size());
        assertEquals(Boolean.TRUE, foil.foil);
        assertNull(next.foil);
        assertEquals(1, next.qty);
    }

    @Test
    public void mergesALineChangedToMatchAnother() {
        ScanSession session = new ScanSession();
        session.restyle(countBolt(session, 0), BOLT, true, null);
        ScanSession.Entry merged = session.restyle(countBolt(session, 100), BOLT, true, null);
        assertEquals(1, session.entries().size());
        assertEquals(2, merged.qty);
        assertSame(merged, session.undo());
        assertEquals(1, merged.qty);
    }

    @Test
    public void treatsAnOReadForAZeroAsTheSameReading() {
        ScanSession session = new ScanSession();
        assertNull(session.onReading(new ScanReading("FIN", "O173", "EN", Collections.<String>emptyList()), 0));
        assertNotNull(session.onReading(new ScanReading("FIN", "0173", "EN", Collections.<String>emptyList()), 100));
    }

    @Test
    public void waitsThroughAFrameThatMissedTheBottomLineOfTheSameCard() {
        ScanSession session = new ScanSession();
        ScanReading cerberus = new ScanReading("FIN", "O162", "EN", Collections.singletonList("Summon: G.F. Cerberus"));
        ScanReading titleOnly = new ScanReading(null, null, null, Collections.singletonList("Summon: G.F. Cerberus"));
        String key = session.onReading(cerberus, 0);
        assertNull(session.onLookup(key, match("cerberus", "Summon: G.F. Cerberus", true), false, 50));
        assertNull(session.onReading(titleOnly, 100));
        session.onReading(cerberus, 200);
        assertNotNull(session.counted);
    }

    @Test
    public void restartsTheWaitWhenAnotherCardShowsUp() {
        ScanSession session = new ScanSession();
        assertNull(session.onReading(BOLT_BOTTOM, 0));
        assertNull(session.onReading(new ScanReading(null, null, null, Collections.singletonList("Llanowar Elves")), 100));
        assertNull(session.onReading(BOLT_BOTTOM, 200));
    }

    private static final ScanReading CIRCLE =
        new ScanReading("FIN", "0092", "EN", Collections.singletonList("Circle of Power"));

    private static ScanSession countedCircle() {
        ScanSession session = new ScanSession();
        session.onLookup(twoFrames(session, CIRCLE, 0, 500), match("circle", "Circle of Power", true), 550);
        return session;
    }

    @Test
    public void keepsACardWhoseTitleIsReadCutShortInTheFrame() {
        ScanSession session = countedCircle();
        session.onReading(new ScanReading(null, null, null, Collections.singletonList("Circle of")), 1_100);
        session.onReading(NOTHING, 1_600);
        session.onReading(CIRCLE, 2_100);
        assertNull(session.counted);
        assertEquals(1, session.total());
    }

    @Test
    public void waitsASecondWithoutTheCardBeforeCountingItAgain() {
        ScanSession session = countedCircle();
        session.onReading(NOTHING, 800);
        session.onReading(NOTHING, 1_000);
        session.onReading(CIRCLE, 1_200);
        assertNull(session.counted);
        session.onReading(NOTHING, 1_400);
        session.onReading(NOTHING, 1_600);
        session.onReading(CIRCLE, 2_200);
        assertNotNull(session.counted);
        assertEquals(2, session.total());
    }

    @Test
    public void countsOnTheFirstFrameWhenTheNameConfirmsThePrinting() {
        ScanSession session = new ScanSession();
        String key = session.onReading(BOLT_M10, 0);
        assertEquals(BOLT_M10.key(), key);
        assertNotNull(session.onLookup(key, BOLT, true, 100));
        assertEquals(1, session.total());
    }

    @Test
    public void waitsForASecondFrameWhenTheNameDoesNotConfirmThePrinting() {
        ScanSession session = new ScanSession();
        String key = session.onReading(BOLT_M10, 0);
        assertNull(session.onLookup(key, BOLT, false, 100));
        assertEquals(0, session.total());
        session.onReading(BOLT_M10, 600);
        assertNotNull(session.counted);
        assertEquals(1, session.total());
    }

    @Test
    public void neverCountsAPrintingReadOnceWithoutConfirmation() {
        ScanSession session = new ScanSession();
        String key = session.onReading(BOLT_M10, 0);
        session.onLookup(key, BOLT, false, 100);
        session.onReading(ELVES, 600);
        session.onReading(NOTHING, 1_200);
        assertEquals(0, session.total());
    }
}

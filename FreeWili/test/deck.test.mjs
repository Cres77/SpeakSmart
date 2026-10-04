import assert from "node:assert/strict";
import test from "node:test";
import {
  DECK_STORAGE_KEY,
  addSlide,
  createDeck,
  deleteSlide,
  editSlide,
  nextSlide,
  previousSlide,
  readLibrary,
  slidePosition,
} from "../shared/deck.mjs";

test("create, add, edit, and delete slides", () => {
  let deck = createDeck("  Opening  ");
  assert.equal(deck.name, "Opening");
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.index, 0);

  const first = deck.slides[0].id;
  deck = editSlide(deck, first, { title: "Hello", content: "One" });
  assert.equal(deck.slides[0].title, "Hello");
  assert.equal(deck.slides[0].content, "One");

  deck = addSlide(deck);
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.index, 1);
  assert.equal(deck.slides[0].title, "Hello");
  const second = deck.slides[1].id;
  deck = editSlide(deck, second, { title: "Next", content: "Two" });
  assert.equal(deck.slides[0].content, "One");

  deck = deleteSlide(deck, first);
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].id, second);
  assert.equal(deck.index, 0);
  assert.equal(slidePosition(deck), "Slide 1 of 1");
});

test("next and previous stay inside the deck", () => {
  let deck = addSlide(createDeck("Talk"));
  deck = { ...deck, index: 0 };
  assert.equal(previousSlide(deck).index, 0);
  deck = nextSlide(deck);
  assert.equal(deck.index, 1);
  assert.equal(slidePosition(deck), "Slide 2 of 2");
  assert.equal(nextSlide(deck).index, 1);
  deck = previousSlide(deck);
  assert.equal(deck.index, 0);

  const emptied = deleteSlide(deck, deck.slides[0].id);
  const none = deleteSlide(emptied, emptied.slides[0].id);
  assert.equal(none.slides.length, 0);
  assert.equal(nextSlide(none).index, 0);
  assert.equal(previousSlide(none).index, 0);
  assert.equal(slidePosition(none), "No slides");
});

test("deleting the current last slide clamps the index", () => {
  let deck = addSlide(addSlide(createDeck("Talk")));
  assert.equal(deck.index, 2);
  deck = deleteSlide(deck, deck.slides[2].id);
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.index, 1);
});

test("a saved library round-trips and drops a bad payload", () => {
  let deck = createDeck("Saved");
  deck = editSlide(deck, deck.slides[0].id, { title: "Keep", content: "This slide" });
  const raw = JSON.stringify({ activeId: deck.id, decks: [deck] });
  const library = readLibrary(raw);
  assert.equal(DECK_STORAGE_KEY, "speaksmart.decks");
  assert.equal(library.activeId, deck.id);
  assert.equal(library.decks[0].slides[0].title, "Keep");
  assert.equal(library.decks[0].slides[0].cue, "");
  assert.deepEqual(readLibrary("not json"), { activeId: null, decks: [] });
});

test("an old slide without a cue loads empty and the editor can set or clear it", () => {
  const library = readLibrary(JSON.stringify({
    activeId: "deck-1",
    decks: [{
      id: "deck-1",
      name: "Old",
      index: 0,
      slides: [{ id: "slide-1", title: "Hello", content: "Body" }],
    }],
  }));
  assert.equal(library.decks[0].slides[0].cue, "");
  let deck = editSlide(library.decks[0], "slide-1", { cue: "Slow down hand movements" });
  assert.equal(deck.slides[0].cue, "Slow down hand movements");
  assert.equal(deck.slides[0].title, "Hello");
  assert.equal(deck.slides[0].content, "Body");
  deck = editSlide(deck, "slide-1", { cue: "" });
  assert.equal(deck.slides[0].cue, "");
  assert.equal(deck.slides[0].title, "Hello");
});

/* Slideshow decks. These are not practice logs and they are not coach messages.
 * The page stores the library in localStorage under DECK_STORAGE_KEY.
 */

export const DECK_STORAGE_KEY = "speaksmart.decks";

function makeId() {
  return crypto.randomUUID();
}

function blankSlide() {
  return { id: makeId(), title: "", content: "", cue: "" };
}

function asText(value) {
  return typeof value === "string" ? value : "";
}

export function createDeck(name) {
  const trimmed = asText(name).trim();
  return {
    id: makeId(),
    name: trimmed || "Untitled",
    index: 0,
    slides: [blankSlide()],
  };
}

export function renameDeck(deck, name) {
  const trimmed = asText(name).trim();
  return { ...deck, name: trimmed || "Untitled" };
}

export function addSlide(deck) {
  const slides = [...deck.slides, blankSlide()];
  return { ...deck, slides, index: slides.length - 1 };
}

export function editSlide(deck, slideId, fields) {
  const slides = deck.slides.map((slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      title: fields.title === undefined ? slide.title : asText(fields.title),
      content: fields.content === undefined ? slide.content : asText(fields.content),
      cue: fields.cue === undefined ? asText(slide.cue) : asText(fields.cue),
    };
  });
  return { ...deck, slides };
}

export function deleteSlide(deck, slideId) {
  const at = deck.slides.findIndex((slide) => slide.id === slideId);
  if (at < 0) return deck;
  const slides = deck.slides.filter((slide) => slide.id !== slideId);
  let index = deck.index;
  if (slides.length === 0) index = 0;
  else if (at < deck.index) index -= 1;
  else if (index >= slides.length) index = slides.length - 1;
  return { ...deck, slides, index };
}

export function nextSlide(deck) {
  if (deck.slides.length === 0 || deck.index >= deck.slides.length - 1) return deck;
  return { ...deck, index: deck.index + 1 };
}

export function previousSlide(deck) {
  if (deck.index <= 0) return deck;
  return { ...deck, index: deck.index - 1 };
}

export function slidePosition(deck) {
  if (deck.slides.length === 0) return "No slides";
  return `Slide ${deck.index + 1} of ${deck.slides.length}`;
}

export function emptyLibrary() {
  return { activeId: null, decks: [] };
}

function normalizeDeck(deck) {
  const slides = deck.slides
    .filter((slide) => slide && typeof slide.id === "string")
    .map((slide) => ({
      id: slide.id,
      title: asText(slide.title),
      content: asText(slide.content),
      cue: asText(slide.cue),
    }));
  let index = Number.isInteger(deck.index) ? deck.index : 0;
  if (slides.length === 0) index = 0;
  else index = Math.min(slides.length - 1, Math.max(0, index));
  return {
    id: deck.id,
    name: asText(deck.name).trim() || "Untitled",
    index,
    slides,
  };
}

export function readLibrary(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyLibrary();
    }
  }
  if (!parsed || !Array.isArray(parsed.decks)) return emptyLibrary();
  const decks = parsed.decks.filter((deck) => deck && typeof deck.id === "string" && Array.isArray(deck.slides)).map(normalizeDeck);
  const activeId = decks.some((deck) => deck.id === parsed.activeId) ? parsed.activeId : decks[0]?.id ?? null;
  return { activeId, decks };
}

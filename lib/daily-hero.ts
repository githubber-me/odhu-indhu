export type DailyHero = {
  lead: string;
  accent: string;
  support: string;
};

export const DAILY_HEROES: readonly DailyHero[] = [
  { lead: "One hour.", accent: "Every day.", support: "Show up for the person you’re becoming." },
  { lead: "ಓದು ಇಂದು.", accent: "ಗೆಲುವು ನಾಳೆ.", support: "Study today. Stand taller tomorrow." },
  { lead: "Baa appi.", accent: "Odhi nodu.", support: "ಒಂದು ಗಂಟೆ. ಅಷ್ಟೇ ಶುರು." },
  { lead: "An hour today.", accent: "ಒಂದು ಹೆಜ್ಜೆ ಮುಂದೆ.", support: "Quiet work becomes visible progress." },
  { lead: "ಇವತ್ತಿನ ಓದು.", accent: "ನಾಳೆಯ ಬಲ.", support: "What you learn today stays with you." },
  { lead: "Open the book.", accent: "Keep the promise.", support: "Your streak begins with this session." },
  { lead: "ಒಂದು ಗಂಟೆ.", accent: "ಪ್ರತಿದಿನ.", support: "ದೊಡ್ಡ ಗುರಿ, ದಿನಕ್ಕೊಂದು ಹೆಜ್ಜೆ." },
  { lead: "No drama.", accent: "Just ಓದು.", support: "Sit down, begin and let the minutes add up." },
  { lead: "Today counts.", accent: "ಇಂದೇ ಶುರು.", support: "A serious future is built on ordinary days." },
  { lead: "ಜಾಸ್ತಿ ಬೇಡ.", accent: "Consistency ಸಾಕು.", support: "One focused hour can carry the day." },
  { lead: "Read. Record.", accent: "Return.", support: "Small sessions become a formidable streak." },
  { lead: "ಓದಿಗೆ", accent: "ಹಾಜರಾಗು.", support: "Progress begins when you simply show up." },
  { lead: "Do the hour.", accent: "Earn the day.", support: "No performance—just honest preparation." },
  { lead: "ಒಂದು ದಿನ.", accent: "ಒಂದು ಗೆಲುವು.", support: "Keep stacking the days that matter." },
  { lead: "Keep calm.", accent: "ಓದು ಮುಂದುವರಿಸು.", support: "The syllabus moves when you do." },
  { lead: "ನಿಧಾನವಾಗಿ.", accent: "ನಿರಂತರವಾಗಿ.", support: "Slow is fine. Stopping is expensive." },
  { lead: "Your future is", accent: "taking attendance.", support: "Mark yourself present with one honest session." },
  { lead: "ಇಂದು ಬಿಟ್ಟರೆ,", accent: "streak ಬಿಡುತ್ತದೆ.", support: "Protect the rhythm you worked to create." },
  { lead: "One session", accent: "closer.", support: "ಗುರಿ ದೂರ ಇರಬಹುದು. ಇಂದಿನ ಕೆಲಸ ಹತ್ತಿರದಲ್ಲಿದೆ." },
  { lead: "ಕಲಿತದ್ದು ಬರೆಯು.", accent: "ನೆನಪಲ್ಲಿ ಉಳಿಸು.", support: "Log the work now. Recall it when it matters." },
  { lead: "Start before you", accent: "feel ready.", support: "Motivation can arrive after the first page." },
  { lead: "ಪುಸ್ತಕ ತೆರೆ.", accent: "ದಿನ ಗೆಲ್ಲು.", support: "Your smallest serious effort still counts." },
  { lead: "An hour of focus.", accent: "ಒಂದು ದಿನದ ಹೆಮ್ಮೆ.", support: "Finish today knowing you moved forward." },
  { lead: "ಓದು first.", accent: "Everything else later.", support: "Give the goal your clearest hour." },
  { lead: "Make today", accent: "worth recording.", support: "Learn something. Log it. Come back tomorrow." },
  { lead: "ಈ ದಿನವೂ", accent: "ಲೆಕ್ಕಕ್ಕೆ ಬರಲಿ.", support: "Let today become part of the streak." },
  { lead: "One page can", accent: "change the pace.", support: "Begin small and allow momentum to take over." },
  { lead: "ನಿನ್ನ ಗುರಿ.", accent: "ನಿನ್ನ ಸಮಯ.", support: "Guard this hour like it belongs to your future." },
  { lead: "Less scrolling.", accent: "ಹೆಚ್ಚು ಓದು.", support: "Trade one distracted hour for real progress." },
  { lead: "The exam is coming.", accent: "So are you.", support: "Prepare quietly. Arrive confidently." },
  { lead: "ಇಂದು ಓದು.", accent: "ಮತ್ತೆ ನಾಳೆ.", support: "Repetition turns intention into identity." },
  { lead: "Stack hours.", accent: "Build confidence.", support: "Every completed session is evidence." },
  { lead: "ಒಂದು honest hour", accent: "ಕೊಡು.", support: "Your future self will know what it was worth." },
  { lead: "Show up. ಓದು.", accent: "Repeat.", support: "The simple routine is often the powerful one." },
  { lead: "ಗುರಿ ದೊಡ್ಡದು.", accent: "ಹೆಜ್ಜೆ ಇಂದೇ.", support: "You don’t need the whole journey today." },
  { lead: "This hour", accent: "belongs to you.", support: "Use it to become difficult to defeat." },
  { lead: "ಸ್ವಲ್ಪ ಸ್ವಲ್ಪ.", accent: "ದಿನವೂ.", support: "Consistency makes modest effort compound." },
  { lead: "ಇಂದು excuse ಬೇಡ.", accent: "Entry ಬೇಕು.", support: "Put in the work and leave proof behind." },
  { lead: "Come back stronger", accent: "tomorrow.", support: "But first, complete today’s honest hour." },
  { lead: "Daily work.", accent: "ದೊಡ್ಡ ಫಲ.", support: "What feels small today can decide the result." },
] as const;

const DAY_MS = 86_400_000;
const EPOCH_DAY = Date.UTC(2026, 0, 1) / DAY_MS;

function seededShuffle(seed: number) {
  const order = DAILY_HEROES.map((_, index) => index);
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = order.length - 1; index > 0; index--) {
    const swapWith = Math.floor(random() * (index + 1));
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
  }
  return order;
}

function dayNumber(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function cycleOrder(cycle: number) {
  const order = seededShuffle(cycle);
  const previous = seededShuffle(cycle - 1);
  if (order[0] === previous[previous.length - 1]) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

export function dailyHero(date: string) {
  const elapsed = dayNumber(date) - EPOCH_DAY;
  const cycle = Math.floor(elapsed / DAILY_HEROES.length);
  const position = ((elapsed % DAILY_HEROES.length) + DAILY_HEROES.length) % DAILY_HEROES.length;
  const order = cycleOrder(cycle);
  return DAILY_HEROES[order[position]];
}

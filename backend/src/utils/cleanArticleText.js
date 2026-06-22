/**
 * Strip boilerplate / junk lines from extracted article text so narration sounds
 * like the article and not the web page around it. Runs after htmlToText (which
 * already drops scripts, figures, captions, etc.) on text split into \n / \n\n lines.
 *
 * Conservative by design: only drops lines that match known junk patterns, never
 * whole paragraphs of body copy.
 */

// Lines that are pure boilerplate — dropped wherever they appear.
const JUNK_LINE_PATTERNS = [
  /^advertisement$/i,
  /^sponsored( content)?$/i,
  /^skip to (main )?content$/i,
  /^(main menu|menu|search|sections)$/i,
  /^(share|tweet|share this|share this article|share on \w+)\b/i,
  /^(read more|read also|related|related stories|related articles|more from|see also)\b[:.]?/i,
  /^(sign up|subscribe)\b.*(newsletter|email|inbox|updates)/i,
  /^(get|enjoy)\b.*\b(newsletter|in your inbox)/i,
  /^(follow us|follow along)\b/i,
  /^(photo|image|picture|video|graphic|illustration|caption)\s*[:|]/i,
  /\b(getty images|associated press|\(ap\)|reuters|shutterstock|adobe stock)\s*$/i,
  /^(credit|photo credit|image credit|source)\s*[:|]/i,
  /^(click here|tap here)\b/i,
  /^(this story|this article) (was|has been) (updated|originally)/i,
  /^©|^copyright\b/i,
  /^all rights reserved\b/i,
  /^the post .+ appeared first on .+\.?$/i,
];

// A leading byline line, e.g. "By Jane Smith" or "By Jane Smith, Staff Writer".
// Requires at least a capitalized first + last name so it won't eat sentences
// that merely start with "By" (e.g. "By Monday, the council will vote.").
const BYLINE_PATTERN = /^[Bb]y\s+(?:[A-Z][\w.'-]+\s+){1,3}[A-Z][\w.'-]+(?:\s*,\s*[A-Za-z][A-Za-z .'-]+)?\.?$/;
// A dateline-ish line that's just a place and/or date, e.g. "WASHINGTON —" or "June 19, 2026".
const DATELINE_PATTERN = /^[A-Z][A-Za-z.\s]{0,30}\s[—–-]\s/;

function isJunkLine(line) {
  const l = line.trim();
  if (!l) return false;
  if (JUNK_LINE_PATTERNS.some(re => re.test(l))) return true;
  // Only treat a byline as junk when it's short — avoids eating sentences that start with "By".
  if (l.length <= 60 && BYLINE_PATTERN.test(l)) return true;
  return false;
}

function cleanArticleText(text) {
  if (!text) return '';

  const lines = String(text).split('\n');

  // Drop a leading byline/dateline from the very top of the article.
  while (lines.length && (BYLINE_PATTERN.test(lines[0].trim()) || DATELINE_PATTERN.test(lines[0].trim()))) {
    if (lines[0].trim().length > 80) break; // a real opening sentence, leave it
    lines.shift();
  }

  const kept = lines.filter(line => !isJunkLine(line));

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { cleanArticleText };

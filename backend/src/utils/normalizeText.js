/**
 * normalizeForTTS(text)
 * Transforms a string into a form that ElevenLabs will pronounce naturally.
 * Rules are applied in order — earlier rules take priority.
 */

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function isYear(n) {
  return n >= 1900 && n <= 2099
}

const ONES = [
  'zero','one','two','three','four','five','six','seven','eight','nine',
  'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
  'seventeen','eighteen','nineteen',
]
const TENS_WORDS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']

/** Spell a number 0–99 as words, e.g. 25 → "twenty-five", 10 → "ten" */
function spellTens(n) {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10), o = n % 10
  return o ? `${TENS_WORDS[t]}-${ONES[o]}` : TENS_WORDS[t]
}

/**
 * Spell a 4-digit year (1900–2099) the way a human announcer would say it.
 * 1900 → "nineteen hundred", 1999 → "nineteen ninety-nine"
 * 2000 → "two thousand", 2001 → "two thousand one"
 * 2010 → "twenty ten", 2025 → "twenty twenty-five"
 */
function spellYear(n) {
  if (n === 2000) return 'two thousand'
  if (n >= 2001 && n <= 2009) return `two thousand ${ONES[n % 100]}`
  const century = Math.floor(n / 100)
  const rem = n % 100
  return rem === 0 ? `${spellTens(century)} hundred` : `${spellTens(century)} ${spellTens(rem)}`
}

/** Format 10 digits as three groups separated by commas for cleaner TTS reading. */
function formatPhoneDigits(a, b, c) {
  return `${a.split('').join(' ')}, ${b.split('').join(' ')}, ${c.split('').join(' ')}`
}

/** Spell out a whole-dollar integer as words, e.g. 13872500 → "13 million 872 thousand 500" */
function spellDollars(n) {
  const millions = Math.floor(n / 1_000_000)
  const remainder = n % 1_000_000
  const thousands = Math.floor(remainder / 1_000)
  const units = remainder % 1_000
  const parts = []
  if (millions)  parts.push(`${millions} million`)
  if (thousands) parts.push(`${thousands} thousand`)
  if (units)     parts.push(`${units}`)
  return parts.join(' ') || '0'
}

function normalizeForTTS(text) {
  let out = text

  // 1–4 — Currency (must come before plain number rules)
  out = out.replace(
    /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g,
    (_, raw) => {
      const hasCents = raw.includes('.')
      const [dollarPart, centPart] = raw.split('.')
      const dollars = parseInt(dollarPart.replace(/,/g, ''), 10)
      const cents = hasCents ? parseInt(centPart, 10) : 0

      if (hasCents) {
        return `${spellDollars(dollars)} dollars and ${cents} cents`
      }
      return `${spellDollars(dollars)} dollars`
    }
  )

  // 5 & 6 — Large plain numbers with commas (no $ sign)
  // Skip years (1900–2099) to avoid "2,025" → "2 thousand 25"
  out = out.replace(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/g, (_, raw) => {
    const n = parseInt(raw.replace(/,/g, ''), 10)
    if (isYear(n)) return raw
    if (n >= 1_000_000) {
      const millions = Math.floor(n / 1_000_000)
      const remainder = n % 1_000_000
      const thousands = Math.floor(remainder / 1_000)
      const units = remainder % 1_000
      const parts = [`${millions} million`]
      if (thousands) parts.push(`${thousands} thousand`)
      if (units) parts.push(`${units}`)
      return parts.join(' ')
    }
    if (n >= 1_000) {
      const thousands = Math.floor(n / 1_000)
      const units = n % 1_000
      return units ? `${thousands} thousand ${units}` : `${thousands} thousand`
    }
    return raw
  })

  // 7 — Percentages
  out = out.replace(/([0-9]+(?:\.[0-9]+)?)%/g, '$1 percent')

  // 8 — Phone numbers: (970) 555-1234 or 970-555-1234 → digit groups with commas
  //     Comma between groups prevents ElevenLabs from dropping trailing digits.
  out = out.replace(
    /\(([0-9]{3})\)\s*([0-9]{3})-([0-9]{4})/g,
    (_, a, b, c) => formatPhoneDigits(a, b, c)
  )
  out = out.replace(
    /\b([0-9]{3})-([0-9]{3})-([0-9]{4})\b/g,
    (_, a, b, c) => formatPhoneDigits(a, b, c)
  )

  // 9 — Dates: "January 14, 2025" → "January 14th, twenty twenty-five"
  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
  out = out.replace(
    new RegExp(`(${MONTHS})\\s+([0-9]{1,2}),\\s*([0-9]{4})`, 'g'),
    (_, month, day, year) => `${month} ${ordinal(parseInt(day, 10))}, ${spellYear(parseInt(year, 10))}`
  )

  // 10 — Bare 4-digit years (1900–2099) → spoken form
  //      e.g. "in 2025" → "in twenty twenty-five"
  //      Runs after the date rule so years inside date strings are already handled.
  out = out.replace(/\b((?:19|20)[0-9]{2})\b/g, (_, raw) => spellYear(parseInt(raw, 10)))

  return out
}

module.exports = { normalizeForTTS }

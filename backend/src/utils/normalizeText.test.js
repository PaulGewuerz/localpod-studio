const { normalizeForTTS } = require('./normalizeText')

describe('normalizeForTTS', () => {
  // Rule 1 — currency with cents
  test('currency with cents (thousands)', () => {
    expect(normalizeForTTS('$156,353.72')).toBe('156 thousand 353 dollars and 72 cents')
  })

  test('currency with cents (under a thousand)', () => {
    expect(normalizeForTTS('$9.99')).toBe('9 dollars and 99 cents')
  })

  // Rules 2–4 — currency, full spelled-out dollars
  test('currency millions — full spelling', () => {
    expect(normalizeForTTS('$2,450,000')).toBe('2 million 450 thousand dollars')
  })

  test('currency millions — large with remainder', () => {
    expect(normalizeForTTS('$13,872,500')).toBe('13 million 872 thousand 500 dollars')
  })

  test('currency millions — round millions', () => {
    expect(normalizeForTTS('$4,200,000')).toBe('4 million 200 thousand dollars')
  })

  test('currency millions — exact millions', () => {
    expect(normalizeForTTS('$3,000,000')).toBe('3 million dollars')
  })

  test('currency thousands (even)', () => {
    expect(normalizeForTTS('$45,000')).toBe('45 thousand dollars')
  })

  test('currency thousands with remainder', () => {
    expect(normalizeForTTS('$45,500')).toBe('45 thousand 500 dollars')
  })

  test('currency under a thousand', () => {
    expect(normalizeForTTS('$850')).toBe('850 dollars')
  })

  // Rule 5 — large plain numbers (millions)
  test('plain number millions', () => {
    expect(normalizeForTTS('3,500,000')).toBe('3 million 500 thousand')
  })

  test('plain number exact millions', () => {
    expect(normalizeForTTS('2,000,000')).toBe('2 million')
  })

  // Rule 6 — large plain numbers (thousands)
  test('plain number thousands with remainder', () => {
    expect(normalizeForTTS('12,400')).toBe('12 thousand 400')
  })

  test('plain number thousands (even)', () => {
    expect(normalizeForTTS('10,000')).toBe('10 thousand')
  })

  // Rule 10 — bare years (1900–2099) are spelled out
  test('year 2025 → twenty twenty-five', () => {
    expect(normalizeForTTS('fiscal year 2025')).toBe('fiscal year twenty twenty-five')
  })

  test('year 1999 → nineteen ninety-nine', () => {
    expect(normalizeForTTS('the year 1999')).toBe('the year nineteen ninety-nine')
  })

  test('year 2000 → two thousand', () => {
    expect(normalizeForTTS('since 2000')).toBe('since two thousand')
  })

  test('year 2001 → two thousand one', () => {
    expect(normalizeForTTS('in 2001')).toBe('in two thousand one')
  })

  test('year 2010 → twenty ten', () => {
    expect(normalizeForTTS('in 2010')).toBe('in twenty ten')
  })

  test('year 1900 → nineteen hundred', () => {
    expect(normalizeForTTS('since 1900')).toBe('since nineteen hundred')
  })

  // Comma-formatted years are left to ElevenLabs' own number normalization
  test('year 2,025 (comma-formatted) is untouched', () => {
    expect(normalizeForTTS('the 2,025 report')).toBe('the 2,025 report')
  })

  test('year 1,999 (comma-formatted) is untouched', () => {
    expect(normalizeForTTS('since 1,999')).toBe('since 1,999')
  })

  test('number just outside year range is still transformed', () => {
    expect(normalizeForTTS('2,100 residents')).toBe('2 thousand 100 residents')
  })

  // Rule 7 — percentages
  test('percentage with decimal', () => {
    expect(normalizeForTTS('14.3%')).toBe('14.3 percent')
  })

  test('percentage whole number', () => {
    expect(normalizeForTTS('50%')).toBe('50 percent')
  })

  // Rule 8 — phone numbers → digit groups with commas (prevents tail-digit dropout)
  test('phone number with parens', () => {
    expect(normalizeForTTS('(970) 555-1234')).toBe('9 7 0, 5 5 5, 1 2 3 4')
  })

  test('phone number dashes only', () => {
    expect(normalizeForTTS('970-555-1234')).toBe('9 7 0, 5 5 5, 1 2 3 4')
  })

  test('phone number with no space after area code', () => {
    expect(normalizeForTTS('(970)555-1234')).toBe('9 7 0, 5 5 5, 1 2 3 4')
  })

  test('phone number in a sentence', () => {
    expect(normalizeForTTS('Call (970) 555-1234 for details.')).toBe('Call 9 7 0, 5 5 5, 1 2 3 4 for details.')
  })

  // Rule 9 — dates: ordinal day + spelled-out year
  test('date adds ordinal to day', () => {
    expect(normalizeForTTS('January 14, 2025')).toBe('January 14th, twenty twenty-five')
  })

  test('date with 1st', () => {
    expect(normalizeForTTS('March 1, 2024')).toBe('March 1st, twenty twenty-four')
  })

  test('date with 2nd', () => {
    expect(normalizeForTTS('February 2, 2024')).toBe('February 2nd, twenty twenty-four')
  })

  test('date with 3rd', () => {
    expect(normalizeForTTS('April 3, 2024')).toBe('April 3rd, twenty twenty-four')
  })

  test('date with 11th (th, not st)', () => {
    expect(normalizeForTTS('June 11, 2024')).toBe('June 11th, twenty twenty-four')
  })

  test('date with 21st', () => {
    expect(normalizeForTTS('July 21, 2024')).toBe('July 21st, twenty twenty-four')
  })

  // Rule 10 — existing ordinals are left alone
  test('existing ordinals are untouched', () => {
    expect(normalizeForTTS('the 3rd quarter')).toBe('the 3rd quarter')
    expect(normalizeForTTS('21st century')).toBe('21st century')
  })

  // Pre-written shorthand like "2.5 million" is left as-is (no $ sign)
  test('decimal shorthand already in text is untouched', () => {
    expect(normalizeForTTS('a 2.5 million grant')).toBe('a 2.5 million grant')
  })

  // Mixed — real sentence
  test('mixed real sentence', () => {
    const input = 'The city approved a $4,200,000 budget on January 14, 2025, up 14.3% from last year.'
    const expected = 'The city approved a 4 million 200 thousand dollars budget on January 14th, twenty twenty-five, up 14.3 percent from last year.'
    expect(normalizeForTTS(input)).toBe(expected)
  })
})

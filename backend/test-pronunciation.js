function applyPronunciationRules(text, rules) {
  let result = text;
  for (const { word, pronunciation } of rules) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

const rules = [
  { word: 'LocalPod', pronunciation: 'Local Pod' },
  { word: 'EPA', pronunciation: 'E P A' },
  { word: 'WBEZ', pronunciation: 'W-Bez' },
  { word: 'kWh', pronunciation: 'kilowatt hour' },
];

const tests = [
  { input: 'LocalPod announced today that LocalPod is expanding.', expect: 'Local Pod announced today that Local Pod is expanding.' },
  { input: 'The EPA issued a statement on WBEZ radio.', expect: 'The E P A issued a statement on W-Bez radio.' },
  { input: 'The grid used 400 kWh overnight.', expect: 'The grid used 400 kilowatt hour overnight.' },
  { input: 'localpod and LOCALPOD should both match.', expect: 'Local Pod and Local Pod should both match.' },
  // Edge: word that is a substring of another word should NOT match
  { input: 'The local podcast is not LocalPod.', expect: 'The local podcast is not Local Pod.' },
];

let pass = 0, fail = 0;
for (const { input, expect } of tests) {
  const output = applyPronunciationRules(input, rules);
  const ok = output === expect;
  console.log(ok ? '✓' : '✗', JSON.stringify(input));
  if (!ok) {
    console.log('  expected:', JSON.stringify(expect));
    console.log('  got:     ', JSON.stringify(output));
    fail++;
  } else {
    pass++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);

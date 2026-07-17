// Verifies every locale catalog against the English reference: identical key
// sets and identical {placeholder} tokens per key, so a translation can never
// silently drop a message or break parameter substitution.
import en from '../frontend/src/locales/en.js';
import ru from '../frontend/src/locales/ru.js';
import uz from '../frontend/src/locales/uz.js';

const placeholders = (message) =>
  JSON.stringify([...message.matchAll(/\{[a-zA-Z]+\}/g)].map((match) => match[0]).sort());

const referenceKeys = new Set(Object.keys(en));
const problems = [];

for (const [code, catalog] of Object.entries({ ru, uz })) {
  for (const key of referenceKeys) {
    if (!Object.hasOwn(catalog, key)) problems.push(`${code}: missing key "${key}"`);
    else if (placeholders(catalog[key]) !== placeholders(en[key])) {
      problems.push(`${code}: "${key}" placeholders differ from en (${placeholders(catalog[key])} vs ${placeholders(en[key])})`);
    }
  }
  for (const key of Object.keys(catalog)) {
    if (!referenceKeys.has(key)) problems.push(`${code}: unknown key "${key}" not present in en`);
  }
}

if (problems.length > 0) {
  console.error(`Locale check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Locales uz and ru match en (${referenceKeys.size} keys each)`);

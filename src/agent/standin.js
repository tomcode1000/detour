// Stand-in agent: keyword rules instead of a model. Used when no model key is set, and as
// the fallback if the model call fails. Same interface as the DeepSeek agent.
import { describeCard, describeOutcome, describeNotice } from './words.js';

const CATEGORY_WORDS = [
  ['lodging', /hotel|room|deposit|night|stay|accommodation/i],
  ['meals', /food|meal|dinner|lunch|breakfast|restaurant|eat/i],
  ['transport', /taxi|cab|uber|train|bus|transport|ride/i],
];

function findAmount(text) {
  const m = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(eur|euro|euros|€|gbp|£|usd|\$|sgd)?/i);
  if (!m) return {};
  const symbols = { '€': 'EUR', euro: 'EUR', euros: 'EUR', '£': 'GBP', $: 'USD' };
  const cur = m[2] ? (symbols[m[2].toLowerCase()] || m[2].toUpperCase()) : null;
  return { amount: Number(m[1].replace(',', '.')), currency: cur };
}

export function createStandinAgent() {
  return {
    name: 'stand-in',
    label: 'Stand-in rules (no model key)',

    async readEmail({ subject, body }) {
      const text = `${subject}\n${body}`;
      const flights = [...new Set([...text.matchAll(/\b([A-Z]{2})\s?(\d{2,4})\b/g)].map((m) => m[1] + m[2]))];
      let kind = 'other';
      if (/been rebooked|have rebooked|confirmed you on|new flight is/i.test(text)) kind = 'rebooked';
      else if (/cancel/i.test(text)) kind = 'cancelled';
      else if (/miss|connection/i.test(text)) kind = 'missed_connection';
      else if (/delay/i.test(text)) kind = 'delayed';
      const asks = /\b(send|transfer|wire|pay)\b.{0,40}\b(eur|€|usd|\$|gbp|£|fee|money|amount)|\biban\b|bank details|card (number|details)|password|verify your account/i.test(text);
      if (asks && kind !== 'rebooked') kind = 'other';
      return { kind, flights, asks_for_money_or_details: asks, summary: subject };
    },

    async understand(text) {
      if (/second night|another night|extra night|one more night/i.test(text)) return { kind: 'add_night', reason: text };
      const category = (CATEGORY_WORDS.find(([, re]) => re.test(text)) || [null])[0];
      const { amount, currency } = findAmount(text);
      if (amount) return { kind: 'raise', category: category || 'other', amount, currency, reason: text };
      return { kind: 'question', reason: text };
    },

    async reply({ outcome, card, policy }) {
      return describeOutcome(outcome, card, policy);
    },

    async notify({ notice, card, policy }) {
      return describeNotice(notice, card, policy);
    },

    describeCard,
  };
}

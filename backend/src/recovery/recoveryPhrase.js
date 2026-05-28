import crypto from 'crypto';

// BIP-39 inspired wordlist subset (256 words for 8-word phrases)
const WORDLIST = [
  'abandon','ability','able','about','above','absent','absorb','abstract',
  'absurd','abuse','access','accident','account','accuse','achieve','acid',
  'acoustic','acquire','across','act','action','actor','actress','actual',
  'adapt','add','addict','address','adjust','admit','adult','advance',
  'advice','aerobic','afford','afraid','again','agent','agree','ahead',
  'aim','air','airport','aisle','alarm','album','alcohol','alert',
  'alien','all','alley','allow','almost','alone','alpha','already',
  'also','alter','always','amateur','amazing','among','amount','amused',
  'analyst','anchor','ancient','anger','angle','angry','animal','ankle',
  'announce','annual','another','answer','antenna','antique','anxiety','apart',
  'april','arch','arctic','area','arena','argue','arm','armed',
  'armor','army','around','arrange','arrest','arrive','arrow','art',
  'artefact','artist','artwork','ask','aspect','assault','asset','assist',
  'assume','asthma','athlete','atom','attack','attend','attitude','attract',
  'auction','audit','august','aunt','author','auto','autumn','average',
  'avocado','avoid','awake','aware','away','awesome','awful','awkward',
  'axis','baby','balance','bamboo','banana','banner','barely','bargain',
  'barrel','base','basic','basket','battle','beach','bean','beauty',
  'become','beef','before','begin','behave','behind','believe','below',
  'belt','bench','benefit','best','betray','better','between','beyond',
  'bicycle','bid','bike','bind','biology','bird','birth','bitter',
  'black','blade','blame','blanket','blast','bleak','bless','blind',
  'blood','blossom','blouse','blue','blur','blush','board','boat',
  'body','boil','bomb','bone','book','boost','border','boring',
  'borrow','boss','bottom','bounce','box','boy','bracket','brain',
  'brand','brave','bread','breeze','brick','bridge','brief','bright',
  'bring','brisk','broccoli','broken','bronze','broom','brother','brown',
];

export function generateRecoveryPhrase(wordCount = 12) {
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    const idx = crypto.randomInt(0, WORDLIST.length);
    words.push(WORDLIST[idx]);
  }
  return words.join(' ');
}

export function hashPhrase(phrase) {
  return crypto.createHash('sha256').update(phrase.toLowerCase().trim()).digest('hex');
}

export function validatePhraseFormat(phrase) {
  const words = phrase.trim().split(/\s+/);
  return words.length >= 12 && words.every(w => /^[a-z]+$/.test(w));
}

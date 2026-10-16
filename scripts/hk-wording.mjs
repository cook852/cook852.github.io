// Flags Simplified characters and Mainland cooking terms in extracted text.
// The lists are deliberately short; grow them as real extractions show gaps.

export const SIMPLIFIED_CHARS = '这们鸡汤盐酱葱姜蒜个块锅热时间钟里面边说';

export const MAINLAND_TERMS = {
  土豆: '薯仔',
  西红柿: '番茄',
  西紅柿: '番茄',
  淀粉: '粟粉',
  澱粉: '粟粉',
  酱油: '生抽／老抽',
  醬油: '生抽／老抽',
  番茄酱: '茄汁',
  番茄醬: '茄汁',
  料酒: '紹興酒',
  大葱: '京葱',
};

export function wordingWarnings(text) {
  const chars = [...new Set([...text].filter((c) => SIMPLIFIED_CHARS.includes(c)))];
  const terms = Object.entries(MAINLAND_TERMS).filter(([term]) => text.includes(term));
  return [
    ...chars.map((c) => `簡體字「${c}」`),
    ...terms.map(([term, hk]) => `「${term}」香港一般叫「${hk}」`),
  ];
}

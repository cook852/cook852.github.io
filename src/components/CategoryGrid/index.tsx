import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {useAllDocsData} from '@docusaurus/plugin-content-docs/client';
import styles from './styles.module.css';

type Category = {
  label: string;
  emoji: string;
  folder: string;
};

// Keep in sync with recipes/<folder>/_category_.json
const CATEGORIES: Category[] = [
  {label: '家常小菜', emoji: '🍳', folder: 'jia-chang'},
  {label: '湯水', emoji: '🍲', folder: 'tang'},
  {label: '點心', emoji: '🥟', folder: 'dian-xin'},
  {label: '粥粉麵飯', emoji: '🍜', folder: 'fan-mian'},
  {label: '甜品', emoji: '🍮', folder: 'tian-pin'},
];

function useRecipeCounts(): Record<string, number> {
  const docs = useAllDocsData().default.versions[0].docs;
  const counts: Record<string, number> = {};
  for (const doc of docs) {
    const folder = doc.id.split('/')[0];
    counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}

export default function CategoryGrid(): ReactNode {
  const counts = useRecipeCounts();
  return (
    <section className={styles.grid}>
      {CATEGORIES.map(({label, emoji, folder}) => {
        const count = counts[folder] ?? 0;
        const body = (
          <>
            <span className={styles.emoji} aria-hidden="true">
              {emoji}
            </span>
            <span className={styles.label}>{label}</span>
            <span className={styles.count}>
              {count > 0 ? `${count} 個食譜` : '即將推出'}
            </span>
          </>
        );
        return count > 0 ? (
          <Link key={folder} className={styles.card} to={`/recipes/category/${folder}`}>
            {body}
          </Link>
        ) : (
          <div key={folder} className={`${styles.card} ${styles.empty}`}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

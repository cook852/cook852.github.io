import type {ReactNode} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import styles from './styles.module.css';

type RecipeFrontMatter = {
  servings?: number | string;
  prep_time?: string;
  cook_time?: string;
  difficulty?: string;
};

// Shows the recipe summary from front matter, so it can't drift from it.
export default function RecipeMeta(): ReactNode {
  const {servings, prep_time, cook_time, difficulty} = useDoc()
    .frontMatter as RecipeFrontMatter;
  if (servings === undefined) {
    return null;
  }
  const items: [string, ReactNode][] = [
    ['份量', `${servings} 人`],
    ['準備', prep_time],
    ['烹調', cook_time],
    ['難度', difficulty],
  ];
  return (
    <dl className={styles.meta}>
      {items.map(([label, value]) => (
        <div key={label} className={styles.item}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

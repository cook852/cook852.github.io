import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CategoryGrid from '@site/src/components/CategoryGrid';

import styles from './index.module.css';

function HomepageHeader(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/recipes">
            睇食譜 →
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout title="首頁" description="香港家常中菜食譜：家常小菜、湯水、點心、粥粉麵飯同甜品。">
      <HomepageHeader />
      <main className="container margin-vert--lg">
        <Heading as="h2">分類</Heading>
        <CategoryGrid />
      </main>
    </Layout>
  );
}

import styles from './FeatureCard.module.css';
export function FeatureCard({title,text}:{title:string;text:string}){return <article className={styles.card}><h3>{title}</h3><p>{text}</p></article>}

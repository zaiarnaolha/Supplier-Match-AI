import styles from './StepCard.module.css';
export function StepCard({number,title,text}:{number:number;title:string;text:string}){return <article className={styles.card}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>}

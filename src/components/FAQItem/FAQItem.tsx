import { useState } from 'react';
import styles from './FAQItem.module.css';
export function FAQItem({question,answer}:{question:string;answer:string}){const[open,setOpen]=useState(false);return <article className={`${styles.item} ${open?styles.open:''}`}><button onClick={()=>setOpen(value=>!value)} aria-expanded={open}><span>{question}</span><span className={styles.chevron} aria-hidden="true"/></button>{open&&<p>{answer}</p>}</article>}

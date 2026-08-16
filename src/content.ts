export type Language = 'en' | 'ua';
type CardCopy = { title: string; text: string };
type FaqCopy = CardCopy & { question: string };
type LandingCopy = {
  nav: { features: string; how: string; faq: string; login: string; signup: string };
  hero: { title: string; text: string; primary: string; secondary: string };
  intro: CardCopy; features: { title: string; items: CardCopy[] };
  how: { title: string; text: string; items: CardCopy[] };
  faq: { title: string; items: FaqCopy[] };
  trust: CardCopy; cta: CardCopy & { button: string };
  footer: { tagline: string; copyright: string };
};

export const copy: Record<Language, LandingCopy> = {
  en: {
    nav:{features:'Features',how:'How It Works',faq:'FAQ',login:'Log In',signup:'Sign Up'},
    hero:{title:'Find suppliers without hours of searching',text:'Describe what you need, and Supplier Match AI will find and help you compare relevant suppliers.',primary:'Find a Supplier',secondary:'How It Works'},
    intro:{title:'Less searching. More confidence in your choice.',text:'Stop spending evenings on dozens of websites, spreadsheets, and calls. Describe what you need, and Supplier Match AI will help you find relevant options and gather key information for comparison.'},
    features:{title:'Everything you need to find a supplier',items:[
      {title:'Search by description',text:"Describe the product or category you're looking for in your own words."},
      {title:'Relevant suppliers',text:'Find options that match your search criteria.'},
      {title:'Key information',text:'Quickly find data on pricing, minimum order, and shipping.'},
      {title:'Easy comparison',text:'Evaluate suppliers based on the terms that matter to you.'}]},
    how:{title:'Find a supplier in 4 steps',text:'Describe what you need and start searching without the usual hassle.',items:[
      {title:'Describe your need',text:"Write down the product or category you're looking for."},
      {title:'Add criteria',text:'Specify important terms: region, shipping, minimum order, or other requirements.'},
      {title:'Review options',text:'Get a curated list of potentially relevant suppliers.'},
      {title:'Compare and choose',text:"Assess the available information and decide who's worth contacting."}]},
    faq:{title:'Frequently Asked Questions',items:[
      {title:'',question:'Is this safe?',text:"Supplier Match AI helps you find and organize supplier information. Before starting any cooperation, always verify the current terms and the supplier's reliability yourself."},
      {title:'',question:"What if this doesn't work for me?",text:'Start with a specific request and check whether the results help solve your task. You decide who to contact and who to work with.'},
      {title:'',question:'How do I get started?',text:"Describe the product or category you're looking for, add important criteria, and run the search."}]},
    trust:{title:'You make the decisions. AI helps you search.',text:"Supplier Match AI doesn't choose a supplier for you. It helps you find, organize, and compare available information faster, so you can make decisions based on your own criteria."},
    cta:{title:'Find a supplier for your business',text:'Describe what you need and start finding suppliers more easily.',button:'Find a supplier'},
    footer:{tagline:'Finding suppliers is about to get easier',copyright:'© 2026 Supplier Match AI. All rights reserved.'}
  },
  ua: {
    nav:{features:'Функції',how:'Як це працює',faq:'FAQ',login:'Увійти',signup:'Зареєструватися'},
    hero:{title:'Знаходьте постачальників без годин пошуку',text:'Опишіть, що вам потрібно, а Supplier Match AI знайде та допоможе порівняти релевантних постачальників.',primary:'Знайти постачальника',secondary:'Як це працює'},
    intro:{title:'Менше пошуку. Більше впевненості у виборі.',text:'Не витрачайте вечори на десятки сайтів, таблиці та дзвінки. Опишіть, що вам потрібно, а Supplier Match AI допоможе знайти релевантні варіанти та зібрати важливу інформацію для порівняння.'},
    features:{title:'Усе необхідне для пошуку постачальника',items:[
      {title:'Пошук за описом потреби',text:'Опишіть товар або категорію, яку шукаєте, своїми словами.'},
      {title:'Релевантні постачальники',text:'Знаходьте варіанти, які відповідають вашим критеріям пошуку.'},
      {title:'Ключова інформація',text:'Швидше знаходьте дані про ціни, мінімальне замовлення та доставку.'},
      {title:'Зручне порівняння',text:'Оцінюйте постачальників за важливими для вас умовами.'}]},
    how:{title:'Знайдіть постачальника у 4 кроки',text:'Опишіть, що вам потрібно, і почніть пошук без зайвої рутини.',items:[
      {title:'Опишіть потребу',text:'Напишіть, який товар або категорію товарів ви шукаєте.'},
      {title:'Додайте критерії',text:'Вкажіть важливі умови: регіон, доставку, мінімальне замовлення чи інші вимоги.'},
      {title:'Перегляньте варіанти',text:'Отримайте добірку потенційно релевантних постачальників.'},
      {title:'Порівняйте та оберіть',text:"Оцініть доступну інформацію та визначте, з ким варто зв'язатися."}]},
    faq:{title:'Часті запитання',items:[
      {title:'',question:'Чи це безпечно?',text:'Supplier Match AI допомагає знаходити та структурувати інформацію про постачальників. Перед початком співпраці завжди перевіряйте актуальність умов і надійність постачальника самостійно.'},
      {title:'',question:'А що, як мені це не підійде?',text:'Почніть із конкретного запиту та перевірте, чи допомагають результати вирішити вашу задачу. Ви самі вирішуєте, з ким контактувати та з ким працювати.'},
      {title:'',question:'Як почати?',text:'Опишіть, який товар або категорію ви шукаєте, додайте важливі критерії та запустіть пошук.'}]},
    trust:{title:'Ви приймаєте рішення. AI допомагає з пошуком.',text:'Supplier Match AI не обирає постачальника замість вас. Він допомагає швидше знайти, структурувати та порівняти доступну інформацію, щоб ви могли приймати рішення на основі власних критеріїв.'},
    cta:{title:'Знайдіть постачальника для свого бізнесу',text:'Опишіть, що вам потрібно, і почніть пошук постачальників простіше.',button:'Знайти постачальника'},
    footer:{tagline:'Пошук постачальників стане простішим',copyright:'© 2026 Supplier Match AI. Усі права захищено.'}
  }
};

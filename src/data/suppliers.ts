export type CriterionStatus = 'Відповідає' | 'Частково відповідає' | 'Не відповідає' | 'Немає даних';

export type Supplier = {
  id: string;
  name: string;
  location: string;
  match: string;
  breakdown: string;
  updatedAt: string;
  description: string;
  website: string;
  email: string;
  phone: string;
  criteria: { label: string; value: string; status: CriterionStatus }[];
};

export const suppliers: Supplier[] = [
  { id: 'coffee-trade-ukraine', name: 'Coffee Trade Ukraine', location: 'Київ, Україна', match: '92% Match', breakdown: '3 критерії відповідають · 1 частково', updatedAt: '12 серпня 2026', description: 'Український постачальник кави та кавової продукції для бізнесу з доставкою по всій країні.', website: 'https://coffee-trade.example.com', email: 'sales@coffee-trade.example.com', phone: '+380 44 555 01 92', criteria: [
    { label: 'Товар', value: 'кава та кавова продукція', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'від 10 кг', status: 'Відповідає' }, { label: 'Ціна', value: 'від 320 грн/кг', status: 'Частково відповідає' },
  ] },
  { id: 'bean-supply-europe', name: 'Bean Supply Europe', location: 'Львів, Україна', match: '78% Match', breakdown: '2 критерії відповідають · 2 частково', updatedAt: '8 серпня 2026', description: 'Оптовий партнер для кавʼярень і ритейлу, що спеціалізується на постачанні кави в зернах.', website: 'https://bean-supply.example.com', email: 'hello@bean-supply.example.com', phone: '+380 32 555 07 78', criteria: [
    { label: 'Товар', value: 'кава в зернах', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'від 50 кг', status: 'Частково відповідає' }, { label: 'Ціна', value: 'від 290 грн/кг', status: 'Частково відповідає' },
  ] },
  { id: 'roast-partners', name: 'Roast Partners', location: 'Краків, Польща', match: '64% Match', breakdown: '2 критерії відповідають · 2 без даних', updatedAt: '28 липня 2026', description: 'Польський виробник і постачальник обсмаженого зерна, який працює з партнерами в Україні.', website: 'https://roast-partners.example.com', email: 'partners@roast-partners.example.com', phone: '+48 12 555 06 40', criteria: [
    { label: 'Товар', value: 'кава та обсмажене зерно', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'Не вказано', status: 'Немає даних' }, { label: 'Ціна', value: 'Не вказано', status: 'Немає даних' },
  ] },
  { id: 'nordic-coffee-supply', name: 'Nordic Coffee Supply', location: 'Варшава, Польща', match: '71% Match', breakdown: '2 критерії відповідають · 1 частково · 1 не відповідає', updatedAt: '20 серпня 2026', description: 'Європейський дистрибʼютор кави в зернах із міжнародною логістикою та оптовими поставками.', website: 'https://nordic-coffee.example.com', email: 'sales@nordic-coffee.example.com', phone: '+48 22 555 07 10', criteria: [
    { label: 'Товар', value: 'кава в зернах', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'від 100 кг', status: 'Частково відповідає' }, { label: 'Ціна', value: 'від 410 грн/кг', status: 'Не відповідає' },
  ] },
];

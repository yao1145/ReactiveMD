import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import '../../src/styles.css';

const source = `<input bind="name" label="组织者" placeholder="你的名字" max-length="30" required="true">
<input bind="email" type="email" label="Email" required="true">
<textarea bind="notes" label="Notes" required="true">
<date bind="day" label="Day" required="true">
<counter bind="count" label="Count" initial="0" min="0" max="5">

Name: {{ name }}. Count: {{ count }}.`;

function Fixture() {
  const [submissions, setSubmissions] = useState(0);
  const [invalid, setInvalid] = useState(0);
  return <form onSubmit={event => { event.preventDefault(); setSubmissions(value => value + 1); }} onInvalid={() => setInvalid(value => value + 1)}>
    <label>Host text<input aria-label="Host text" defaultValue="Host action" /></label>
    <label>Host required<input aria-label="Host required" required defaultValue="Ready" /></label>
    <button type="submit">Host submit</button>
    <output aria-label="Submissions">{submissions}</output>
    <output aria-label="Native invalid events">{invalid}</output>
    <LocalReactiveDocument source={source} />
  </form>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);

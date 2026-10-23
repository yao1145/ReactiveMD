import { compileLocal, createLocalRuntime, LOCAL_SYNTAX_VERSION } from 'reactive-md';

const source = `<number bind="people" label="People" initial="2" min="1" max="20">

People: {{ people }}, cost: {{ people * 100 }}`;
const result = compileLocal(source);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

console.log(`Syntax: ${LOCAL_SYNTAX_VERSION}`);
const runtime = createLocalRuntime(result.document);
try {
  const print = () => console.log(runtime.text('People: {{ people }}, cost: {{ people * 100 }}'));
  print();
  const people = result.document.nodes.find(node => node.name === 'number');
  if (!people) throw new Error('The example input was not compiled.');
  const diagnostics = runtime.set(people, 5);
  if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
  print();
} finally { runtime.dispose(); }

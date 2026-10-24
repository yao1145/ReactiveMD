import {
  compileLocal,
  createLocalRuntime,
  exportLocalState,
  importLocalState,
  LOCAL_SYNTAX_VERSION,
} from 'reactive-md';

const source = `<number bind="people" label="People" initial="2" min="1" max="20">

People: {{ people }}, cost: {{ people * 100 }}`;
const result = compileLocal(source);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

console.log(`Syntax: ${LOCAL_SYNTAX_VERSION}`);
const runtime = createLocalRuntime(result.document);
try {
  const print = () => console.log(runtime.text('People: {{ people }}, cost: {{ people * 100 }}'));
  print();
  console.log(`People parameter: ${runtime.getParameter('people')}`);

  const diagnostics = runtime.setParameters({ people: 5 });
  if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
  print();

  const file = exportLocalState(runtime, { name: 'reactive-md-core-example', version: '1' });
  runtime.setParameter('people', 1);
  const imported = importLocalState(runtime, JSON.stringify(file));
  if (imported.length) throw new Error(JSON.stringify(imported));
  print();
  console.log(`State: ${file.format}, document ${file.sourceDigest}`);
} finally { runtime.dispose(); }
